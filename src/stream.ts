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
  resolveDeclaredToolName,
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
  Usage,
} from "./types.js";
import { isRecord } from "./types.js";

const DEFAULT_TIMEOUT_MS = 300_000;

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Maps the gateway's AI-SDK usage onto the host convention.
 *
 * Upstream `inputTokens` is the whole prompt (`noCacheTokens + cacheReadTokens
 * + cacheWriteTokens`). Hosts derive prompt occupancy as `input + cacheRead +
 * cacheWrite`, so `input` must hold the uncached remainder: storing the whole
 * prompt there counts every cache hit twice and inflates the context gauge
 * (a 570K-token prompt renders past 100% of a 1M window). `contextTokens` is
 * the provider-reported occupancy, which hosts prefer when anchoring the gauge.
 */
function applyGatewayUsage(
  rawUsage: Record<string, unknown>,
  usage: Usage,
  model: CommandCodeGoModel
): void {
  const details = isRecord(rawUsage.inputTokenDetails) ? rawUsage.inputTokenDetails : undefined;
  const inputTokens = finiteNumber(rawUsage.inputTokens) ?? usage.input + usage.cacheRead + usage.cacheWrite;
  const outputTokens = finiteNumber(rawUsage.outputTokens) ?? usage.output;
  const cacheRead = finiteNumber(details?.cacheReadTokens) ?? usage.cacheRead;
  const cacheWrite = finiteNumber(details?.cacheWriteTokens) ?? usage.cacheWrite;
  const uncachedInput = details ? Math.max(0, inputTokens - cacheRead - cacheWrite) : inputTokens;
  const costRate = model.cost;

  usage.input = uncachedInput;
  usage.output = outputTokens;
  usage.cacheRead = cacheRead;
  usage.cacheWrite = cacheWrite;
  usage.contextTokens = inputTokens;
  usage.totalTokens = inputTokens + outputTokens;

  const inputCost = (uncachedInput / 1_000_000) * costRate.input;
  const outputCost = (outputTokens / 1_000_000) * costRate.output;
  const cacheReadCost = (cacheRead / 1_000_000) * costRate.cacheRead;
  const cacheWriteCost = (cacheWrite / 1_000_000) * costRate.cacheWrite;
  usage.cost = {
    input: inputCost,
    output: outputCost,
    cacheRead: cacheReadCost,
    cacheWrite: cacheWriteCost,
    total: inputCost + outputCost + cacheReadCost + cacheWriteCost,
  };
}

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
    case "model_context_window_exceeded":
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
    // timeoutMs is the host's httpIdleTimeoutMs (Pi default 300s): it bounds the
    // gap between chunks, not total generation time. Re-arm on every raw chunk
    // so long, steadily-streaming reasoning turns are not cut off at timeoutMs.
    // Upstream reference: patlux/pi-commandcode-provider#87 → PR #88 (merged).
    let timeoutTimer: NodeJS.Timeout | undefined;
    const armTimeout = () => {
      clearTimeout(timeoutTimer);
      timeoutTimer = setTimeout(() => {
        controller.abort(new Error(`Command Code Go request timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    };
    armTimeout();

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
      let sawCompletion = false;
      let lastFinishReason: unknown = "stop";
      const closeOpenBlocks = () => {
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
      };
      // The gateway streams tool input as start/delta/end and also emits a final
      // `tool-call` with the parsed input. Keep the deltas so a final event that
      // omits (or empties) `input` still yields the model's arguments.
      const pendingToolInputs = new Map<string, string>();
      const pendingToolNames = new Map<string, string>();

      // Tools schema lookup for argument filtering and name resolution
      const toolSchemas = new Map<string, unknown>();
      const declaredToolNames = new Set<string>();
      for (const tool of context.tools ?? []) {
        toolSchemas.set(tool.name, tool.parameters);
        declaredToolNames.add(tool.name);
      }

      // Re-arm the idle timer on every raw chunk: parseEventStream may buffer
      // several lines per chunk, so chunk boundaries are the correct idle signal.
      const rawBody = response.body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, ctrl) {
            armTimeout();
            ctrl.enqueue(chunk);
          },
        })
      );
      for await (const event of parseEventStream(rawBody)) {
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

          case "tool-input-start": {
            const id = String(event.id ?? event.toolCallId ?? "");
            if (id) {
              pendingToolInputs.set(id, "");
              const name = event.toolName ?? event.name;
              if (typeof name === "string" && name.length > 0) pendingToolNames.set(id, name);
            }
            break;
          }

          case "tool-input-delta": {
            const id = String(event.id ?? event.toolCallId ?? "");
            const delta = typeof event.delta === "string" ? event.delta : "";
            if (id && delta.length > 0) {
              pendingToolInputs.set(id, (pendingToolInputs.get(id) ?? "") + delta);
            }
            break;
          }

          case "tool-input-end":
            break;

          case "tool-call": {
            hasToolCalls = true;
            const rawCallId = String(event.toolCallId ?? event.id ?? `call_${Date.now()}`);
            const callId = sanitizeToolCallId(rawCallId);
            const rawToolName = String(
              event.toolName ?? event.name ?? pendingToolNames.get(rawCallId) ?? "unknown"
            );
            const toolName = resolveDeclaredToolName(rawToolName, declaredToolNames);
            const assembled = pendingToolInputs.get(rawCallId);
            let rawArgs = event.input ?? event.args ?? event.arguments;
            if (assembled && (rawArgs === undefined || (isRecord(rawArgs) && Object.keys(rawArgs).length === 0))) {
              rawArgs = assembled;
            }
            pendingToolInputs.delete(rawCallId);
            pendingToolNames.delete(rawCallId);
            const schema = toolSchemas.get(toolName);
            const filteredArgs = dropNullArguments(rawArgs ?? {}, schema);
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
            sawCompletion = true;
            if (event.finishReason !== undefined) lastFinishReason = event.finishReason;
            applyGatewayUsage(isRecord(event.usage) ? event.usage : event, message.usage, model);
            break;
          }

          case "finish": {
            sawCompletion = true;
            const rawUsage = isRecord(event.totalUsage)
              ? event.totalUsage
              : isRecord(event.usage)
                ? event.usage
                : {};
            applyGatewayUsage(rawUsage, message.usage, model);

            const rawFinish = event.finishReason ?? event.rawFinishReason ?? "stop";
            lastFinishReason = rawFinish;
            const finishKey = typeof rawFinish === "string" ? rawFinish.trim().toLowerCase() : "";
            const providerFailure =
              finishKey === "error" || /^(?:network|connection|upstream)[-_\s]?error$/.test(finishKey);
            // Provider-side failure finishes are not business stop reasons: keep
            // partial content but report an error so the host can retry instead
            // of presenting a truncated answer as complete.
            if (providerFailure) {
              closeOpenBlocks();
              const errPayload = isRecord(event.error) ? event.error : undefined;
              message.stopReason = "error";
              message.errorMessage =
                (typeof errPayload?.message === "string" ? errPayload.message : undefined) ??
                (typeof event.message === "string" ? event.message : undefined) ??
                `Provider reported ${String(rawFinish)}`;
              stream.push({ type: "error", reason: "error", error: message });
              return;
            }

            closeOpenBlocks();

            const finalReason = mapFinishReason(rawFinish, hasToolCalls);
            message.stopReason = finalReason;

            stream.push({ type: "done", reason: finalReason, message });
            return;
          }
        }
      }

      closeOpenBlocks();

      if (!sawCompletion) {
        message.stopReason = "error";
        message.errorMessage =
          message.content.length > 0
            ? "Stream ended without a finish event from the Command Code gateway; response was truncated"
            : "Stream completed without producing any content";
        stream.push({ type: "error", reason: "error", error: message });
        return;
      }

      const finalReason = mapFinishReason(lastFinishReason, hasToolCalls);
      message.stopReason = finalReason;
      stream.push({ type: "done", reason: finalReason, message });
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
