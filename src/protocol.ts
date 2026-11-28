import { isRecord, type ContextLike, type JsonObject, type MessageLike, type StreamOptions, type ToolLike } from "./types.js";
import { toWireModelId } from "./catalog.js";

export const DEFAULT_GATEWAY_URL = "https://api.commandcode.ai/alpha/generate";
export { getCliVersion } from "./version.js";
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
/** Extracts a JSON object from raw model text: fenced blocks, prose, or a partial delimiter. */
function parseJsonObjectLoose(raw: string): Record<string, unknown> | undefined {
  const direct = safeParseJson(raw);
  if (isRecord(direct)) return direct;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    const parsed = safeParseJson(fenced[1].trim());
    if (isRecord(parsed)) return parsed;
  }
  const start = raw.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < raw.length; index++) {
    const char = raw[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") depth++;
    else if (char === "}" && --depth === 0) {
      const parsed = safeParseJson(raw.slice(start, index + 1));
      return isRecord(parsed) ? parsed : undefined;
    }
  }
  return undefined;
}

/** Property names models use for an argument a host tool declares under another name. */
const PROPERTY_SYNONYMS: Record<string, readonly string[]> = {
  path: ["file_path", "filepath", "file", "filename", "target_file", "target_path", "uri", "location"],
  command: ["cmd", "shell_command", "shell", "script", "bash_command", "exec"],
  old_string: ["old_str", "old_text", "oldtext", "find", "original_text", "target_text"],
  new_string: ["new_str", "new_text", "newtext", "replace", "replacement", "replacement_text", "updated_text"],
  content: ["text", "data", "contents", "body", "file_content", "new_content"],
  pattern: ["query", "regex", "search_pattern", "needle"],
  code: ["source", "source_code"],
};

/** Keys that only describe intent and must never satisfy a required argument. */
const INTENT_KEYS = new Set(["i", "intent", "description", "reason", "thought", "explanation", "summary", "note", "label"]);

/** Tool names models emit for the primitive operations hosts declare. */
const TOOL_NAME_ALIASES: Record<string, string> = {
  read_file: "read",
  readfile: "read",
  file_read: "read",
  open_file: "read",
  view_file: "read",
  write_file: "write",
  writefile: "write",
  file_write: "write",
  create_file: "write",
  edit_file: "edit",
  replace_in_file: "edit",
  str_replace: "edit",
  str_replace_editor: "edit",
  apply_patch: "edit",
  run_command: "bash",
  execute_command: "bash",
  run_shell: "bash",
  shell_command: "bash",
  exec_command: "bash",
  search_files: "grep",
  ripgrep: "grep",
  find_files: "glob",
  list_files: "glob",
};

/** Case- and separator-insensitive form of a tool name. */
export function normalizeToolName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Resolves an upstream tool name to one the host actually declared. */
export function resolveDeclaredToolName(rawName: string, declared: Iterable<string>): string {
  const declaredSet = new Set(declared);
  if (declaredSet.has(rawName)) return rawName;
  const normalized = normalizeToolName(rawName);
  for (const name of declaredSet) {
    if (normalizeToolName(name) === normalized) return name;
  }
  const alias = TOOL_NAME_ALIASES[rawName.trim().toLowerCase()];
  return alias && declaredSet.has(alias) ? alias : rawName;
}

/**
 * Repairs malformed or concatenated tool arguments produced by reasoning models.
 * Handles smashed keys (e.g. "i string ... command": "ls"), wrapped inputs, and
 * schema-known synonyms such as `file_path` for a declared `path`.
 */
