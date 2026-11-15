/**
 * Type declarations for Command Code Go provider extension.
 * Compatible with Oh My Pi (OMP) and Pi coding agent host environments.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}


export type JsonValue = null | boolean | number | string | readonly JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };

export type StopReason = "stop" | "length" | "toolUse" | "deferred";
export type ErrorReason = "error" | "aborted";
export type TerminalReason = StopReason | ErrorReason;

export interface UsageCost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cacheWrite1h?: number;
  totalTokens: number;
  /**
   * Provider-reported prompt occupancy in tokens, including cached input.
   * Hosts anchor the context gauge on this when present instead of
   * re-adding `input + cacheRead + cacheWrite`.
   */
  contextTokens?: number;
  cost: UsageCost;
}

export interface TextContent {
  type: "text";
  text: string;
}

export interface ThinkingContent {
  type: "thinking";
  thinking: string;
}

export interface ToolCallContent {
  type: "toolCall";
  id: string;
  name: string;
  arguments: JsonObject;
}

export type AssistantContent = TextContent | ThinkingContent | ToolCallContent;

export interface AssistantMessageLike {
  role: "assistant";
  content: AssistantContent[];
  api: string;
  provider: string;
  model: string;
  usage: Usage;
  stopReason: TerminalReason | "pending";
  errorMessage?: string;
  timestamp: number;
}

export type AssistantMessageEvent =
  | { type: "start"; partial: AssistantMessageLike }
  | { type: "text_start"; contentIndex: number; partial: AssistantMessageLike }
  | { type: "text_delta"; contentIndex: number; delta: string; partial: AssistantMessageLike }
  | { type: "text_end"; contentIndex: number; content: string; partial: AssistantMessageLike }
  | { type: "thinking_start"; contentIndex: number; partial: AssistantMessageLike }
  | { type: "thinking_delta"; contentIndex: number; delta: string; partial: AssistantMessageLike }
  | { type: "thinking_end"; contentIndex: number; content: string; partial: AssistantMessageLike }
  | { type: "toolcall_start"; contentIndex: number; partial: AssistantMessageLike }
  | { type: "toolcall_delta"; contentIndex: number; delta: string; partial: AssistantMessageLike }
  | { type: "toolcall_end"; contentIndex: number; toolCall: ToolCallContent; partial: AssistantMessageLike }
  | { type: "done"; reason: StopReason; message: AssistantMessageLike }
  | { type: "error"; reason: ErrorReason; error: AssistantMessageLike };

export interface AssistantMessageEventStreamLike extends AsyncIterable<AssistantMessageEvent> {
  push(event: AssistantMessageEvent): void;
  end(result?: AssistantMessageLike): void;
  result(): Promise<AssistantMessageLike>;
}

export interface ModelCostRates {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ModelCostTier extends ModelCostRates {
  inputTokensAbove: number;
}

export interface ModelCost extends ModelCostRates {
  tiers?: readonly ModelCostTier[];
}

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type ThinkingLevelMap = Partial<Record<ThinkingLevel, string | null>>;

export interface CommandCodeGoModel {
  id: string;
  wireId?: string;
  name: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  efforts?: readonly string[];
  thinking?: {
    mode: "effort";
    efforts: readonly string[];
    defaultLevel?: string;
  };
  thinkingLevelMap?: ThinkingLevelMap;
  input?: readonly string[];
  cost: ModelCost;
  toolCall?: boolean;
}

export interface MessageLike {
  role: string;
  content?: unknown;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
}

export interface ToolLike {
  name: string;
  description?: string;
  parameters?: unknown;
}

export interface ContextLike {
  systemPrompt?: string | string[];
  messages?: readonly MessageLike[];
  tools?: readonly ToolLike[];
}

export interface StreamOptions<TReasoning extends string = string> {
  apiKey?: string;
  signal?: AbortSignal;
  headers?: Record<string, string | null>;
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  maxTokens?: number;
  temperature?: number;
  sessionId?: string;
  reasoning?: TReasoning;
  timeoutMs?: number;
}

export interface ProviderModelConfig {
  id: string;
  name: string;
  api?: string;
  reasoning?: boolean;
  thinking?: { mode: string; efforts?: readonly string[]; defaultLevel?: string };
  thinkingLevelMap?: ThinkingLevelMap;
  input?: readonly string[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: ModelCost;
  compat?: Record<string, unknown>;
}

export interface ProviderConfig {
  name: string;
  baseUrl: string;
  apiKey?: string;
  api: string;
  streamSimple: (
    model: CommandCodeGoModel,
    context: ContextLike,
    options?: StreamOptions
  ) => AssistantMessageEventStreamLike;
  models: ProviderModelConfig[];
  headers?: Record<string, string>;
  fetchDynamicModels?: () => Promise<ProviderModelConfig[]>;
  refreshModels?: () => Promise<ProviderModelConfig[]>;
  oauth?: {
    name: string;
    login: (callbacks: {
      onAuth?: (params: { url: string }) => void;
      onPrompt: (params: { message: string }) => Promise<string>;
    }) => Promise<{ refresh: string; access: string; expires: number }>;
    refreshToken?: (credentials: { refresh: string; access: string; expires: number }) => Promise<{
      refresh: string;
      access: string;
      expires: number;
    }>;
    getApiKey: (credentials: { refresh: string; access: string; expires: number }) => string;
  };
}

export interface ExtensionContext {
  model?: { provider: string; id: string; api?: string };
  ui?: { notify: (message: string, level?: "info" | "warning" | "error") => void };
  modelRegistry?: {
    find: (provider: string, id: string) => ProviderModelConfig | undefined;
  };
}

export interface ExtensionAPI {
  registerProvider(name: string, config: ProviderConfig): void;
  registerCommand?(
    name: string,
    spec: { description?: string; handler: (args: string, ctx: ExtensionContext) => Promise<void> | void }
  ): void;
  on?(event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown): void;
  setModel?(model: ProviderModelConfig): Promise<void>;
}
