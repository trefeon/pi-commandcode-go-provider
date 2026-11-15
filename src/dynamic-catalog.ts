import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveApiKey } from "./auth.js";
import { COMMAND_CODE_GO_MODELS, registerCatalogModels } from "./catalog.js";
import { clampMaxTokens, CLI_VERSION, MAX_OUTPUT_TOKENS } from "./protocol.js";
import type { CommandCodeGoModel, ModelCost } from "./types.js";
import { isRecord } from "./types.js";

const DEFAULT_MODELS_URL = "https://api.commandcode.ai/provider/v1/models?view=client";
const TIMEOUT_MS = 20_000;
/** Catalog tier whose rows the $1/mo Go plan may actually run. */
const GO_PLAN = "individual-go";
/** Cache layout marker: older versions held stale plan/metadata rows, so they are discarded. */
const CACHE_VERSION = 3;

const KNOWN_EFFORTS: readonly string[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

interface CachedCatalogFile {
  version: number;
  models: CommandCodeGoModel[];
}

interface RawCatalogModel {
  id: string;
  name?: string;
  hidden?: boolean;
  minimumPlan?: string;
  context_length?: number;
  maxOutputTokens?: number | null;
  inputModalities?: string[];
  reasoningEfforts?: string[] | null;
  pricing?: { inputCost?: number; outputCost?: number; cacheReadCost?: number };
  display?: { label?: string };
}

function getCachePath(): string {
  const agentDir = join(homedir(), ".omp", "agent");
  if (!existsSync(agentDir)) {
    try {
      mkdirSync(agentDir, { recursive: true });
    } catch {
      // Ignore directory creation errors
    }
  }
  return join(agentDir, "commandcode-go-catalog.json");
}

function isModel(value: unknown): value is CommandCodeGoModel {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.contextWindow === "number" &&
    typeof value.maxTokens === "number" &&
    typeof value.reasoning === "boolean" &&
    isRecord(value.cost)
  );
}

export function loadCachedCatalog(): CommandCodeGoModel[] {
  const cachePath = getCachePath();
  try {
    if (existsSync(cachePath)) {
      const parsed: unknown = JSON.parse(readFileSync(cachePath, "utf-8"));
      if (isRecord(parsed) && parsed.version === CACHE_VERSION && Array.isArray(parsed.models)) {
        const models = parsed.models.filter(isModel);
        if (models.length > 0) return models;
      }
    }
  } catch {
    // Ignore cache read errors
  }
  return COMMAND_CODE_GO_MODELS;
}

export function saveCachedCatalog(models: CommandCodeGoModel[]): void {
  const cachePath = getCachePath();
  try {
    const payload: CachedCatalogFile = { version: CACHE_VERSION, models };
    writeFileSync(cachePath, JSON.stringify(payload, null, 2), "utf-8");
  } catch {
    // Ignore cache write errors
  }
}

/** Bare, CLI-friendly alias for an exact upstream id (`vendor/model` → `model`). */
function cleanModelId(rawId: string): string {
  const id = rawId.trim();
  const bare = id.includes("/") ? id.split("/").slice(1).join("/") : id;
  // Lowercase and `:free` → `-free`: CLI-friendly, filesystem-safe aliases.
  return bare.toLowerCase().replace(/:/g, "-");
}

function toEfforts(raw: RawCatalogModel): string[] {
  if (!Array.isArray(raw.reasoningEfforts)) return [];
  const seen = new Set<string>();
  for (const level of raw.reasoningEfforts) {
    if (typeof level !== "string") continue;
    const normalized = level.trim().toLowerCase();
    if (KNOWN_EFFORTS.includes(normalized)) seen.add(normalized);
  }
  return [...seen];
}

function toCost(raw: RawCatalogModel): ModelCost {
  const pricing = raw.pricing ?? {};
  return {
    input: typeof pricing.inputCost === "number" ? pricing.inputCost : 0,
    output: typeof pricing.outputCost === "number" ? pricing.outputCost : 0,
    cacheRead: typeof pricing.cacheReadCost === "number" ? pricing.cacheReadCost : 0,
    cacheWrite: 0,
  };
}

