import type { CommandCodeGoModel, ThinkingLevelMap } from "./types.js";

const DEFAULT_THINKING_LEVEL_MAP: ThinkingLevelMap = {
  off: "off",
  minimal: "low",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
};

const STANDARD_EFFORTS: readonly string[] = ["off", "low", "medium", "high", "xhigh", "max"];

export const COMMAND_CODE_GO_MODELS: CommandCodeGoModel[] = [
  // ── Free Models ($0.00) ──
  {
    id: "glyph-cluster-free",
    wireId: "stealth/glyph-cluster:free",
    name: "Glyph Cluster (Free)",
    contextWindow: 256_000,
    maxTokens: 131_072,
    reasoning: true,
    efforts: ["low", "medium", "high", "xhigh"],
    thinking: { mode: "effort", efforts: ["low", "medium", "high", "xhigh"], defaultLevel: "medium" },
    thinkingLevelMap: { off: "low", minimal: "low", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "xhigh" },
    input: ["text"],
    toolCall: true,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
  {
    id: "inkling-2-small-free",
    wireId: "thinkingmachines/inkling-2-small:free",
    name: "Inkling 2 Small (Free)",
    contextWindow: 1_000_000,
    maxTokens: 64_000,
    reasoning: false,
    input: ["text"],
    toolCall: true,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },

  // ── DeepSeek Models ──
  {
    id: "deepseek-v4.1-flash",
    wireId: "deepseek/deepseek-v4.1-flash",
    name: "DeepSeek V4.1 Flash (Go)",
    contextWindow: 1_000_000,
    maxTokens: 384_000,
    reasoning: true,
    efforts: ["off", "high", "max"],
    thinking: { mode: "effort", efforts: ["off", "high", "max"], defaultLevel: "high" },
    thinkingLevelMap: { off: "off", minimal: "high", low: "high", medium: "high", high: "high", xhigh: "max", max: "max" },
    input: ["text", "image"],
    toolCall: true,
    cost: { input: 0.15, output: 0.60, cacheRead: 0.003, cacheWrite: 0 },
  },
  {
    id: "deepseek-v4-pro",
    wireId: "deepseek/deepseek-v4-pro",
    name: "DeepSeek V4 Pro (Go)",
    contextWindow: 1_000_000,
    maxTokens: 384_000,
    reasoning: true,
    efforts: ["off", "high", "max"],
    thinking: { mode: "effort", efforts: ["off", "high", "max"], defaultLevel: "high" },
    thinkingLevelMap: { off: "off", minimal: "high", low: "high", medium: "high", high: "high", xhigh: "max", max: "max" },
    input: ["text", "image"],
    toolCall: true,
    cost: { input: 0.66, output: 1.98, cacheRead: 0.022, cacheWrite: 0 },
  },

  // ── Qwen Models ──
  {
    id: "qwen3.7-flash",
    wireId: "Qwen/Qwen3.7-Flash",
    name: "Qwen 3.7 Flash (Go)",
    contextWindow: 1_000_000,
    maxTokens: 131_072,
    reasoning: true,
    efforts: ["low", "medium", "high"],
    thinking: { mode: "effort", efforts: ["low", "medium", "high"], defaultLevel: "medium" },
    thinkingLevelMap: { off: "low", minimal: "low", low: "low", medium: "medium", high: "high", xhigh: "high", max: "high" },
    input: ["text", "image"],
    toolCall: true,
    cost: { input: 0.03, output: 0.13, cacheRead: 0.006, cacheWrite: 0.038 },
  },
  {
    id: "qwen3.7-plus",
    wireId: "Qwen/Qwen3.7-Plus",
    name: "Qwen 3.7 Plus (Go)",
    contextWindow: 1_000_000,
    maxTokens: 131_072,
    reasoning: true,
    efforts: ["low", "medium", "high", "xhigh"],
    thinking: { mode: "effort", efforts: ["low", "medium", "high", "xhigh"], defaultLevel: "medium" },
    thinkingLevelMap: { off: "low", minimal: "low", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "xhigh" },
    input: ["text", "image"],
    toolCall: true,
    cost: { input: 1.0, output: 4.0, cacheRead: 0.25, cacheWrite: 0 },
  },
  {
    id: "qwen3.7-max",
    wireId: "Qwen/Qwen3.7-Max",
    name: "Qwen 3.7 Max (Go)",
    contextWindow: 1_000_000,
    maxTokens: 131_072,
    reasoning: true,
    efforts: ["low", "medium", "high", "xhigh"],
    thinking: { mode: "effort", efforts: ["low", "medium", "high", "xhigh"], defaultLevel: "medium" },
    thinkingLevelMap: { off: "low", minimal: "low", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "xhigh" },
    input: ["text"],
    toolCall: true,
    cost: { input: 2.0, output: 8.0, cacheRead: 0.5, cacheWrite: 0 },
  },
  {
    id: "qwen3.6-plus",
    wireId: "Qwen/Qwen3.6-Plus",
    name: "Qwen 3.6 Plus (Go)",
    contextWindow: 1_000_000,
    maxTokens: 131_072,
    reasoning: true,
    efforts: ["low", "medium", "high"],
    thinking: { mode: "effort", efforts: ["low", "medium", "high"], defaultLevel: "medium" },
    thinkingLevelMap: { off: "low", minimal: "low", low: "low", medium: "medium", high: "high", xhigh: "high", max: "high" },
    input: ["text", "image"],
    toolCall: true,
    cost: { input: 0.8, output: 3.2, cacheRead: 0.2, cacheWrite: 0 },
  },
  {
    id: "qwen3.6-max-preview",
    wireId: "Qwen/Qwen3.6-Max-Preview",
    name: "Qwen 3.6 Max Preview (Go)",
    contextWindow: 1_000_000,
    maxTokens: 131_072,
    reasoning: true,
    efforts: ["low", "medium", "high"],
    thinking: { mode: "effort", efforts: ["low", "medium", "high"], defaultLevel: "medium" },
    thinkingLevelMap: { off: "low", minimal: "low", low: "low", medium: "medium", high: "high", xhigh: "high", max: "high" },
    input: ["text"],
    toolCall: true,
    cost: { input: 1.6, output: 6.4, cacheRead: 0.4, cacheWrite: 0 },
  },

  // ── GPT Family (OpenAI) ──
  {
    id: "gpt-6-luna",
    wireId: "gpt-6-luna",
    name: "GPT-6 Luna (Go)",
    contextWindow: 1_100_000,
    maxTokens: 128_000,
    reasoning: true,
    efforts: ["low", "medium", "high", "xhigh", "max"],
    thinking: { mode: "effort", efforts: ["low", "medium", "high", "xhigh", "max"], defaultLevel: "medium" },
    thinkingLevelMap: DEFAULT_THINKING_LEVEL_MAP,
    input: ["text", "image"],
    toolCall: true,
    cost: { input: 0.10, output: 0.50, cacheRead: 0.01, cacheWrite: 0.125 },
  },
  {
    id: "gpt-5.3-codex",
    wireId: "gpt-5.3-codex",
    name: "GPT-5.3 Codex (Go)",
    contextWindow: 400_000,
    maxTokens: 128_000,
    reasoning: true,
    efforts: STANDARD_EFFORTS,
    thinking: { mode: "effort", efforts: STANDARD_EFFORTS, defaultLevel: "medium" },
    thinkingLevelMap: DEFAULT_THINKING_LEVEL_MAP,
    input: ["text", "image"],
    toolCall: true,
    cost: { input: 2.0, output: 8.0, cacheRead: 0.5, cacheWrite: 0 },
  },
  {
    id: "gpt-5.4",
    wireId: "gpt-5.4",
    name: "GPT-5.4 (Go)",
    contextWindow: 400_000,
    maxTokens: 128_000,
    reasoning: true,
    efforts: STANDARD_EFFORTS,
    thinking: { mode: "effort", efforts: STANDARD_EFFORTS, defaultLevel: "medium" },
    thinkingLevelMap: DEFAULT_THINKING_LEVEL_MAP,
    input: ["text", "image"],
    toolCall: true,
    cost: { input: 2.5, output: 15.0, cacheRead: 0.25, cacheWrite: 0 },
  },
  {
    id: "gpt-5.4-mini",
    wireId: "gpt-5.4-mini",
    name: "GPT-5.4 Mini (Go)",
    contextWindow: 400_000,
    maxTokens: 128_000,
    reasoning: true,
    efforts: STANDARD_EFFORTS,
    thinking: { mode: "effort", efforts: STANDARD_EFFORTS, defaultLevel: "medium" },
    thinkingLevelMap: DEFAULT_THINKING_LEVEL_MAP,
    input: ["text", "image"],
    toolCall: true,
    cost: { input: 0.75, output: 4.5, cacheRead: 0.075, cacheWrite: 0 },
  },
  {
    id: "gpt-5.5",
    wireId: "gpt-5.5",
    name: "GPT-5.5 (Go)",
    contextWindow: 256_000,
    maxTokens: 128_000,
    reasoning: true,
    efforts: STANDARD_EFFORTS,
    thinking: { mode: "effort", efforts: STANDARD_EFFORTS, defaultLevel: "medium" },
    thinkingLevelMap: DEFAULT_THINKING_LEVEL_MAP,
    input: ["text", "image"],
    toolCall: true,
    cost: { input: 5.0, output: 30.0, cacheRead: 0.5, cacheWrite: 0 },
  },

  // ── Claude Family (Anthropic) ──
  {
    id: "claude-sonnet-5",
    wireId: "claude-sonnet-5",
    name: "Claude Sonnet 5 (Go)",
    contextWindow: 1_000_000,
    maxTokens: 65_536,
    reasoning: true,
    efforts: STANDARD_EFFORTS,
    thinking: { mode: "effort", efforts: STANDARD_EFFORTS, defaultLevel: "medium" },
    thinkingLevelMap: DEFAULT_THINKING_LEVEL_MAP,
    input: ["text", "image"],
    toolCall: true,
    cost: { input: 2.0, output: 10.0, cacheRead: 0.2, cacheWrite: 2.5 },
  },
  {
    id: "claude-sonnet-4-6",
    wireId: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6 (Go)",
    contextWindow: 1_000_000,
    maxTokens: 16_000,
    reasoning: true,
    efforts: STANDARD_EFFORTS,
    thinking: { mode: "effort", efforts: STANDARD_EFFORTS, defaultLevel: "medium" },
    thinkingLevelMap: DEFAULT_THINKING_LEVEL_MAP,
    input: ["text", "image"],
    toolCall: true,
    cost: { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 },
  },
  {
    id: "claude-opus-4-7",
    wireId: "claude-opus-4-7",
    name: "Claude Opus 4.7 (Go)",
    contextWindow: 1_000_000,
    maxTokens: 32_000,
    reasoning: true,
    efforts: STANDARD_EFFORTS,
    thinking: { mode: "effort", efforts: STANDARD_EFFORTS, defaultLevel: "medium" },
    thinkingLevelMap: DEFAULT_THINKING_LEVEL_MAP,
    input: ["text", "image"],
    toolCall: true,
    cost: { input: 5.0, output: 25.0, cacheRead: 0.5, cacheWrite: 6.25 },
  },
  {
    id: "claude-haiku-4-5-20251001",
    wireId: "claude-haiku-4-5-20251001",
    name: "Claude Haiku 4.5 (Go)",
    contextWindow: 200_000,
    maxTokens: 8_192,
    reasoning: false,
    input: ["text", "image"],
    toolCall: true,
    cost: { input: 1.0, output: 5.0, cacheRead: 0.1, cacheWrite: 1.25 },
  },

  // ── GLM Family ──
  {
    id: "glm-5.3-flash",
    wireId: "z-ai/glm-5.3-flash",
    name: "GLM-5.3 Flash (Go)",
    contextWindow: 1_000_000,
    maxTokens: 131_072,
    reasoning: true,
    efforts: ["low", "high", "max"],
    thinking: { mode: "effort", efforts: ["low", "high", "max"], defaultLevel: "high" },
    thinkingLevelMap: { off: "low", minimal: "low", low: "low", medium: "high", high: "high", xhigh: "max", max: "max" },
    input: ["text", "image"],
    toolCall: true,
    cost: { input: 0.15, output: 0.50, cacheRead: 0.03, cacheWrite: 0 },
  },
  {
    id: "glm-5.2",
    wireId: "zai-org/GLM-5.2",
    name: "GLM-5.2 (Go)",
    contextWindow: 1_000_000,
    maxTokens: 131_072,
    reasoning: true,
    efforts: ["high", "max"],
    thinking: { mode: "effort", efforts: ["high", "max"], defaultLevel: "high" },
    thinkingLevelMap: { off: "high", minimal: "high", low: "high", medium: "high", high: "high", xhigh: "max", max: "max" },
    input: ["text"],
    toolCall: true,
    cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 },
  },
  {
    id: "glm-5.1",
    wireId: "zai-org/GLM-5.1",
    name: "GLM-5.1 (Go)",
    contextWindow: 200_000,
    maxTokens: 131_072,
    reasoning: false,
    input: ["text"],
    toolCall: true,
    cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 },
  },
  {
    id: "glm-5",
    wireId: "zai-org/GLM-5",
    name: "GLM-5 (Go)",
    contextWindow: 200_000,
    maxTokens: 131_072,
    reasoning: false,
    input: ["text"],
    toolCall: true,
    cost: { input: 1.0, output: 3.2, cacheRead: 0.2, cacheWrite: 0 },
  },

  // ── Kimi Family ──
  {
    id: "kimi-k2.7-code",
    wireId: "moonshotai/Kimi-K2.7-Code",
    name: "Kimi K2.7 Code (Go)",
    contextWindow: 262_144,
    maxTokens: 131_072,
    reasoning: true,
    efforts: ["off", "high", "max"],
    thinking: { mode: "effort", efforts: ["off", "high", "max"], defaultLevel: "high" },
    thinkingLevelMap: { off: "off", minimal: "high", low: "high", medium: "high", high: "high", xhigh: "max", max: "max" },
    input: ["text", "image"],
    toolCall: true,
    cost: { input: 0.95, output: 4.0, cacheRead: 0.19, cacheWrite: 0 },
  },
  {
    id: "kimi-k2.7-code-highspeed",
    wireId: "moonshotai/Kimi-K2.7-Code-Highspeed",
    name: "Kimi K2.7 Code HighSpeed (Go)",
    contextWindow: 262_144,
    maxTokens: 131_072,
    reasoning: true,
    efforts: ["off", "high", "max"],
    thinking: { mode: "effort", efforts: ["off", "high", "max"], defaultLevel: "high" },
    thinkingLevelMap: { off: "off", minimal: "high", low: "high", medium: "high", high: "high", xhigh: "max", max: "max" },
    input: ["text", "image"],
    toolCall: true,
    cost: { input: 1.9, output: 8.0, cacheRead: 0.38, cacheWrite: 0 },
  },
  {
    id: "kimi-k2.6",
    wireId: "moonshotai/Kimi-K2.6",
    name: "Kimi K2.6 (Go)",
    contextWindow: 256_000,
    maxTokens: 131_072,
    reasoning: false,
    input: ["text", "image"],
    toolCall: true,
    cost: { input: 0.95, output: 4.0, cacheRead: 0.16, cacheWrite: 0 },
  },
  {
    id: "kimi-k2.5",
    wireId: "moonshotai/Kimi-K2.5",
    name: "Kimi K2.5 (Go)",
    contextWindow: 256_000,
    maxTokens: 131_072,
    reasoning: false,
    input: ["text", "image"],
    toolCall: true,
    cost: { input: 0.6, output: 3.0, cacheRead: 0.1, cacheWrite: 0 },
  },

  // ── MiniMax Family ──
  {
    id: "minimax-m3.1-flash",
    wireId: "minimax/minimax-m3.1-flash",
    name: "MiniMax M3.1 Flash (Go)",
    contextWindow: 1_000_000,
    maxTokens: 131_072,
    reasoning: true,
    efforts: ["low", "medium", "high"],
    thinking: { mode: "effort", efforts: ["low", "medium", "high"], defaultLevel: "medium" },
    thinkingLevelMap: { off: "low", minimal: "low", low: "low", medium: "medium", high: "high", xhigh: "high", max: "high" },
    input: ["text", "image"],
    toolCall: true,
    cost: { input: 0.15, output: 0.60, cacheRead: 0.015, cacheWrite: 0 },
  },
  {
    id: "minimax-m3",
    wireId: "MiniMaxAI/MiniMax-M3",
    name: "MiniMax M3 (Go)",
    contextWindow: 1_000_000,
    maxTokens: 524_288,
    reasoning: true,
    efforts: ["low", "medium", "high"],
    thinking: { mode: "effort", efforts: ["low", "medium", "high"], defaultLevel: "medium" },
    thinkingLevelMap: { off: "low", minimal: "low", low: "low", medium: "medium", high: "high", xhigh: "high", max: "high" },
    input: ["text", "image"],
    toolCall: true,
    cost: { input: 0.5, output: 2.0, cacheRead: 0.1, cacheWrite: 0 },
  },
  {
    id: "minimax-m2.7",
    wireId: "MiniMaxAI/MiniMax-M2.7",
    name: "MiniMax M2.7 (Go)",
    contextWindow: 1_000_000,
    maxTokens: 131_072,
    reasoning: false,
    input: ["text"],
    toolCall: true,
    cost: { input: 0.4, output: 1.6, cacheRead: 0.08, cacheWrite: 0 },
  },
  {
    id: "minimax-m2.5",
    wireId: "MiniMaxAI/MiniMax-M2.5",
    name: "MiniMax M2.5 (Go)",
    contextWindow: 200_000,
    maxTokens: 131_072,
    reasoning: false,
    input: ["text"],
    toolCall: true,
    cost: { input: 0.3, output: 1.2, cacheRead: 0.05, cacheWrite: 0 },
  },

  // ── MiMo Family ──
  {
    id: "mimo-v2.6-flash",
    wireId: "xiaomi/mimo-v2.6-flash",
    name: "MiMo V2.6 Flash (Go)",
    contextWindow: 1_000_000,
    maxTokens: 131_072,
    reasoning: true,
    efforts: ["low", "medium", "high"],
    thinking: { mode: "effort", efforts: ["low", "medium", "high"], defaultLevel: "medium" },
    thinkingLevelMap: { off: "low", minimal: "low", low: "low", medium: "medium", high: "high", xhigh: "high", max: "high" },
    input: ["text", "image"],
    toolCall: true,
    cost: { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 },
  },
  {
    id: "mimo-v2.5-pro",
    wireId: "xiaomi/mimo-v2.5-pro",
    name: "MiMo V2.5 Pro (Go)",
    contextWindow: 1_000_000,
    maxTokens: 131_072,
    reasoning: true,
    efforts: ["low", "medium", "high"],
    thinking: { mode: "effort", efforts: ["low", "medium", "high"], defaultLevel: "medium" },
    thinkingLevelMap: { off: "low", minimal: "low", low: "low", medium: "medium", high: "high", xhigh: "high", max: "high" },
    input: ["text", "image"],
    toolCall: true,
    cost: { input: 0.3, output: 1.2, cacheRead: 0.075, cacheWrite: 0 },
  },
  {
    id: "mimo-v2.5",
    wireId: "xiaomi/mimo-v2.5",
    name: "MiMo V2.5 (Go)",
    contextWindow: 1_000_000,
    maxTokens: 131_072,
    reasoning: true,
    efforts: ["low", "medium", "high"],
    thinking: { mode: "effort", efforts: ["low", "medium", "high"], defaultLevel: "medium" },
    thinkingLevelMap: { off: "low", minimal: "low", low: "low", medium: "medium", high: "high", xhigh: "high", max: "high" },
    input: ["text", "image"],
    toolCall: true,
    cost: { input: 0.15, output: 0.6, cacheRead: 0.035, cacheWrite: 0 },
  },

  // ── Step & Other Frontier Models ──
  {
    id: "muse-ember",
    wireId: "meta/muse-ember",
    name: "Muse Ember (Go)",
    contextWindow: 1_000_000,
    maxTokens: 64_000,
    reasoning: true,
    efforts: ["low", "medium", "high"],
    thinking: { mode: "effort", efforts: ["low", "medium", "high"], defaultLevel: "medium" },
    thinkingLevelMap: { off: "low", minimal: "low", low: "low", medium: "medium", high: "high", xhigh: "high", max: "high" },
    input: ["text"],
    toolCall: true,
    cost: { input: 0.10, output: 0.50, cacheRead: 0.004, cacheWrite: 0 },
  },
  {
    id: "step-3.7-flash",
    wireId: "stepfun/Step-3.7-Flash",
    name: "Step 3.7 Flash (Go)",
    contextWindow: 1_000_000,
    maxTokens: 131_072,
    reasoning: true,
    efforts: ["low", "medium", "high"],
    thinking: { mode: "effort", efforts: ["low", "medium", "high"], defaultLevel: "medium" },
    thinkingLevelMap: { off: "low", minimal: "low", low: "low", medium: "medium", high: "high", xhigh: "high", max: "high" },
    input: ["text", "image"],
    toolCall: true,
    cost: { input: 0.25, output: 1.0, cacheRead: 0.06, cacheWrite: 0 },
  },
  {
    id: "step-3.5-flash",
    wireId: "stepfun/Step-3.5-Flash",
    name: "Step 3.5 Flash (Go)",
    contextWindow: 1_000_000,
    maxTokens: 131_072,
    reasoning: true,
    efforts: ["low", "medium", "high"],
    thinking: { mode: "effort", efforts: ["low", "medium", "high"], defaultLevel: "medium" },
    thinkingLevelMap: { off: "low", minimal: "low", low: "low", medium: "medium", high: "high", xhigh: "high", max: "high" },
    input: ["text"],
    toolCall: true,
    cost: { input: 0.2, output: 0.8, cacheRead: 0.05, cacheWrite: 0 },
  },
  {
    id: "nemotron-3-ultra",
    wireId: "nvidia/nemotron-3-ultra",
    name: "Nemotron 3 Ultra (Go)",
    contextWindow: 1_000_000,
    maxTokens: 131_072,
    reasoning: true,
    efforts: ["low", "medium", "high"],
    thinking: { mode: "effort", efforts: ["low", "medium", "high"], defaultLevel: "medium" },
    thinkingLevelMap: { off: "low", minimal: "low", low: "low", medium: "medium", high: "high", xhigh: "high", max: "high" },
    input: ["text"],
    toolCall: true,
    cost: { input: 0.5, output: 2.0, cacheRead: 0.1, cacheWrite: 0 },
  },
];

