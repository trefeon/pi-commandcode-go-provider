import { isRecord, type ContextLike, type JsonObject, type MessageLike, type StreamOptions, type ToolLike } from "./types.js";
import { toWireModelId } from "./catalog.js";

export const DEFAULT_GATEWAY_URL = "https://api.commandcode.ai/alpha/generate";
export const CLI_VERSION = "0.26.20";
export const DEFAULT_MAX_TOKENS = 64_000;
/** Hard upstream ceiling: `/alpha/generate` rejects params.max_tokens above this. */
export const MAX_OUTPUT_TOKENS = 200_000;

/** Clamps a requested output budget into the gateway-accepted range. */
export function clampMaxTokens(requested?: number): number {
  const value =
    typeof requested === "number" && Number.isFinite(requested)
      ? Math.floor(requested)
      : DEFAULT_MAX_TOKENS;
  if (value < 1) return 1;
  return Math.min(value, MAX_OUTPUT_TOKENS);
}

/**
 * Reads the ceiling out of a gateway validation error such as
 * `Too big: expected number to be <=200000 at "params.max_tokens"`.
 */
export function parseMaxTokensCap(detail: string): number | undefined {
  if (!/max_tokens/i.test(detail)) return undefined;
  const match = detail.match(/to be <=?\s*(\d+)/i) ?? detail.match(/maximum of\s*(\d+)/i);
  if (!match) return undefined;
  const cap = Number.parseInt(match[1], 10);
  return Number.isFinite(cap) && cap > 0 ? cap : undefined;
}

export const GATEWAY_EFFORTS: Record<string, string> = {
  off: "off",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
};

/** Whether a schema node already accepts an explicit `null`. */
function allowsNull(schema: unknown): boolean {
  if (!isRecord(schema)) return false;
  if (schema.type === "null") return true;
  if (Array.isArray(schema.type) && schema.type.includes("null")) return true;
  if (schema.const === null) return true;
  if (Array.isArray(schema.enum) && schema.enum.includes(null)) return true;
  return Array.isArray(schema.anyOf) && schema.anyOf.some(allowsNull);
}

/**
 * Drops null arguments that the model passed for optional fields.
 */
export function dropNullArguments(value: unknown, schema: unknown): unknown {
  if (Array.isArray(value)) {
    const items = isRecord(schema) ? schema.items : undefined;
    return value.map((entry) => dropNullArguments(entry, items));
  }
  if (!isRecord(value)) return value;
  const properties =
    isRecord(schema) && isRecord(schema.properties)
      ? (schema.properties as Record<string, unknown>)
      : undefined;
  const required = new Set(
    isRecord(schema) && Array.isArray(schema.required) ? schema.required : []
  );
  const dropped: Record<string, unknown> = {};
  for (const [name, entry] of Object.entries(value)) {
    if (entry === null) {
      const declared = properties?.[name];
      if (declared !== undefined && !required.has(name) && !allowsNull(declared)) continue;
    }
    dropped[name] = dropNullArguments(entry, properties?.[name]);
  }
  return dropped;
}
/**
 * Repairs malformed or concatenated tool arguments produced by reasoning models.
 * Handles cases where models smash keys (e.g. "i string ... command": "ls") or wrap inputs.
 */