export function repairToolArguments(args: unknown, toolName?: string, schema?: unknown): JsonObject {
  let record: Record<string, unknown>;
  if (typeof args === "string") {
    const parsed = parseJsonObjectLoose(args);
    if (parsed) {
      record = { ...parsed };
    } else if (toolName === "bash" && args.trim().length > 0) {
      return { command: args.trim(), i: "Running shell command" };
    } else {
      return {};
    }
  } else if (isRecord(args)) {
    record = { ...args };
  } else {
    return {};
  }

  const declaredProps =
    isRecord(schema) && isRecord(schema.properties) ? Object.keys(schema.properties) : [];
  const declaredSet = new Set(declaredProps);
  const requiredProps =
    isRecord(schema) && Array.isArray(schema.required)
      ? schema.required.filter((prop): prop is string => typeof prop === "string")
      : [];
  const propSchema = (prop: string): Record<string, unknown> | undefined => {
    const properties = isRecord(schema) && isRecord(schema.properties) ? schema.properties : undefined;
    const node = properties?.[prop];
    return isRecord(node) ? node : undefined;
  };
  const accepts = (value: unknown, prop: string): boolean => {
    const type = propSchema(prop)?.type;
    if (type === "string") return typeof value === "string";
    if (type === "number" || type === "integer") return typeof value === "number";
    if (type === "boolean") return typeof value === "boolean";
    if (type === "array") return Array.isArray(value);
    if (type === "object") return isRecord(value);
    return true;
  };

  // Models sometimes wrap the real arguments in an `original`/`input`/`parameters`
  // (or similar) field, as an object or as JSON text. Unwrap repeatedly (bounded)
  // unless the wrapper name is itself an argument the tool declares.
  const wrapperKeys = ["original", "input", "parameters", "args", "arguments", "tool_input", "toolInput"];
  for (let depth = 0; depth < 4; depth++) {
    let unwrapped = false;
    for (const key of wrapperKeys) {
      if (declaredSet.has(key)) continue;
      const wrapped = record[key];
      const candidate = isRecord(wrapped)
        ? wrapped
        : typeof wrapped === "string"
          ? parseJsonObjectLoose(wrapped)
          : undefined;
      if (!isRecord(candidate)) continue;
      record = { ...candidate };
      unwrapped = true;
      break;
    }
    if (!unwrapped) break;
  }

  const repaired: Record<string, unknown> = {};
  const targetProps = declaredProps.length > 0 ? declaredProps : ["command", "path"];

  // Fused keys: models concatenate the intent and the real key
  // ("i string ... Mevcommand": "ls"). Prefer the longest property match and
  // keep the free text as the `i` intent when the tool declares one.
  for (const [key, value] of Object.entries(record)) {
    if (declaredSet.has(key)) {
      repaired[key] = value;
      continue;
    }
    const normalizedKey = normalizeToolName(key);
    let fusedProp: string | undefined;
    for (const prop of targetProps) {
      const normalizedProp = normalizeToolName(prop);
      if (normalizedProp.length < 3 || !normalizedKey.endsWith(normalizedProp)) continue;
      if (!fusedProp || normalizedProp.length > normalizeToolName(fusedProp).length) fusedProp = prop;
    }
    if (fusedProp && repaired[fusedProp] === undefined && accepts(value, fusedProp)) {
      repaired[fusedProp] = value;
      const looksFusedIntent =
        /^i[\s\t]|^i\s*string/i.test(key) || /(listing|reading|checking|searching|running)/i.test(key);
      if (looksFusedIntent && (declaredSet.size === 0 || declaredSet.has("i")) && !repaired.i) {
        const intent = key
          .replace(/^i\s+(?:string\s+)?/i, "")
          .replace(/[^\x20-\x7E]/g, " ")
          .replace(new RegExp(`(?:mev)?${fusedProp.replace(/[^a-z0-9]/gi, "")}$`, "i"), "")
          .trim();
        if (intent.length > 2) repaired.i = intent.slice(0, 150);
      }
      continue;
    }
    repaired[key] = value;
  }

  // Synonyms: `file_path` for a declared `path`, `cmd` for `command`, etc.
  // Never steal a name the tool declares itself.
  for (const prop of requiredProps) {
    if (repaired[prop] !== undefined) continue;
    for (const synonym of PROPERTY_SYNONYMS[prop] ?? []) {
      if (declaredSet.has(synonym) || !(synonym in repaired) || !accepts(repaired[synonym], prop)) continue;
      repaired[prop] = repaired[synonym];
      delete repaired[synonym];
      break;
    }
  }

  // One stray string value for a tool that requires exactly one string argument.
  if (requiredProps.length === 1 && repaired[requiredProps[0]] === undefined) {
    const entries = Object.entries(repaired);
    const only = entries[0];
    if (
      entries.length === 1 &&
      only &&
      !declaredSet.has(only[0]) &&
      !INTENT_KEYS.has(only[0].toLowerCase()) &&
      typeof only[1] === "string" &&
      accepts(only[1], requiredProps[0])
    ) {
      repaired[requiredProps[0]] = only[1];
      delete repaired[only[0]];
    }
  }

  if (toolName === "bash" && repaired.command && !repaired.i && (declaredSet.size === 0 || declaredSet.has("i"))) {
    repaired.i = "Running shell command";
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
    const loose = parseJsonObjectLoose(input);
    if (loose) {
      result = loose;
    } else {
      let text = input;
      let needsWrap = true;
      try {
        const parsed: unknown = JSON.parse(input);
        if (typeof parsed === "string") text = parsed;
        else needsWrap = false;
      } catch {
        // not JSON
      }
      // A string that opens like a JSON object but did not parse is malformed
      // tool input, not a shell command; let the host reject it so the model
      // retries instead of executing garbage.
      const brokenJsonObject = /^\s*\{\s*"/.test(text);
      if (needsWrap && !brokenJsonObject) {
        const wrapped = wrapBareStringRoot(text, schema);
        if (wrapped) result = wrapped;
      }
    }
  }

  return repairToolArguments(result, toolName, schema);
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

/**
 * One harness image block as the gateway's user-message image part.
 * Live probe on 2026-11-15: the gateway needs `mimeType`; `mediaType` silently
 * drops the image (model answered "White" for a solid-red PNG). Both a data URL
 * and raw base64 are accepted for `image`, so always send the canonical data URL.
 */
function toWireImagePart(block: Record<string, unknown>): Record<string, unknown> | undefined {
  const source = isRecord(block.source) ? block.source : undefined;
  const raw =
    block.data ??
    block.image ??
    (source?.type === "base64" ? source.data : undefined) ??
    (isRecord(block.image_url) ? block.image_url.url : undefined);
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  const mimeType = String(block.mimeType ?? block.mediaType ?? source?.media_type ?? "image/png");
  return {
    type: "image",
    image: raw.startsWith("data:") ? raw : `data:${mimeType};base64,${raw}`,
    mimeType,
  };
}

/** Every image block in a message, in wire form. */
function imagePartsOf(content: unknown): Record<string, unknown>[] {
  if (!Array.isArray(content)) return [];
  const parts: Record<string, unknown>[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    if (b.type !== "image" && b.type !== "image_url") continue;
    const part = toWireImagePart(b);
    if (part) parts.push(part);
  }
  return parts;
}

function serializeAssistant(message: MessageLike, toolSchemas?: Map<string, unknown>): Record<string, unknown> {
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
        input: coerceToolInput(safeParseJson(b.arguments ?? fnArgs), toolName, toolSchemas?.get(toolName)),
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
      } else if (b.type === "image" || b.type === "image_url") {
        const part = toWireImagePart(b);
        if (part) parts.push(part);
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

  // 2. Track tool names from assistant tool calls for tool results, the call
  // ids declared anywhere in the history, and the call ids that already have a
  // result.
  const toolNames = new Map<string, string>();
  const knownCallIds = new Set<string>();
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
        if (!isTc || !id) continue;
        knownCallIds.add(sanitizeToolCallId(String(id)));
        if (name) toolNames.set(sanitizeToolCallId(String(id)), String(name));
      }
    }
  }

  // 3. Serialize messages. Tool-result images are hoisted into one user turn
  // after the whole tool run: the gateway only carries image parts on user
  // turns, and an interleaved user turn would end tool-result collection.
  const toolSchemas = new Map<string, unknown>();
  for (const tool of context.tools ?? []) toolSchemas.set(tool.name, tool.parameters);
  const wireMessages: Record<string, unknown>[] = [];
  const deferredToolImages: Record<string, unknown>[] = [];
  const flushToolImages = () => {
    if (deferredToolImages.length === 0) return;
    wireMessages.push({ role: "user", content: deferredToolImages.splice(0) });
  };
  const pushToolResult = (message: MessageLike) => {
    const rec = message as unknown as Record<string, unknown>;
    const callId = sanitizeToolCallId(String(message.toolCallId ?? rec.tool_call_id ?? rec.id ?? ""));
    // A result whose call never appears in history makes the gateway 400.
    if (callId && !knownCallIds.has(callId)) return;
    for (const turn of serializeTool(message, toolNames)) {
      wireMessages.push(turn);
    }
    deferredToolImages.push(...imagePartsOf(message.content));
  };
  for (const message of messages) {
    switch (message.role) {
      case "system":
      case "developer": {
        const text = flattenText(message.content);
        if (text) system += (system ? "\n\n" : "") + text;
        break;
      }
      case "assistant": {
        flushToolImages();
        const turn = serializeAssistant(message, toolSchemas);
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
        pushToolResult(message);
        break;
      }
      default: {
        const rec = message as unknown as Record<string, unknown>;
        if (message.toolCallId || rec.tool_call_id || rec.toolCallId) {
          pushToolResult(message);
        } else {
          flushToolImages();
          for (const turn of serializeUser(message)) {
            wireMessages.push(turn);
          }
        }
        break;
      }
    }
  }
  // 4. Tools schema (matches official CLI toWireTools: name/description/input_schema only)
  flushToolImages();
  const wireTools = (context.tools ?? []).map((tool: ToolLike) => ({
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
  // The gateway injects a ~7.5K-token default system prompt when `params.system`
  // is missing; a space placeholder keeps the request neutral (CLI behavior).
  const wireSystem = system.trim().length > 0 ? system : " ";

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
    memory: null,
    taste: null,
    skills: null,
    permissionMode: "standard",
    mode: "agent",
    params: {
      model: wireModel,
      messages: wireMessages,
      tools: wireTools,
      system: wireSystem,
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
