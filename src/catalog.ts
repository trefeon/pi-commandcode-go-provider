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

/** Reference compaction workload: the observed failure compacted a ~478K context into a ~2-8K summary. */
const COMPACT_INPUT_TOKENS = 500_000;
const COMPACT_OUTPUT_TOKENS = 8_000;

/** Effective per-token rate at `tokens`, honoring the model's tier ladder. */
function effectiveRate(model: CommandCodeGoModel, tokens: number, key: "input" | "output"): number {
  let rate = model.cost[key];
  const tiers = model.cost.tiers;
  if (tiers) {
    for (const tier of tiers) {
      if (tokens > tier.inputTokensAbove) rate = tier[key];
    }
  }
  return rate;
}

/** Deterministic compaction cost at the reference workload, in USD. */
function compactionCost(model: CommandCodeGoModel): number {
  const input = effectiveRate(model, COMPACT_INPUT_TOKENS, "input");
  const output = effectiveRate(model, COMPACT_OUTPUT_TOKENS, "output");
  return (COMPACT_INPUT_TOKENS / 1e6) * input + (COMPACT_OUTPUT_TOKENS / 1e6) * output;
}

/**
 * Deterministic compaction/handoff model, priced for the compaction workload
 * (whole context in, small summary out) from the upstream price list:
 *
 * 1. `contextWindow >= 1M` — the candidate must read an oversized context;
 *    that is the failure this fixes (a 256K session model refused a 478K
 *    handoff prompt).
 * 2. Paid rows only — `:free` upstream rows (id ends `-free`) are
 *    capacity-gated stealth previews and refuse under load; a failed
 *    compaction is the bug. Zero input cost on a non-free row means missing
 *    pricing data, not free, so it is excluded too.
 * 3. Cheapest tier-aware cost at the reference workload, then window, then
 *    id. Tiers matter: gpt-6-luna is 0.10/M base but 0.20/M above 272K
 *    (upstream `contextTiers`), and qwen3.7-flash's 0.03 flat rate is its
 *    <=32K tier — 0.20/M above 256K. Both lose to muse-spark-1.2-contributor
 *    (0.10/0.20 flat).
 *
 * omp resolves this reference before the session model; a withdrawn upstream
 * id degrades gracefully back to the session model.
 */
export function preferredCompactionModelId(): string {
  const bigEnough = COMMAND_CODE_GO_MODELS.filter((m) => m.contextWindow >= 1_000_000);
  const paid = bigEnough.filter((m) => !m.id.endsWith("-free") && m.cost.input > 0);
  const pool = paid.length > 0 ? paid : [...bigEnough].sort((a, b) => b.contextWindow - a.contextWindow);
  const sorted = pool.sort(
    (a, b) =>
      compactionCost(a) - compactionCost(b) ||
      b.contextWindow - a.contextWindow ||
      a.id.localeCompare(b.id),
  );
  return sorted[0]?.id ?? "deepseek-v4.1-flash";
}
