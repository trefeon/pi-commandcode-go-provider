import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Last known upstream `command-code` CLI version; bumped daily by CI (scripts/sync-cli-version.ts). */
export const FALLBACK_CLI_VERSION = "1.93.5";

export const NPM_LATEST_URL = "https://registry.npmjs.org/command-code/latest";
const TTL_MS = 6 * 60 * 60 * 1000;
const TIMEOUT_MS = 5_000;
const SEMVER = /^\d+\.\d+\.\d+$/;

const CACHE_PATH = join(fileURLToPath(new URL("..", import.meta.url)), ".cli-version-cache.json");

interface VersionCache {
  version: string;
  fetchedAt: number;
}

let memo: VersionCache | undefined;

function readCache(): VersionCache | undefined {
  if (memo) return memo;
  try {
    if (!existsSync(CACHE_PATH)) return undefined;
    const raw = JSON.parse(readFileSync(CACHE_PATH, "utf-8")) as Partial<VersionCache>;
    if (typeof raw.version === "string" && SEMVER.test(raw.version) && typeof raw.fetchedAt === "number") {
      memo = { version: raw.version, fetchedAt: raw.fetchedAt };
      return memo;
    }
  } catch {
    // corrupt cache: ignore
  }
  return undefined;
}

function compare(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

/** Sync: newest known version (cache or bundled fallback), never older than the fallback. */
export function getCliVersion(): string {
  const cached = readCache()?.version;
  return cached && compare(cached, FALLBACK_CLI_VERSION) > 0 ? cached : FALLBACK_CLI_VERSION;
}

/** Fetches the latest published CLI version from npm (6h TTL unless forced). Returns the version now in effect. */
export async function refreshCliVersion(force = false): Promise<string> {
  const cached = readCache();
  if (!force && cached && Date.now() - cached.fetchedAt < TTL_MS) return getCliVersion();
  try {
    const res = await fetch(NPM_LATEST_URL, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return getCliVersion();
    const body = (await res.json()) as { version?: unknown };
    if (typeof body.version === "string" && SEMVER.test(body.version)) {
      memo = { version: body.version, fetchedAt: Date.now() };
      try {
        writeFileSync(CACHE_PATH, JSON.stringify(memo), "utf-8");
      } catch {
        // read-only install dir: memory cache only
      }
    }
  } catch {
    // offline: keep current
  }
  return getCliVersion();
}
