import { resolveApiKey } from "./auth.js";
import { resolveModel } from "./catalog.js";
import { createAssistantMessageEventStream } from "./event-stream.js";
import {
  buildRequest,
  CLI_VERSION,
  coerceToolInput,
  DEFAULT_GATEWAY_URL,
  dropNullArguments,
  gatewayErrorDetail,
  parseEventStream,
  parseMaxTokensCap,
  sanitizeToolCallId,
} from "./protocol.js";
import type {
  AssistantContent,
  AssistantMessageEventStreamLike,
  AssistantMessageLike,
  CommandCodeGoModel,
  ContextLike,
  JsonObject,
  StopReason,
  StreamOptions,
  TextContent,
  ThinkingContent,
  ToolCallContent,
} from "./types.js";
import { isRecord } from "./types.js";

const DEFAULT_TIMEOUT_MS = 300_000;

function mapFinishReason(rawReason: unknown, hasToolCalls: boolean): StopReason {
  if (hasToolCalls) return "toolUse";
  if (typeof rawReason !== "string") return "stop";
  switch (rawReason.toLowerCase()) {
    case "tool_calls":
    case "tool-calls":
    case "tool_use":
    case "tool-use":
      return "toolUse";
    case "length":
    case "max_tokens":
    case "max-tokens":
    case "max_output_tokens":
      return "length";
    case "stop":
    case "end_turn":
    case "end-turn":
    default:
      return "stop";
  }
}