function toDynamicModel(raw: RawCatalogModel): CommandCodeGoModel | undefined {
  if (typeof raw.id !== "string" || raw.id.trim().length === 0) return undefined;
  if (raw.hidden === true) return undefined;
  if (raw.minimumPlan !== GO_PLAN) return undefined;

  const wireId = raw.id.trim();
  const id = cleanModelId(wireId);
  if (!id) return undefined;

  const efforts = toEfforts(raw);
  const contextWindow =
    typeof raw.context_length === "number" && raw.context_length > 0 ? raw.context_length : 1_000_000;
  const declaredMax =
    typeof raw.maxOutputTokens === "number" ? raw.maxOutputTokens : MAX_OUTPUT_TOKENS;
  const defaultLevel = efforts.includes("high")
    ? "high"
    : (efforts.find((level) => level !== "off") ?? undefined);
  const modalities = Array.isArray(raw.inputModalities)
    ? raw.inputModalities.filter((m) => m === "text" || m === "image")
    : [];

  return {
    id,
    wireId,
    name: raw.display?.label ?? raw.name ?? `${id} (Go)`,
    contextWindow,
    maxTokens: clampMaxTokens(declaredMax),
    reasoning: true,
    ...(efforts.length > 0
      ? { efforts, thinking: { mode: "effort" as const, efforts, defaultLevel } }
      : {}),
    input: modalities.length > 0 ? modalities : ["text"],
    toolCall: true,
    cost: toCost(raw),
  };
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** True when the cached catalog was written recently enough to skip a fetch. */
function cacheIsFresh(): boolean {
  try {
    const stats = statSync(getCachePath());
    return Date.now() - stats.mtimeMs < CACHE_TTL_MS;
  } catch {
    return false;
  }
}

/**
 * Fetches the authoritative catalog, keeping only models the Go plan can run.
 * Static entries win on collision so curated metadata survives; cached dynamic
 * rows from earlier refreshes are preserved. Pass `force` to bypass the TTL.
 */
export async function refreshCatalog(force = false): Promise<{
  models: CommandCodeGoModel[];
  newCount: number;
}> {
  const apiKey = resolveApiKey();

  if (!force && cacheIsFresh()) {
    const cached = loadCachedCatalog();
    registerCatalogModels(cached);
    return { models: cached, newCount: 0 };
  }

  try {
    const res = await fetch(DEFAULT_MODELS_URL, {
      headers: {
        accept: "application/json",
        "x-command-code-version": CLI_VERSION,
        "user-agent": "cli",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      return { models: loadCachedCatalog(), newCount: 0 };
    }

    const payload: unknown = await res.json();
    if (!isRecord(payload) || !Array.isArray(payload.data)) {
      return { models: loadCachedCatalog(), newCount: 0 };
    }

    const currentModels = new Map<string, CommandCodeGoModel>();
    const registered = new Set<string>();
    for (const model of COMMAND_CODE_GO_MODELS) {
      currentModels.set(model.id, model);
      registered.add(model.id.toLowerCase());
      if (model.wireId) registered.add(model.wireId.toLowerCase());
      registered.add(cleanModelId(model.id).toLowerCase());
    }
    for (const model of loadCachedCatalog()) {
      if (currentModels.has(model.id)) continue;
      currentModels.set(model.id, model);
      registered.add(model.id.toLowerCase());
      if (model.wireId) registered.add(model.wireId.toLowerCase());
    }

    let newCount = 0;
    for (const entry of payload.data) {
      if (!isRecord(entry)) continue;
      const model = toDynamicModel(entry as unknown as RawCatalogModel);
      if (!model) continue;
      if (registered.has(model.id.toLowerCase()) || currentModels.has(model.id)) continue;
      if (model.wireId && registered.has(model.wireId.toLowerCase())) continue;
      currentModels.set(model.id, model);
      registered.add(model.id.toLowerCase());
      if (model.wireId) registered.add(model.wireId.toLowerCase());
      newCount++;
    }

    const merged = Array.from(currentModels.values());
    registerCatalogModels(merged);
    saveCachedCatalog(merged);
    return { models: merged, newCount };
  } catch {
    return { models: loadCachedCatalog(), newCount: 0 };
  }
}