export function repairToolArguments(args: unknown, toolName?: string): JsonObject {
  let record: Record<string, unknown>;
  if (typeof args === "string") {
    try {
      record = JSON.parse(args);
    } catch {
      if (toolName === "bash") {
        return { command: args, i: "Running shell command" };
      }
      return {};
    }
  } else if (isRecord(args)) {
    record = { ...args };
  } else {
    return {};
  }

  // Models sometimes wrap the real arguments in an `original`/`input`/`parameters`
  // field, either as an object or as a JSON string. Unwrap repeatedly (bounded)
  // so `{original:{input:"{\"path\":...}"}}` still reaches the tool intact.
  for (let depth = 0; depth < 4; depth++) {
    let unwrapped = false;
    for (const key of ["original", "input", "parameters"] as const) {
      const wrapped = record[key];
      const candidate = isRecord(wrapped) ? wrapped : typeof wrapped === "string" ? safeParseJson(wrapped) : undefined;
      if (!isRecord(candidate)) continue;
      record = { ...candidate };
      unwrapped = true;
      break;
    }
    if (!unwrapped) break;
  }

  const repaired: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    const lowerKey = key.toLowerCase();

    // Detect smashed bash keys (e.g. "i string ... command", "...mevcommand")
    if (lowerKey.includes("command") && !repaired.command) {
      repaired.command = value;
      if (
        lowerKey.startsWith("i ") ||
        lowerKey.startsWith("i\t") ||
        lowerKey.startsWith("i string") ||
        lowerKey.includes("listing") ||
        lowerKey.includes("reading") ||
        lowerKey.includes("checking")
      ) {
        const intent = key
          .replace(/^i\s+(?:string\s+)?/i, "")
          .replace(/(?:mev)?command$/i, "")
          .replace(/[^\x20-\x7E]/g, " ")
          .trim();
        if (intent && !repaired.i) {
          repaired.i = intent.slice(0, 150);
        }
      }
      continue;
    }

    // Detect smashed path keys (e.g. "i string ... path")
    if (lowerKey.includes("path") && !repaired.path) {
      repaired.path = value;
      if (lowerKey.startsWith("i ") || lowerKey.startsWith("i\t") || lowerKey.startsWith("i string")) {
        const intent = key
          .replace(/^i\s+(?:string\s+)?/i, "")
          .replace(/path$/i, "")
          .replace(/[^\x20-\x7E]/g, " ")
          .trim();
        if (intent && !repaired.i) {
          repaired.i = intent.slice(0, 150);
        }
      }
      continue;
    }

    repaired[key] = value;
  }

  if (toolName === "bash") {
    if (!repaired.command && typeof record === "string") {
      repaired.command = record;
    }
    if (repaired.command && !repaired.i) {
      repaired.i = "Running shell command";
    }
  }

  return repaired as JsonObject;
}
/**
 * Matches official Command Code CLI's wrapBareStringRoot.
 * Wraps bare string returns into the single required root property if declared.
 */
function wrapBareStringRoot(text: string, schema: unknown): Record<string, unknown> | undefined {
  if (!isRecord(schema) || !isRecord(schema.properties)) return undefined;
  const required = schema.required;
  if (!Array.isArray(required) || required.length !== 1) return undefined;
  const rootProp = required[0];
  if (typeof rootProp !== "string") return undefined;
  const propSchema = schema.properties[rootProp];
  const isArray = isRecord(propSchema) && propSchema.type === "array";
  return {
    [rootProp]: isArray ? [text] : text,
  };
}

/**
 * Matches official Command Code CLI's coerceToolInput logic:
 * - Unwraps single-element arrays
 * - Parses JSON strings or wraps bare strings with wrapBareStringRoot
 * - Applies repairToolArguments for model hallucinations
 */
export function coerceToolInput(raw: unknown, toolName?: string, schema?: unknown): JsonObject {
  let input = raw;
  if (Array.isArray(raw) && raw.length === 1) {
    input = raw[0];
  }

  let result: Record<string, unknown> = {};

  if (isRecord(input)) {
    result = { ...input };
  } else if (typeof input === "string" && input.trim().length > 0) {
    let text = input;
    let needsWrap = true;
    try {
      const parsed: unknown = JSON.parse(input);
      if (isRecord(parsed)) {
        result = parsed;
        needsWrap = false;
      } else if (typeof parsed === "string") {
        text = parsed;
      } else {
        needsWrap = false;
      }
    } catch {
      // not JSON
    }

    if (needsWrap && Object.keys(result).length === 0) {
      const wrapped = wrapBareStringRoot(text, schema);
      if (wrapped) result = wrapped;
    }
  }

  return repairToolArguments(result, toolName);
}



export function sanitizeToolCallId(id: string): string {
  const head = id.includes("|") ? id.split("|")[0] : id;
  return head.length > 64 ? head.slice(0, 64) : head;
}

function safeParseJson(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function flattenText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) {
    if (content && typeof content === "object") {
      try {
        return JSON.stringify(content);
      } catch {
        return String(content);
      }
    }
    return "";
  }
  let text = "";
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const p = part as Record<string, unknown>;
    if (p.type === "text" && typeof p.text === "string") {
      text += p.text;
    } else if (typeof p.text === "string") {
      text += p.text;
    } else if (typeof p.content === "string") {
      text += p.content;
    }
  }
  return text;
}