const ALIAS_PREFIXES = [
  "deepseek/",
  "google/",
  "zai-org/",
  "z-ai/",
  "moonshotai/",
  "minimaxai/",
  "minimax/",
  "qwen/",
  "stepfun/",
  "xiaomi/",
  "nvidia/",
  "thinkingmachines/",
  "stealth/",
  "meta/",
];

function normalizeModelId(id: string): string {
  const trimmed = id.trim().toLowerCase();
  for (const prefix of ALIAS_PREFIXES) {
    if (trimmed.startsWith(prefix)) {
      return trimmed.slice(prefix.length);
    }
  }
  return trimmed;
}

const MODELS_BY_ID = new Map<string, CommandCodeGoModel>();
const MODELS_BY_NORMALIZED = new Map<string, CommandCodeGoModel>();

for (const model of COMMAND_CODE_GO_MODELS) {
  MODELS_BY_ID.set(model.id, model);
  MODELS_BY_NORMALIZED.set(normalizeModelId(model.id), model);

  if (model.wireId) {
    MODELS_BY_ID.set(model.wireId, model);
    MODELS_BY_NORMALIZED.set(normalizeModelId(model.wireId), model);
  }
}

// Additional legacy/common aliases mapping to current active models
const ALIAS_MAP: Record<string, string> = {
  "deepseek-v4-flash": "deepseek-v4.1-flash",
  "deepseek/deepseek-v4-flash": "deepseek-v4.1-flash",
  "gemini-3.5-flash": "qwen3.7-flash",
  "qwen-3.7-flash": "qwen3.7-flash",
};

