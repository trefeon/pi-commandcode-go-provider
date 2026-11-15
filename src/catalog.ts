import { GENERATED_MODELS } from "./generated-catalog.js";
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

/**
 * Go-plan catalog: `src/generated-catalog.ts` is generated from Command Code's
 * public model catalog by `scripts/generate-catalog.ts` (Go rows only, visible,
 * `max_tokens` clamped to the gateway ceiling).
 */
export const COMMAND_CODE_GO_MODELS: CommandCodeGoModel[] = GENERATED_MODELS;

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
  "mistral/",
  "inclusionai/",
  "sakana/",
  "meituan/",
  "tencent/",
  "ornith/",
  "xai/",
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

/**
 * Registers lazily discovered models (cache or a live refresh) into the
 * resolution maps. Static entries always win on collision.
 */
export function registerCatalogModels(models: readonly CommandCodeGoModel[]): void {
  for (const model of models) {
    if (!MODELS_BY_ID.has(model.id)) {
      MODELS_BY_ID.set(model.id, model);
      MODELS_BY_NORMALIZED.set(normalizeModelId(model.id), model);
    }
    if (model.wireId && !MODELS_BY_ID.has(model.wireId)) {
      MODELS_BY_ID.set(model.wireId, model);
      MODELS_BY_NORMALIZED.set(normalizeModelId(model.wireId), model);
    }
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
    // Gateway ceiling; see MAX_OUTPUT_TOKENS in protocol.ts.
    maxTokens: 200_000,
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