function serializeAssistant(message: MessageLike): Record<string, unknown> {
  const parts: unknown[] = [];
  const content = Array.isArray(message.content)
    ? message.content
    : typeof message.content === "string"
      ? [{ type: "text", text: message.content }]
      : [];

  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    if (b.type === "text" && typeof b.text === "string") {
      parts.push({ type: "text", text: b.text });
    } else if ((b.type === "thinking" || b.type === "reasoning") && typeof (b.thinking ?? b.text) === "string") {
      parts.push({ type: "reasoning", text: b.thinking ?? b.text });
    } else if (
      b.type === "toolCall" ||
      b.type === "tool-call" ||
      b.type === "tool_call" ||
      b.function
    ) {
      const callId = sanitizeToolCallId(String(b.id ?? b.call_id ?? b.toolCallId ?? ""));
      const fnName = b.function && typeof b.function === "object" ? (b.function as Record<string, unknown>).name : undefined;
      const toolName = String(b.name ?? fnName ?? "unknown");
      const fnArgs = b.function && typeof b.function === "object" ? (b.function as Record<string, unknown>).arguments : undefined;
      parts.push({
        type: "tool-call",
        toolCallId: callId,
        toolName,
        input: safeParseJson(b.arguments ?? fnArgs),
      });
    }
  }
  return { role: "assistant", content: parts };
}

function serializeUser(message: MessageLike): Record<string, unknown>[] {
  if (typeof message.content === "string") {
    return [{ role: "user", content: message.content }];
  }
  if (Array.isArray(message.content)) {
    const parts: unknown[] = [];
    for (const block of message.content) {
      if (!block || typeof block !== "object") continue;
      const b = block as Record<string, unknown>;
      if (b.type === "text" && typeof b.text === "string") {
        parts.push({ type: "text", text: b.text });
      } else if (b.type === "image") {
        // Forward image part
        parts.push({
          type: "image",
          image: b.data ?? b.image,
          mimeType: b.mimeType ?? b.mediaType ?? "image/png",
        });
      }
    }
    if (parts.length === 0) return [];
    const isAllText = parts.every((p) => (p as Record<string, unknown>).type === "text");
    return [
      isAllText
        ? { role: "user", content: parts.map((p) => (p as Record<string, unknown>).text).join("") }
        : { role: "user", content: parts },
    ];
  }
  return [];
}

function serializeTool(
  message: MessageLike,
  toolNames: Map<string, string>
): Record<string, unknown>[] {
  const rec = message as unknown as Record<string, unknown>;
  const rawId = String(message.toolCallId ?? rec.tool_call_id ?? rec.id ?? "");
  const toolCallId = sanitizeToolCallId(rawId);
  const text = flattenText(message.content);
  const toolName = message.toolName ?? (rec.toolName as string) ?? (rec.name as string) ?? toolNames.get(toolCallId) ?? "unknown";
  return [
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId,
          toolName,
          output:
            message.isError === true
              ? { type: "error-text", value: text || "Execution denied" }
              : { type: "text", value: text || "(no output)" },
        },
      ],
    },
  ];
}

/**
 * Builds the complete Command Code Go `/alpha/generate` request envelope.
 */
