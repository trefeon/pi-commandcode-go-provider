import { resolveApiKey } from "./auth.js";
import { isRecord } from "./types.js";

const BASE_URL = "https://api.commandcode.ai";
const TIMEOUT_MS = 15_000;

export interface QuotaInfo {
  email?: string;
  plan?: string;
  creditsRemaining?: number;
  creditsUsed?: number;
  fiveHourWindow?: {
    used: number;
    cap: number;
    resetAt?: string;
  };
  weeklyWindow?: {
    used: number;
    cap: number;
    resetAt?: string;
  };
  raw?: unknown;
}

export async function fetchQuota(apiKeyOverride?: string): Promise<QuotaInfo | undefined> {
  const apiKey = resolveApiKey(apiKeyOverride);
  if (!apiKey) return undefined;

  const headers = {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
    accept: "application/json",
    "x-command-code-version": "0.26.20",
    "user-agent": "cli",
  };

  try {
    const res = await fetch(`${BASE_URL}/alpha/billing/credits`, {
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) return undefined;
    const data: unknown = await res.json();
    if (!isRecord(data)) return undefined;

    const info: QuotaInfo = { raw: data };

    if (typeof data.plan === "string") info.plan = data.plan;

    const fiveHour = data["5h"] ?? data["5_hour"] ?? data.fiveHour;
    if (isRecord(fiveHour)) {
      info.fiveHourWindow = {
        used: typeof fiveHour.used === "number" ? fiveHour.used : 0,
        cap: typeof fiveHour.cap === "number" ? fiveHour.cap : 0,
        resetAt: typeof fiveHour.resetAt === "string" ? fiveHour.resetAt : undefined,
      };
    }

    const weekly = data.weekly ?? data.week;
    if (isRecord(weekly)) {
      info.weeklyWindow = {
        used: typeof weekly.used === "number" ? weekly.used : 0,
        cap: typeof weekly.cap === "number" ? weekly.cap : 0,
        resetAt: typeof weekly.resetAt === "string" ? weekly.resetAt : undefined,
      };
    }

    return info;
  } catch {
    return undefined;
  }
}
