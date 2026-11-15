import { describe, expect, test } from "bun:test";
import {
  buildRequest,
  clampMaxTokens,
  coerceToolInput,
  dropNullArguments,
  gatewayErrorDetail,
  MAX_OUTPUT_TOKENS,
  parseEventLine,
  parseEventStream,
  parseMaxTokensCap,
  repairToolArguments,
  resolveDeclaredToolName,
} from "../src/protocol.js";

describe("protocol", () => {
  describe("dropNullArguments and repairToolArguments", () => {
    test("dropNullArguments strips injected nulls for optional fields while keeping required/explicit ones", () => {
      const schema = {
        type: "object",
        properties: {
          path: { type: "string" },
          offset: { type: "number" },
          filter: { type: "null" },
        },
        required: ["path"],
      };

      const args = {
        path: "foo.ts",
        offset: null, // should be dropped
        filter: null, // should be kept
      };

      const cleaned = dropNullArguments(args, schema) as {
        path?: string;
        offset?: number;
        filter?: null;
      };
      expect(cleaned.path).toBe("foo.ts");
      expect(cleaned.offset).toBeUndefined();
      expect(cleaned.filter).toBeNull();
    });
    test("repairToolArguments fixes smashed bash keys from reasoning models", () => {
      const malformed = {
        "i string независимоListing root directory to understand project structure. Mevcommand": "ls",
      };
      const repaired = repairToolArguments(malformed, "bash");
      expect(repaired.command).toBe("ls");
      expect(repaired.i).toContain("Listing root directory to understand project structure");
    });

    test("repairToolArguments unwraps nested string argument wrappers", () => {
      const edit = repairToolArguments(
        { original: { input: '{"path":"src/a.ts","old_string":"a","new_string":"b"}' } },
        "edit"
      );
      expect(edit.path).toBe("src/a.ts");
      expect(edit.old_string).toBe("a");
      expect(edit.new_string).toBe("b");

      const bash = repairToolArguments({ original: '{"command":"ls"}' }, "bash");
      expect(bash.command).toBe("ls");
    });

    test("repairToolArguments maps schema-known synonyms and wrappers", () => {
      const readSchema = {
        type: "object",
        properties: { path: { type: "string" }, i: { type: "string" } },
        required: ["path"],
      };
      expect(repairToolArguments({ file_path: "a.txt" }, "read", readSchema).path).toBe("a.txt");
      expect(repairToolArguments({ arguments: { file_path: "a.txt" } }, "read", readSchema).path).toBe("a.txt");

      const bashSchema = {
        type: "object",
        properties: { command: { type: "string" }, i: { type: "string" } },
        required: ["command"],
      };
      expect(repairToolArguments({ cmd: "ls" }, "bash", bashSchema).command).toBe("ls");
      // A numeric key that merely contains "command" must not become command.
      expect(repairToolArguments({ command_timeout: 30 }, "bash", bashSchema).command).toBeUndefined();

      const editSchema = {
        type: "object",
        properties: {
          path: { type: "string" },
          old_string: { type: "string" },
          new_string: { type: "string" },
        },
        required: ["path", "old_string", "new_string"],
      };
      expect(
        repairToolArguments({ file_path: "a.ts", old_str: "x", new_str: "y" }, "edit", editSchema)
      ).toMatchObject({ path: "a.ts", old_string: "x", new_string: "y" });
    });

    test("repairToolArguments repairs fused keys for any declared property", () => {
      const readSchema = {
        type: "object",
        properties: { path: { type: "string" }, i: { type: "string" } },
        required: ["path"],
      };
      const repaired = repairToolArguments({ "i string Checking files Mevpath": "src/a.ts" }, "read", readSchema);
      expect(repaired.path).toBe("src/a.ts");
      expect(repaired.i).toContain("Checking files");
    });

    test("coerceToolInput extracts JSON from fences and prose", () => {
      const bashSchema = {
        type: "object",
        properties: { command: { type: "string" }, i: { type: "string" } },
        required: ["command"],
      };
      expect(coerceToolInput('```json\n{"command":"ls"}\n```', "bash", bashSchema).command).toBe("ls");
      expect(coerceToolInput('Here you go: {"command":"pwd"}', "bash", bashSchema).command).toBe("pwd");
    });

    test("never fabricates a command from intent-only or broken JSON input", () => {
      const bashSchema = {
        type: "object",
        properties: { command: { type: "string" }, i: { type: "string" } },
        required: ["command"],
      };
      // Glyph-class models sometimes emit only the intent; that is not a command.
      expect(repairToolArguments({ intent: "string" }, "bash", bashSchema).command).toBeUndefined();
      expect(repairToolArguments({ i: "string" }, "bash", bashSchema).command).toBeUndefined();
      // Malformed JSON text must be rejected, not executed as a shell command.
      expect(coerceToolInput('{"Probing tool call!\\u00bf 0;probe-ok', "bash", bashSchema)).toEqual({});
      // A legitimate brace-group command is still a bare string command.
      expect(coerceToolInput("{ echo hi; }", "bash", bashSchema).command).toBe("{ echo hi; }");
    });

  });
  describe("resolveDeclaredToolName", () => {
    test("maps aliases and case variants only onto declared tools", () => {
      expect(resolveDeclaredToolName("read_file", ["read", "bash"])).toBe("read");
      expect(resolveDeclaredToolName("Bash", ["read", "bash"])).toBe("bash");
      expect(resolveDeclaredToolName("str_replace_editor", ["edit"])).toBe("edit");
      expect(resolveDeclaredToolName("run_command", ["bash"])).toBe("bash");
      expect(resolveDeclaredToolName("read_file", ["read_file"])).toBe("read_file");
      expect(resolveDeclaredToolName("read_file", ["write"])).toBe("read_file");
    });
  });
  describe("buildRequest", () => {
    test("creates valid Command Code Go envelope", () => {
      const req = buildRequest(
        "deepseek-v4.1-flash",
        {
          systemPrompt: "You are an assistant.",
          messages: [
            { role: "user", content: "Hello world" },
            {
              role: "assistant",
              content: [
                { type: "text", text: "Hi there!" },
                {
                  type: "toolCall",
                  id: "call_123",
                  name: "read",
                  arguments: { path: "a.txt" },
                },
              ],
            },
            {
              role: "tool",
              toolCallId: "call_123",
              content: "file content",
            },
          ],
          tools: [
            {
              name: "read",
              description: "Read a file",
              parameters: {
                type: "object",
                properties: { path: { type: "string" } },
                required: ["path"],
              },
            },
          ],
        },
        { reasoning: "high" }
      ) as {
        config: { workingDir: string };
        params: {
          model: string;
          system: string;
          reasoning_effort: string;
          messages: Array<{ role: string }>;
          tools: unknown[];
        };
      };

      expect(req.config).toBeDefined();
      expect(req.config.workingDir).toBeDefined();
      expect(req.params.model).toBe("deepseek/deepseek-v4.1-flash");
      expect(req.params.system).toBe("You are an assistant.");
      expect(req.params.reasoning_effort).toBe("high");
      expect(req.params.messages.length).toBe(3);
      expect(req.params.messages[0].role).toBe("user");
      expect(req.params.messages[1].role).toBe("assistant");
      expect(req.params.messages[2].role).toBe("tool");
      expect(req.params.tools.length).toBe(1);
      expect((req.params.tools[0] as { type?: string }).type).toBeUndefined();
      expect((req as unknown as { memory: unknown }).memory).toBeNull();
      expect((req as unknown as { mode: string }).mode).toBe("agent");
    });

    test("repairs replayed history tool-call arguments with the tool schema", () => {
      const req = buildRequest("deepseek-v4.1-flash", {
        messages: [
          {
            role: "assistant",
            content: [
              { type: "toolCall", id: "call_hist", name: "read", arguments: { file_path: "a.txt" } },
            ],
          },
          { role: "toolResult", toolCallId: "call_hist", toolName: "read", content: "hello" },
        ],
        tools: [
          {
            name: "read",
            parameters: {
              type: "object",
              properties: { path: { type: "string" } },
              required: ["path"],
            },
          },
        ],
      }) as { params: { messages: Array<{ role: string; content: Array<{ type: string; input?: { path?: string } }> }> } };

      expect(req.params.messages[0].content[0].type).toBe("tool-call");
      expect(req.params.messages[0].content[0].input?.path).toBe("a.txt");
    });

    test("forwards user images as data URLs with mimeType", () => {
      const req = buildRequest("deepseek-v4.1-flash", {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "What color?" },
              { type: "image", data: "AAAA", mimeType: "image/png" },
            ],
          },
        ],
      }) as { params: { messages: Array<{ role: string; content: Array<Record<string, unknown>> }> } };

      expect(req.params.messages[0].content[1]).toEqual({
        type: "image",
        image: "data:image/png;base64,AAAA",
        mimeType: "image/png",
      });
    });

    test("batches tool-result images into one user turn after all tool results", () => {
      const req = buildRequest("deepseek-v4.1-flash", {
        messages: [
          {
            role: "assistant",
            content: [
              { type: "toolCall", id: "call_1", name: "read", arguments: { path: "a" } },
              { type: "toolCall", id: "call_2", name: "read", arguments: { path: "b" } },
            ],
          },
          {
            role: "toolResult",
            toolCallId: "call_1",
            toolName: "read",
            content: [
              { type: "text", text: "one" },
              { type: "image", data: "AAA", mimeType: "image/png" },
            ],
          },
          {
            role: "toolResult",
            toolCallId: "call_2",
            toolName: "read",
            content: [
              { type: "text", text: "two" },
              { type: "image", data: "BBB", mimeType: "image/jpeg" },
            ],
          },
          { role: "assistant", content: [{ type: "text", text: "done" }] },
        ],
        tools: [
          {
            name: "read",
            parameters: {
              type: "object",
              properties: { path: { type: "string" } },
              required: ["path"],
            },
          },
        ],
      }) as { params: { messages: Array<{ role: string; content: Array<Record<string, unknown>> }> } };

      expect(req.params.messages.map((m) => m.role)).toEqual(["assistant", "tool", "tool", "user", "assistant"]);
      const toolText = req.params.messages[1].content[0] as { output: { value: string } };
      expect(toolText.output.value).toBe("one");
      expect(req.params.messages[3].content).toEqual([
        { type: "image", image: "data:image/png;base64,AAA", mimeType: "image/png" },
        { type: "image", image: "data:image/jpeg;base64,BBB", mimeType: "image/jpeg" },
      ]);
    });

    test("drops tool results whose call never appears in history", () => {
      const req = buildRequest("deepseek-v4.1-flash", {
        messages: [
          { role: "toolResult", toolCallId: "call_orphan", toolName: "read", content: "stale" },
          { role: "user", content: "hello" },
        ],
      }) as { params: { messages: Array<{ role: string }> } };

      expect(req.params.messages.map((m) => m.role)).toEqual(["user"]);
    });

    test("clamps oversized max_tokens to the gateway ceiling", () => {
      expect(MAX_OUTPUT_TOKENS).toBe(200_000);
      expect(clampMaxTokens(384_000)).toBe(200_000);
      expect(clampMaxTokens(524_288)).toBe(200_000);
      expect(clampMaxTokens(32_000)).toBe(32_000);
      expect(clampMaxTokens(0)).toBe(1);
      expect(clampMaxTokens()).toBe(64_000);

      const req = buildRequest(
        "deepseek/deepseek-v4.1-flash",
        { messages: [{ role: "user", content: "Hi" }] },
        { maxTokens: 500_000 }
      ) as { params: { max_tokens: number } };
      expect(req.params.max_tokens).toBe(200_000);
    });

    test("parses the max_tokens ceiling out of a gateway validation error", () => {
      expect(
        parseMaxTokensCap(
          'Invalid request error. Validation error: Too big: expected number to be <=200000 at "params.max_tokens" [BAD_REQUEST]'
        )
      ).toBe(200_000);
      expect(parseMaxTokensCap("something else entirely")).toBeUndefined();
      expect(parseMaxTokensCap('Too big at "params.temperature"')).toBeUndefined();
    });
    test("serializes OMP toolResult messages properly as wire tool turns", () => {
      const req = buildRequest(
        "deepseek-v4.1-flash",
        {
          messages: [
            {
              role: "assistant",
              content: [
                { type: "toolCall", id: "call_00_abc", name: "bash", arguments: { command: "ls" } },
                { type: "toolCall", id: "call_01_def", name: "read", arguments: { path: "a.txt" } },
              ],
            },
            {
              role: "toolResult",
              toolCallId: "call_00_abc",
              content: "file1.txt",
            },
            {
              role: "toolResult",
              toolCallId: "call_01_def",
              content: "content of a.txt",
            },
          ],
        }
      ) as { params: { messages: Array<{ role: string; content: unknown[] }> } };

      expect(req.params.messages.length).toBe(3);
      expect(req.params.messages[0].role).toBe("assistant");
      expect(req.params.messages[1].role).toBe("tool");
      expect(req.params.messages[2].role).toBe("tool");

      const t1 = req.params.messages[1].content[0] as { type: string; toolCallId: string; toolName: string };
      expect(t1.toolCallId).toBe("call_00_abc");
      expect(t1.toolName).toBe("bash");

      const t2 = req.params.messages[2].content[0] as { type: string; toolCallId: string; toolName: string };
      expect(t2.toolCallId).toBe("call_01_def");
      expect(t2.toolName).toBe("read");
    });

    test("synthesizes a result for an unpaired tool call (aborted turn)", () => {
      const req = buildRequest("deepseek-v4.1-flash", {
        messages: [
          {
            role: "assistant",
            content: [{ type: "toolCall", id: "call_abort", name: "bash", arguments: { command: "ls" } }],
          },
        ],
      }) as { params: { messages: Array<{ role: string; content: unknown[] }> } };

      expect(req.params.messages.map((m) => m.role)).toEqual(["assistant", "tool"]);
      const result = req.params.messages[1].content[0] as {
        type: string;
        toolCallId: string;
        toolName: string;
        output: { type: string };
      };
      expect(result.type).toBe("tool-result");
      expect(result.toolCallId).toBe("call_abort");
      expect(result.toolName).toBe("bash");
      expect(result.output.type).toBe("error-text");
    });
  });
  describe("event parsing", () => {
    test("parseEventLine parses valid JSON lines", () => {
      const event = parseEventLine('{"type":"text-delta","text":"hello"}');
      expect(event).toEqual({ type: "text-delta", text: "hello" });
    });

    test("parseEventLine ignores SSE prefixes, empty lines, and comments", () => {
      expect(parseEventLine("")).toBeUndefined();
      expect(parseEventLine(": keep-alive")).toBeUndefined();
      expect(parseEventLine("data: [DONE]")).toBeUndefined();
      expect(parseEventLine('data: {"type":"finish"}')).toEqual({ type: "finish" });
    });

    test("parseEventStream parses chunked stream correctly", async () => {
      const chunks = [
        '{"type":"text-start"}\n{"type":"text-delta","text":"Hel',
        'lo"}\n{"type":"text-end"}\n{"type":"finish","finishReason":"stop"}\n',
      ];

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder();
          for (const chunk of chunks) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        },
      });

      const events: Record<string, unknown>[] = [];
      for await (const event of parseEventStream(stream)) {
        events.push(event);
      }

      expect(events.length).toBe(4);
      expect(events[0].type).toBe("text-start");
      expect(events[1]).toEqual({ type: "text-delta", text: "Hello" });
      expect(events[2].type).toBe("text-end");
      expect(events[3].type).toBe("finish");
    });
  });

  describe("gatewayErrorDetail", () => {
    test("extracts message and code from JSON error", () => {
      const json = JSON.stringify({
        error: { message: "Model unavailable", code: "MODEL_NOT_FOUND" },
      });
      expect(gatewayErrorDetail(json)).toBe("Model unavailable [MODEL_NOT_FOUND]");
    });

    test("handles plain text error fallback", () => {
      expect(gatewayErrorDetail("Internal Server Error")).toBe("Internal Server Error");
    });
  });
});