export function buildRequest(
  modelId: string,
  context: ContextLike,
  options?: StreamOptions
): Record<string, unknown> {
  // 1. Fold system prompts
  let system = "";
  if (Array.isArray(context.systemPrompt)) {
    system = context.systemPrompt.join("\n\n");
  } else if (typeof context.systemPrompt === "string") {
    system = context.systemPrompt;
  }

  // 2. Track tool names from assistant tool calls for tool results, and the
  // call ids that already have a result anywhere in the history.
  const toolNames = new Map<string, string>();
  const answeredCalls = new Set<string>();
  const messages = context.messages ?? [];
  for (const message of messages) {
    const rec = message as unknown as Record<string, unknown>;
    const resultId = message.toolCallId ?? rec.tool_call_id ?? rec.id;
    if (message.role !== "assistant") {
      if (resultId) answeredCalls.add(sanitizeToolCallId(String(resultId)));
      continue;
    }
    if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if (!block || typeof block !== "object") continue;
        const b = block as Record<string, unknown>;
        const isTc =
          b.type === "toolCall" ||
          b.type === "tool-call" ||
          b.type === "tool_call" ||
          Boolean(b.function);
        const id = b.id ?? b.call_id ?? b.toolCallId;
        const fnName = b.function && typeof b.function === "object" ? (b.function as Record<string, unknown>).name : undefined;
        const name = b.name ?? fnName;
        if (isTc && id && name) {
          toolNames.set(sanitizeToolCallId(String(id)), String(name));
        }
      }
    }
  }

  // 3. Serialize messages
  const wireMessages: Record<string, unknown>[] = [];
  for (const message of messages) {
    switch (message.role) {
      case "system":
      case "developer": {
        const text = flattenText(message.content);
        if (text) system += (system ? "\n\n" : "") + text;
        break;
      }
      case "assistant": {
        const turn = serializeAssistant(message);
        wireMessages.push(turn);
        // The gateway rejects the whole request with "Tool results are missing
        // for tool calls ..." when an assistant turn has a call without a
        // result (aborted turn, dropped/compacted result). Record a synthetic
        // error result so the session stays usable instead of wedging.
        const parts = Array.isArray(turn.content) ? (turn.content as Array<Record<string, unknown>>) : [];
        for (const part of parts) {
          if (part.type !== "tool-call") continue;
          const callId = String(part.toolCallId ?? "");
          if (!callId || answeredCalls.has(callId)) continue;
          wireMessages.push({
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: callId,
                toolName: String(part.toolName ?? "unknown"),
                output: {
                  type: "error-text",
                  value: "Tool execution was interrupted before a result was recorded.",
                },
              },
            ],
          });
        }
        break;
      }
      case "tool":
      case "toolResult":
      case "tool_result": {
        for (const turn of serializeTool(message, toolNames)) {
          wireMessages.push(turn);
        }
        break;
      }
      default: {
        const rec = message as unknown as Record<string, unknown>;
        if (message.toolCallId || rec.tool_call_id || rec.toolCallId) {
          for (const turn of serializeTool(message, toolNames)) {
            wireMessages.push(turn);
          }
        } else {
          for (const turn of serializeUser(message)) {
            wireMessages.push(turn);
          }
        }
        break;
      }
    }
  }
  // 4. Tools schema transformation
  // 4. Tools schema (matches official CLI toWireTools without inflating with anyOf null hints)
  const wireTools = (context.tools ?? []).map((tool: ToolLike) => ({
    type: "function",
    name: tool.name,
    ...(tool.description ? { description: tool.description } : {}),
    input_schema: tool.parameters,
  }));

  // 5. Reasoning effort
  let reasoningEffort: string | undefined;
  if (options?.reasoning && GATEWAY_EFFORTS[options.reasoning.toLowerCase()]) {
    reasoningEffort = GATEWAY_EFFORTS[options.reasoning.toLowerCase()];
  }

  const wireModel = toWireModelId(modelId);

  return {
    config: {
      workingDir: process.cwd(),
      date: new Date().toISOString().split("T")[0],
      environment: `${process.platform}-${process.arch}`,
      structure: [],
      isGitRepo: false,
      currentBranch: "",
      mainBranch: "",
      gitStatus: "",
      recentCommits: [],
    },
    memory: "",
    taste: "",
    skills: null,
    permissionMode: "standard",
    params: {
      model: wireModel,
      messages: wireMessages,
      tools: wireTools,
      system,
      max_tokens: clampMaxTokens(options?.maxTokens),
      stream: true,
      ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    },
  };
}

export function parseEventLine(line: string): Record<string, unknown> | undefined {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.startsWith(":")) return undefined;
  // Strip optional SSE 'data: ' prefix if present
  const data = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed;
  if (!data || data === "[DONE]") return undefined;

  try {
    const parsed: unknown = JSON.parse(data);
    if (isRecord(parsed) && typeof parsed.type === "string") {
      return parsed;
    }
  } catch {
    // Non-JSON or incomplete line
  }
  return undefined;
}

/**
 * Parses line-delimited JSON byte stream from /alpha/generate.
 */
export async function* parseEventStream(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<Record<string, unknown>> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? "" : decoder.decode(value, { stream: true });
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        const event = parseEventLine(line);
        if (event !== undefined) yield event;
      }
      if (done) {
        if (buffer.trim().length > 0) {
          const event = parseEventLine(buffer);
          if (event !== undefined) yield event;
        }
        return;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function gatewayErrorDetail(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length === 0) return "Empty error response from Command Code gateway";
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (isRecord(parsed)) {
      const err = parsed.error;
      if (typeof err === "string") return err;
      if (isRecord(err)) {
        const msg = (typeof err.message === "string" && err.message.trim().length > 0 ? err.message.trim() : undefined)
          ?? (typeof err.detail === "string" && err.detail.trim().length > 0 ? err.detail.trim() : undefined);
        const code = typeof err.code === "string" && err.code.trim().length > 0 ? err.code.trim() : undefined;
        if (msg && code) return `${msg} [${code}]`;
        if (msg) return msg;
        if (code) return `Error code: ${code}`;
      }
    }
  } catch {
    // Plain text or HTML
  }
  return trimmed.slice(0, 1000);
}
