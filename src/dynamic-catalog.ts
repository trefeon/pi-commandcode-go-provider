import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { COMMAND_CODE_GO_MODELS, resolveModel } from "./catalog.js";
import type { CommandCodeGoModel, ProviderModelConfig } from "./types.js";
import { isRecord } from "./types.js";

const DEFAULT_MODELS_URL = "https://api.commandcode.ai/provider/v1/models";
const TIMEOUT_MS = 20_000;

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

export function loadCachedCatalog(): CommandCodeGoModel[] {
  const cachePath = getCachePath();
  try {
    if (existsSync(cachePath)) {
      const raw = readFileSync(cachePath, "utf-8");
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed as CommandCodeGoModel[];
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
    writeFileSync(cachePath, JSON.stringify(models, null, 2), "utf-8");
  } catch {
    // Ignore cache write errors
  }
}

/**
 * Fetches the live public model listing from Command Code upstream
 * and merges any new models with our existing catalog.
 */
export async function refreshCatalog(): Promise<{
  models: CommandCodeGoModel[];
  newCount: number;
}> {
  try {
    const res = await fetch(DEFAULT_MODELS_URL, {
      headers: { accept: "application/json" },
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
    for (const m of COMMAND_CODE_GO_MODELS) {
      currentModels.set(m.id, m);
    }
    for (const m of loadCachedCatalog()) {
      currentModels.set(m.id, m);
    }

    let newCount = 0;
    for (const raw of payload.data) {
      if (!isRecord(raw) || typeof raw.id !== "string") continue;
      const id = raw.id.trim();
      if (!id) continue;

      if (!currentModels.has(id)) {
        const contextWindow =
          typeof raw.context_length === "number"
            ? raw.context_length
            : typeof raw.context_window === "number"
              ? raw.context_window
              : 1_000_000;

        const dynamicModel: CommandCodeGoModel = {
          id,
          name: typeof raw.name === "string" ? raw.name : `${id} (Go)`,
          contextWindow,
          maxTokens: 64_000,
          reasoning: true,
          input: ["text", "image"],
          toolCall: true,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        };
        currentModels.set(id, dynamicModel);
        newCount++;
      }
    }

    const merged = Array.from(currentModels.values());
    if (newCount > 0) {
      saveCachedCatalog(merged);
    }

    return { models: merged, newCount };
  } catch {
    return { models: loadCachedCatalog(), newCount: 0 };
  }
}