for (const [alias, targetId] of Object.entries(ALIAS_MAP)) {
  const target = MODELS_BY_ID.get(targetId);
  if (target) {
    MODELS_BY_ID.set(alias, target);
    MODELS_BY_NORMALIZED.set(normalizeModelId(alias), target);
  }
}

/**
 * Resolves a model ID to its CommandCodeGoModel configuration.
 * If the model is not found in the static catalog, creates a safe dynamic fallback.
 */
export function resolveModel(id: string): CommandCodeGoModel {
  // 1. Exact match
  const exact = MODELS_BY_ID.get(id);
  if (exact) return exact;

  // 2. Normalized alias match
  const normalized = MODELS_BY_NORMALIZED.get(normalizeModelId(id));
  if (normalized) return normalized;

  // 3. Dynamic fallback for new/uncatalogued models
  return {
    id,
    name: `${id} (Go)`,
    contextWindow: 1_000_000,
    maxTokens: 64_000,
    reasoning: true,
    efforts: STANDARD_EFFORTS,
    thinking: { mode: "effort", efforts: STANDARD_EFFORTS, defaultLevel: "medium" },
    thinkingLevelMap: DEFAULT_THINKING_LEVEL_MAP,
    input: ["text", "image"],
    toolCall: true,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}

/**
 * Returns the wire model ID expected by upstream /alpha/generate.
 */
export function toWireModelId(id: string): string {
  const model = resolveModel(id);
  return model.wireId ?? model.id;
}
