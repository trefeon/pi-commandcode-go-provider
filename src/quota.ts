import { resolveApiKey } from "./auth.js";
import { isRecord } from "./types.js";

const BASE_URL = "https://api.commandcode.ai";
const TIMEOUT_MS = 15_000;

export interface QuotaInfo {
  email?: string;
  plan?: string;
  /** Remaining monthly credit balance in USD (Go plan grants $10.00/mo). */
  creditsRemaining?: number;
  purchasedCredits?: number;
  freeCredits?: number;
  belowThreshold?: boolean;
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

/** Studio Overview totals for the current billing period (`GET /alpha/usage/summary`). */
export interface UsageSummary {
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  successRate?: number;
  totalTokens: number;
  totalTokensIn: number;
  totalTokensOut: number;
  /** Spend billed to monthly credits, USD — the "Monthly Limit" numerator. */
  totalMonthlyCredits: number;
  totalPurchasedCredits: number;
  totalFreeCredits: number;
  totalCost?: number;
  averageCost?: number;
  periodBasis?: string;
  periodStart?: string;
  raw?: unknown;
}

export interface UsageOverview {
  summary: UsageSummary;
  quota?: QuotaInfo;
  /** Monthly grant in USD: remaining balance + monthly-credit spend (Go plan: $10.00). */
  monthlyGrant?: number;
}

/** Upstream sends epoch milliseconds; accept ISO strings too. */
function normalizeResetAt(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  if (typeof value === "string" && value.length > 0) return value;
  return undefined;
}

/** GETs an /alpha JSON route; undefined on missing key, non-OK, or malformed body. */
async function fetchAlphaJson(path: string, apiKeyOverride?: string): Promise<Record<string, unknown> | undefined> {
  const apiKey = resolveApiKey(apiKeyOverride);
  if (!apiKey) return undefined;

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        accept: "application/json",
        "x-command-code-version": "0.26.20",
        "user-agent": "cli",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) return undefined;
    const data: unknown = await res.json();
    return isRecord(data) ? data : undefined;
  } catch {
    return undefined;
  }
}

export async function fetchQuota(apiKeyOverride?: string): Promise<QuotaInfo | undefined> {
  const data = await fetchAlphaJson("/alpha/billing/credits", apiKeyOverride);
  if (!data) return undefined;

  const info: QuotaInfo = { raw: data };

  if (typeof data.plan === "string") info.plan = data.plan;

  // Credit balance: Go plan grants $10.00 monthly credits; purchased and free
  // credits are add-on balances on top.
  const credits = isRecord(data.credits) ? data.credits : undefined;
  if (credits) {
    if (typeof credits.monthlyCredits === "number") info.creditsRemaining = credits.monthlyCredits;
    if (typeof credits.purchasedCredits === "number") info.purchasedCredits = credits.purchasedCredits;
    if (typeof credits.freeCredits === "number") info.freeCredits = credits.freeCredits;
    if (credits.belowThreshold === true) info.belowThreshold = true;
  }

  // Upstream nests rate windows under windowLimits; older shapes kept them top-level.
  const windowLimits = isRecord(data.windowLimits) ? data.windowLimits : undefined;
  const fiveHour =
    (windowLimits && isRecord(windowLimits.fiveHour) ? windowLimits.fiveHour : undefined) ??
    (isRecord(data["5h"]) ? data["5h"] : undefined) ??
    (isRecord(data["5_hour"]) ? data["5_hour"] : undefined) ??
    (isRecord(data.fiveHour) ? data.fiveHour : undefined);
  if (fiveHour) {
    info.fiveHourWindow = {
      used: typeof fiveHour.used === "number" ? fiveHour.used : 0,
      cap: typeof fiveHour.cap === "number" ? fiveHour.cap : 0,
      resetAt: normalizeResetAt(fiveHour.resetAt),
    };
  }

  const weekly =
    (windowLimits && isRecord(windowLimits.weekly) ? windowLimits.weekly : undefined) ??
    (isRecord(data.weekly) ? data.weekly : undefined) ??
    (isRecord(data.week) ? data.week : undefined);
  if (weekly) {
    info.weeklyWindow = {
      used: typeof weekly.used === "number" ? weekly.used : 0,
      cap: typeof weekly.cap === "number" ? weekly.cap : 0,
      resetAt: normalizeResetAt(weekly.resetAt),
    };
  }

  return info;
}

export async function fetchUsageSummary(apiKeyOverride?: string): Promise<UsageSummary | undefined> {
  const data = await fetchAlphaJson("/alpha/usage/summary", apiKeyOverride);
  if (!data) return undefined;

  const num = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isFinite(value) ? value : undefined;

  const totalRuns = num(data.totalCount);
  const totalTokens = num(data.totalTokens);
  if (totalRuns === undefined && totalTokens === undefined) return undefined;

  return {
    totalRuns: totalRuns ?? 0,
    completedRuns: num(data.completedCount) ?? 0,
    failedRuns: num(data.failedCount) ?? 0,
    successRate: num(data.successRate),
    totalTokens: totalTokens ?? 0,
    totalTokensIn: num(data.totalTokensIn) ?? 0,
    totalTokensOut: num(data.totalTokensOut) ?? 0,
    totalMonthlyCredits: num(data.totalMonthlyCredits) ?? num(data.totalCost) ?? 0,
    totalPurchasedCredits: num(data.totalPurchasedCredits) ?? 0,
    totalFreeCredits: num(data.totalFreeCredits) ?? 0,
    totalCost: num(data.totalCost),
    averageCost: num(data.averageCost),
    periodBasis: typeof data.periodBasis === "string" ? data.periodBasis : undefined,
    periodStart: typeof data.periodStart === "string" ? data.periodStart : undefined,
    raw: data,
  };
}

/** Studio-style overview: usage summary plus credit balance, fetched in parallel. */
export async function fetchUsageOverview(apiKeyOverride?: string): Promise<UsageOverview | undefined> {
  const [summary, quota] = await Promise.all([fetchUsageSummary(apiKeyOverride), fetchQuota(apiKeyOverride)]);
  if (!summary) return undefined;

  const overview: UsageOverview = { summary };
  if (quota) {
    overview.quota = quota;
    if (quota.creditsRemaining !== undefined) {
      overview.monthlyGrant = quota.creditsRemaining + summary.totalMonthlyCredits;
    }
  }
  return overview;
}
