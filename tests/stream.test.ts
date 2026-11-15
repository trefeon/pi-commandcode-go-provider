import { describe, expect, test } from "bun:test";
import { resolveModel } from "../src/catalog.js";
import { streamCommandCodeGo } from "../src/stream.js";
import type { AssistantMessageEvent, AssistantMessageLike } from "../src/types.js";

function createMockStream(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

describe("streamCommandCodeGo", () => {
  test("streams text and finish successfully with mock fetch", async () => {
    const mockBody = createMockStream([
      '{"type":"text-start"}\n',
      '{"type":"text-delta","text":"Hello "}\n',
      '{"type":"text-delta","text":"from CommandCode Go!"}\n',
      '{"type":"text-end"}\n',
      '{"type":"finish","finishReason":"stop","totalUsage":{"inputTokens":12,"outputTokens":6}}\n',
    ]);

    const mockFetch = async () =>
      new Response(mockBody, {
        status: 200,
        headers: { "content-type": "application/x-ndjson" },
      });

    const model = resolveModel("deepseek-v4-flash");
    const stream = streamCommandCodeGo(
      model,
      {
        systemPrompt: "You are a test assistant.",
        messages: [{ role: "user", content: "Hi" }],
      },
      {
        apiKey: "mock_test_key_12345",
        fetch: mockFetch,
      }
    );

    const events: AssistantMessageEvent[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    expect(events.length).toBeGreaterThan(0);
    const startEvent = events.find((e) => e.type === "start");
    expect(startEvent).toBeDefined();

    const deltas = events.filter((e) => e.type === "text_delta");
    expect(deltas.length).toBe(2);

    const doneEvent = events.find((e) => e.type === "done");
    expect(doneEvent).toBeDefined();
    if (doneEvent && doneEvent.type === "done") {
      expect(doneEvent.reason).toBe("stop");
      expect(doneEvent.message.usage.input).toBe(12);
      expect(doneEvent.message.usage.output).toBe(6);
      expect(doneEvent.message.content.length).toBe(1);
      expect(doneEvent.message.content[0].type).toBe("text");
      if (doneEvent.message.content[0].type === "text") {
        expect(doneEvent.message.content[0].text).toBe("Hello from CommandCode Go!");
      }
    }
  });

  test("streams thinking/reasoning content accurately", async () => {
    const mockBody = createMockStream([
      '{"type":"reasoning-start"}\n',
      '{"type":"reasoning-delta","text":"Thinking "}\n',
      '{"type":"reasoning-delta","text":"deeply..."}\n',
      '{"type":"reasoning-end"}\n',
      '{"type":"text-start"}\n',
      '{"type":"text-delta","text":"Done."}\n',
      '{"type":"text-end"}\n',
      '{"type":"finish","finishReason":"stop"}\n',
    ]);

    const mockFetch = async () =>
      new Response(mockBody, {
        status: 200,
        headers: { "content-type": "application/x-ndjson" },
      });

    const model = resolveModel("claude-sonnet-5");
    const stream = streamCommandCodeGo(
      model,
      { messages: [{ role: "user", content: "Plan this" }] },
      { apiKey: "mock_key", fetch: mockFetch }
    );

    const events: AssistantMessageEvent[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    const thinkingDelta = events.filter((e) => e.type === "thinking_delta");
    expect(thinkingDelta.length).toBe(2);

    const doneEvent = events.find((e) => e.type === "done");
    expect(doneEvent).toBeDefined();
    if (doneEvent && doneEvent.type === "done") {
      const thinkingBlock = doneEvent.message.content.find((c) => c.type === "thinking");
      expect(thinkingBlock).toBeDefined();
      if (thinkingBlock && thinkingBlock.type === "thinking") {
        expect(thinkingBlock.thinking).toBe("Thinking deeply...");
      }
    }
  });

  test("emits toolcall events and filters optional null arguments", async () => {
    const mockBody = createMockStream([
      JSON.stringify({
        type: "tool-call",
        toolCallId: "call_abc_999",
        toolName: "bash",
        input: { command: "ls -la", timeoutMs: null },
      }) + "\n",
      '{"type":"finish","finishReason":"tool_calls"}\n',
    ]);

    const mockFetch = async () =>
      new Response(mockBody, {
        status: 200,
        headers: { "content-type": "application/x-ndjson" },
      });

    const model = resolveModel("deepseek-v4-pro");
    const stream = streamCommandCodeGo(
      model,
      {
        messages: [{ role: "user", content: "List files" }],
        tools: [
          {
            name: "bash",
            description: "Run shell command",
            parameters: {
              type: "object",
              properties: {
                command: { type: "string" },
                timeoutMs: { type: "number" },
              },
              required: ["command"],
            },
          },
        ],
      },
      { apiKey: "mock_key", fetch: mockFetch }
    );

    const events: AssistantMessageEvent[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    const toolCallEvent = events.find((e) => e.type === "toolcall_end");
    expect(toolCallEvent).toBeDefined();
    if (toolCallEvent && toolCallEvent.type === "toolcall_end") {
      expect(toolCallEvent.toolCall.id).toBe("call_abc_999");
      expect(toolCallEvent.toolCall.name).toBe("bash");
      expect(toolCallEvent.toolCall.arguments.command).toBe("ls -la");
      // Optional timeoutMs: null must be stripped!
      expect(toolCallEvent.toolCall.arguments.timeoutMs).toBeUndefined();
    }

    const doneEvent = events.find((e) => e.type === "done");
    expect(doneEvent).toBeDefined();
    if (doneEvent && doneEvent.type === "done") {
      expect(doneEvent.reason).toBe("toolUse");
    }
  });

  test("resolves upstream tool aliases and repairs their arguments", async () => {
    const mockBody = createMockStream([
      JSON.stringify({
        type: "tool-call",
        toolCallId: "call_alias_1",
        toolName: "read_file",
        input: { file_path: "a.txt" },
      }) + "\n",
      '{"type":"finish","finishReason":"tool_calls"}\n',
    ]);

    const mockFetch = async () =>
      new Response(mockBody, {
        status: 200,
        headers: { "content-type": "application/x-ndjson" },
      });

    const model = resolveModel("deepseek-v4-pro");
    const stream = streamCommandCodeGo(
      model,
      {
        messages: [{ role: "user", content: "Open a.txt" }],
        tools: [
          {
            name: "read",
            description: "Read a file",
            parameters: {
              type: "object",
              properties: { path: { type: "string" }, i: { type: "string" } },
              required: ["path"],
            },
          },
        ],
      },
      { apiKey: "mock_key", fetch: mockFetch }
    );

    const events: AssistantMessageEvent[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    const toolCallEvent = events.find((e) => e.type === "toolcall_end");
    expect(toolCallEvent).toBeDefined();
    if (toolCallEvent && toolCallEvent.type === "toolcall_end") {
      expect(toolCallEvent.toolCall.name).toBe("read");
      expect(toolCallEvent.toolCall.arguments.path).toBe("a.txt");
    }
  });

  test("assembles arguments from tool-input deltas when the final event omits input", async () => {
    const chunks = [
      JSON.stringify({ type: "tool-input-start", id: "call_delta_1", toolName: "bash" }) + "\n",
      JSON.stringify({ type: "tool-input-delta", id: "call_delta_1", delta: '{"' }) + "\n",
      JSON.stringify({ type: "tool-input-delta", id: "call_delta_1", delta: 'command":"echo delta"}' }) + "\n",
      JSON.stringify({ type: "tool-input-end", id: "call_delta_1" }) + "\n",
      JSON.stringify({ type: "tool-call", toolCallId: "call_delta_1", toolName: "bash" }) + "\n",
      '{"type":"finish","finishReason":"tool_calls"}\n',
    ];
    const mockBody = createMockStream(chunks);

    const mockFetch = async () =>
      new Response(mockBody, {
        status: 200,
        headers: { "content-type": "application/x-ndjson" },
      });

    const model = resolveModel("deepseek-v4-pro");
    const stream = streamCommandCodeGo(
      model,
      {
        messages: [{ role: "user", content: "Echo" }],
        tools: [
          {
            name: "bash",
            description: "Run shell command",
            parameters: {
              type: "object",
              properties: { command: { type: "string" }, i: { type: "string" } },
              required: ["command"],
            },
          },
        ],
      },
      { apiKey: "mock_key", fetch: mockFetch }
    );

    const events: AssistantMessageEvent[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    const toolCallEvent = events.find((e) => e.type === "toolcall_end");
    expect(toolCallEvent).toBeDefined();
    if (toolCallEvent && toolCallEvent.type === "toolcall_end") {
      expect(toolCallEvent.toolCall.name).toBe("bash");
      expect(toolCallEvent.toolCall.arguments.command).toBe("echo delta");
    }
  });

  test("retries once with the max_tokens ceiling named by a 400", async () => {
    const bodies: string[] = [];
    const okBody = createMockStream([
      '{"type":"text-start"}\n',
      '{"type":"text-delta","text":"ok"}\n',
      '{"type":"text-end"}\n',
      '{"type":"finish","finishReason":"stop"}\n',
    ]);

    const mockFetch = async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ""));
      if (bodies.length === 1) {
        return new Response(
          JSON.stringify({
            error: {
              message:
                'Invalid request error. Validation error: Too big: expected number to be <=131072 at "params.max_tokens"',
              code: "BAD_REQUEST",
            },
          }),
          { status: 400, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(okBody, {
        status: 200,
        headers: { "content-type": "application/x-ndjson" },
      });
    };

    const stream = streamCommandCodeGo(
      resolveModel("deepseek-v4.1-flash"),
      { messages: [{ role: "user", content: "Continue the session" }] },
      { apiKey: "mock_key", maxTokens: 200_000, fetch: mockFetch }
    );

    const events: AssistantMessageEvent[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    expect(bodies.length).toBe(2);
    const first = JSON.parse(bodies[0]) as { params: { max_tokens: number } };
    const second = JSON.parse(bodies[1]) as { params: { max_tokens: number } };
    expect(first.params.max_tokens).toBe(200_000);
    expect(second.params.max_tokens).toBe(131_072);
    expect(events.find((e) => e.type === "error")).toBeUndefined();
    expect(events.find((e) => e.type === "done")).toBeDefined();
  });

  test("normalizes cached input so the host gauge matches the gateway prompt", async () => {
    const mockBody = createMockStream([
      '{"type":"text-start"}\n',
      '{"type":"text-delta","text":"ok"}\n',
      '{"type":"text-end"}\n',
      JSON.stringify({
        type: "finish",
        finishReason: "stop",
        totalUsage: {
          inputTokens: 570_477,
          outputTokens: 305,
          inputTokenDetails: { noCacheTokens: 5_000, cacheReadTokens: 565_477 },
        },
      }) + "\n",
    ]);

    const mockFetch = async () =>
      new Response(mockBody, { status: 200, headers: { "content-type": "application/x-ndjson" } });

    const model = resolveModel("deepseek-v4.1-flash");
    const stream = streamCommandCodeGo(
      model,
      { messages: [{ role: "user", content: "Long session" }] },
      { apiKey: "mock_key", fetch: mockFetch }
    );

    const events: AssistantMessageEvent[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    const doneEvent = events.find((e) => e.type === "done");
    expect(doneEvent).toBeDefined();
    if (!doneEvent || doneEvent.type !== "done") return;

    const { usage } = doneEvent.message;
    // Hosts compute prompt occupancy as input + cacheRead + cacheWrite, so the
    // whole prompt must not sit in `input` as well: 570K would render as ~105%.
    expect(usage.input + usage.cacheRead + usage.cacheWrite).toBe(570_477);
    expect(usage.contextTokens).toBe(570_477);
    expect(usage.input).toBe(5_000);
    expect(usage.cacheRead).toBe(565_477);
    expect(usage.totalTokens).toBe(570_782);

    const expectedCost =
      (5_000 / 1_000_000) * model.cost.input +
      (565_477 / 1_000_000) * model.cost.cacheRead +
      (305 / 1_000_000) * model.cost.output;
    expect(usage.cost.total).toBeCloseTo(expectedCost, 10);
  });

  test("emits error event on HTTP 401 / 403 failure without hanging", async () => {
    const mockFetch = async () =>
      new Response(
        JSON.stringify({
          error: { message: "Invalid credentials", code: "UNAUTHORIZED" },
        }),
        { status: 401, headers: { "content-type": "application/json" } }
      );

    const model = resolveModel("deepseek-v4-flash");
    const stream = streamCommandCodeGo(
      model,
      { messages: [{ role: "user", content: "Hi" }] },
      { apiKey: "bad_key", fetch: mockFetch }
    );

    const events: AssistantMessageEvent[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    if (errorEvent && errorEvent.type === "error") {
      expect(errorEvent.error.errorMessage).toContain("401");
      expect(errorEvent.error.errorMessage).toContain("Invalid credentials");
    }
  });
});
