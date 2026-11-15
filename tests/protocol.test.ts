import { describe, expect, test } from "bun:test";
import {
  buildRequest,
  clampMaxTokens,
  dropNullArguments,
  gatewayErrorDetail,
  MAX_OUTPUT_TOKENS,
  parseEventLine,
  parseEventStream,
  parseMaxTokensCap,
  repairToolArguments,
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