export function streamCommandCodeGo(
  modelLike: CommandCodeGoModel | { id: string },
  context: ContextLike,
  options?: StreamOptions
): AssistantMessageEventStreamLike {
  const stream = createAssistantMessageEventStream();
  const model = resolveModel(modelLike.id);
  const apiKey = resolveApiKey(options?.apiKey);

  const message: AssistantMessageLike = {
    role: "assistant",
    content: [],
    api: "commandcode-go",
    provider: "commandcode-go",
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "pending",
    timestamp: Date.now(),
  };

  if (!apiKey) {
    message.stopReason = "error";
    message.errorMessage =
      "No Command Code Go API key found. Place key in `command-code-go-api-keys`, set `COMMANDCODE_API_KEY` or `COMMAND_CODE_API_KEY`, or pass via auth config.";
    queueMicrotask(() => {
      stream.push({ type: "start", partial: message });
      stream.push({ type: "error", reason: "error", error: message });
    });
    return stream;
  }

  // Execute stream asynchronously
  (async () => {
    stream.push({ type: "start", partial: message });

    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => {
      controller.abort(new Error(`Command Code Go request timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const signal = options?.signal
      ? AbortSignal.any([options.signal, controller.signal])
      : controller.signal;

    try {
      const gatewayUrl = process.env.COMMANDCODE_GO_URL || DEFAULT_GATEWAY_URL;

      const headers: Record<string, string> = {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        accept: "text/event-stream, application/x-ndjson, text/plain",
        "x-command-code-version": CLI_VERSION,
        "x-cli-environment": "production",
        "user-agent": "cli",
      };

      if (options?.headers) {
        for (const [k, v] of Object.entries(options.headers)) {
          if (v !== null && v !== undefined) headers[k] = v;
        }
      }

      const fetchImpl = options?.fetch ?? fetch;

      // A gateway validation error can still cap max_tokens below our ceiling
      // (or below a stale model row). Retry once with the ceiling it reports.
      let attemptOptions = options;
      let response: Response | undefined;
      let failureDetail = "";
      for (let attempt = 0; attempt < 2; attempt++) {
        const requestBody = buildRequest(model.id, context, attemptOptions);
        const requestedMax = (requestBody.params as { max_tokens?: number }).max_tokens;

        response = await fetchImpl(gatewayUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(requestBody),
          signal,
        });
        if (response.ok) break;

        failureDetail = gatewayErrorDetail(await response.text().catch(() => ""));
        const cap =
          attempt === 0 && response.status === 400 ? parseMaxTokensCap(failureDetail) : undefined;
        if (cap === undefined || (typeof requestedMax === "number" && requestedMax <= cap)) break;
        attemptOptions = { ...options, maxTokens: cap };
      }

      if (!response || !response.ok) {
        message.stopReason = "error";
        message.errorMessage = `HTTP ${response?.status ?? 0} from Command Code gateway: ${failureDetail || "Unknown error"}`;
        stream.push({ type: "error", reason: "error", error: message });
        return;
      }

      if (!response.body) {
        message.stopReason = "error";
        message.errorMessage = "Empty response body from Command Code gateway";
        stream.push({ type: "error", reason: "error", error: message });
        return;
      }

      let currentTextBlock: TextContent | null = null;
      let currentTextIndex = -1;
      let currentThinkingBlock: ThinkingContent | null = null;
      let currentThinkingIndex = -1;
      let hasToolCalls = false;

      // Tools schema lookup for argument filtering
      const toolSchemas = new Map<string, unknown>();
      if (context.tools) {
        for (const tool of context.tools) {
          toolSchemas.set(tool.name, tool.parameters);
        }
      }

      for await (const event of parseEventStream(response.body)) {
        if (event.type === "error") {
          const errPayload = isRecord(event.error) ? event.error : event;
          const msg =
            (typeof errPayload.message === "string" ? errPayload.message : undefined) ??
            (typeof errPayload.detail === "string" ? errPayload.detail : undefined) ??
            "Gateway mid-stream error";
          message.stopReason = "error";
          message.errorMessage = msg;
          stream.push({ type: "error", reason: "error", error: message });
          return;
        }

        switch (event.type) {
          case "text-start": {
            currentTextBlock = { type: "text", text: "" };
            currentTextIndex = message.content.length;
            message.content.push(currentTextBlock);
            stream.push({ type: "text_start", contentIndex: currentTextIndex, partial: message });
            break;
          }

          case "text-delta": {
            const delta = typeof event.text === "string" ? event.text : "";
            if (delta.length > 0) {
              if (!currentTextBlock) {
                currentTextBlock = { type: "text", text: "" };
                currentTextIndex = message.content.length;
                message.content.push(currentTextBlock);
                stream.push({ type: "text_start", contentIndex: currentTextIndex, partial: message });
              }
              currentTextBlock.text += delta;
              stream.push({
                type: "text_delta",
                contentIndex: currentTextIndex,
                delta,
                partial: message,
              });
            }
            break;
          }

          case "text-end": {
            if (currentTextBlock && currentTextIndex >= 0) {
              stream.push({
                type: "text_end",
                contentIndex: currentTextIndex,
                content: currentTextBlock.text,
                partial: message,
              });
              currentTextBlock = null;
              currentTextIndex = -1;
            }
            break;
          }

          case "reasoning-start": {
            currentThinkingBlock = { type: "thinking", thinking: "" };
            currentThinkingIndex = message.content.length;
            message.content.push(currentThinkingBlock);
            stream.push({
              type: "thinking_start",
              contentIndex: currentThinkingIndex,
              partial: message,
            });
            break;
          }

          case "reasoning-delta": {
            const delta = typeof event.text === "string" ? event.text : "";
            if (delta.length > 0) {
              if (!currentThinkingBlock) {
                currentThinkingBlock = { type: "thinking", thinking: "" };
                currentThinkingIndex = message.content.length;
                message.content.push(currentThinkingBlock);
                stream.push({
                  type: "thinking_start",
                  contentIndex: currentThinkingIndex,
                  partial: message,
                });
              }
              currentThinkingBlock.thinking += delta;
              stream.push({
                type: "thinking_delta",
                contentIndex: currentThinkingIndex,
                delta,
                partial: message,
              });
            }
            break;
          }

          case "reasoning-end": {
            if (currentThinkingBlock && currentThinkingIndex >= 0) {
              stream.push({
                type: "thinking_end",
                contentIndex: currentThinkingIndex,
                content: currentThinkingBlock.thinking,
                partial: message,
              });
              currentThinkingBlock = null;
              currentThinkingIndex = -1;
            }
            break;
          }

          case "tool-call": {
            hasToolCalls = true;
            const callId = sanitizeToolCallId(
              String(event.toolCallId ?? event.id ?? `call_${Date.now()}`)
            );
            const toolName = String(event.toolName ?? event.name ?? "unknown");
            const rawArgs = event.input ?? event.args ?? event.arguments ?? {};
            const schema = toolSchemas.get(toolName);
            const filteredArgs = dropNullArguments(rawArgs, schema);
            const coercedArgs = coerceToolInput(filteredArgs, toolName, schema);

            const toolCallBlock: ToolCallContent = {
              type: "toolCall",
              id: callId,
              name: toolName,
              arguments: coercedArgs,
            };

            const callIndex = message.content.length;
            message.content.push(toolCallBlock);

            stream.push({ type: "toolcall_start", contentIndex: callIndex, partial: message });
            stream.push({
              type: "toolcall_delta",
              contentIndex: callIndex,
              delta: JSON.stringify(coercedArgs),
              partial: message,
            });
            stream.push({
              type: "toolcall_end",
              contentIndex: callIndex,
              toolCall: toolCallBlock,
              partial: message,
            });
            break;
          }

          case "finish-step": {
            const usageObj = isRecord(event.usage) ? event.usage : event;
            if (typeof usageObj.inputTokens === "number") {
              message.usage.input = usageObj.inputTokens;
            }
            if (typeof usageObj.outputTokens === "number") {
              message.usage.output = usageObj.outputTokens;
            }
            break;
          }

          case "finish": {
            const rawUsage = (isRecord(event.totalUsage) ? event.totalUsage : isRecord(event.usage) ? event.usage : {}) as Record<string, unknown>;
            const inputTokens = typeof rawUsage.inputTokens === "number" ? rawUsage.inputTokens : message.usage.input;
            const outputTokens = typeof rawUsage.outputTokens === "number" ? rawUsage.outputTokens : message.usage.output;
            const cacheRead = typeof (rawUsage.inputTokenDetails as Record<string, unknown> | undefined)?.cacheReadTokens === "number"
              ? (rawUsage.inputTokenDetails as Record<string, unknown>).cacheReadTokens as number
              : 0;

            message.usage.input = inputTokens;
            message.usage.output = outputTokens;
            message.usage.cacheRead = cacheRead;
            message.usage.totalTokens = inputTokens + outputTokens;

            // Compute estimated costs
            const costRate = model.cost;
            const inputCost = (inputTokens / 1_000_000) * costRate.input;
            const outputCost = (outputTokens / 1_000_000) * costRate.output;
            const cacheCost = (cacheRead / 1_000_000) * costRate.cacheRead;
            message.usage.cost = {
              input: inputCost,
              output: outputCost,
              cacheRead: cacheCost,
              cacheWrite: 0,
              total: inputCost + outputCost + cacheCost,
            };

            // Close any open text or thinking blocks
            if (currentTextBlock && currentTextIndex >= 0) {
              stream.push({
                type: "text_end",
                contentIndex: currentTextIndex,
                content: currentTextBlock.text,
                partial: message,
              });
              currentTextBlock = null;
            }
            if (currentThinkingBlock && currentThinkingIndex >= 0) {
              stream.push({
                type: "thinking_end",
                contentIndex: currentThinkingIndex,
                content: currentThinkingBlock.thinking,
                partial: message,
              });
              currentThinkingBlock = null;
            }

            const rawFinish = event.finishReason ?? event.rawFinishReason ?? "stop";
            const finalReason = mapFinishReason(rawFinish, hasToolCalls);
            message.stopReason = finalReason;

            stream.push({ type: "done", reason: finalReason, message });
            return;
          }
        }
      }

      // If stream ended without an explicit finish event
      if (currentTextBlock && currentTextIndex >= 0) {
        stream.push({
          type: "text_end",
          contentIndex: currentTextIndex,
          content: currentTextBlock.text,
          partial: message,
        });
      }
      if (currentThinkingBlock && currentThinkingIndex >= 0) {
        stream.push({
          type: "thinking_end",
          contentIndex: currentThinkingIndex,
          content: currentThinkingBlock.thinking,
          partial: message,
        });
      }

      if (message.content.length > 0) {
        const finalReason = mapFinishReason("stop", hasToolCalls);
        message.stopReason = finalReason;
        stream.push({ type: "done", reason: finalReason, message });
      } else {
        message.stopReason = "error";
        message.errorMessage = "Stream completed without producing any content";
        stream.push({ type: "error", reason: "error", error: message });
      }
    } catch (err) {
      message.stopReason = "error";
      message.errorMessage = err instanceof Error ? err.message : String(err);
      stream.push({ type: "error", reason: "error", error: message });
    } finally {
      clearTimeout(timeoutTimer);
    }
  })();

  return stream;
}
