/**
 * Usage provider feeding omp's native `/usage` dashboard for Command Code.
 *
 * Mirrors the wire schema of `@oh-my-pi/pi-ai` usage reports without importing
 * host internals (bare `@oh-my-pi/*` specifiers do not resolve from extension
 * directories). Reads the same account routes the official CLI uses:
 *   GET /alpha/whoami          — account identity (email shown per account)
 *   GET /alpha/billing/credits — 5h/weekly spend windows + credit balance
 *   GET /alpha/usage/summary   — billing-period spend (monthly limit numerator)
 *
 * The built-in omp fetcher (`pi-ai/src/usage/commandcode.ts`) renders only the
 * 5h/weekly windows and the balance; the monthly limit needs the credit grant,
 * which only `remaining + summary.totalMonthlyCredits` can derive. Registering
 * this provider under the built-in id `commandcode` overrides it per
 * omp://extensions.md ("extension usage provider overrides a built-in provider
 * with the same name").
 */

import { isRecord } from "./types.js";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Dashboard tag for a monthly window (`mo`); resetsAt drives the real countdown. */
const MONTH_TAG_MS = 30 * DAY_MS;

export const COMMANDCODE_BUILTIN_ID = "commandcode";
export const COMMANDCODE_GO_ID = "commandcode-go";

type UsageStatus = "ok" | "warning" | "exhausted" | "unknown";

export interface UsageScope {
	provider: string;
	accountId?: string;
	orgId?: string;
	windowId?: string;
	shared?: boolean;
}

export interface UsageWindow {
	id: string;
	label: string;
	durationMs?: number;
	resetsAt?: number;
	resetLabel?: string;
}

export interface UsageAmount {
	used?: number;
	limit?: number;
	remaining?: number;
	usedFraction?: number;
	remainingFraction?: number;
	unit: "percent" | "tokens" | "requests" | "credits" | "usd" | "minutes" | "bytes" | "unknown";
}

export interface UsageLimit {
	id: string;
	label: string;
	scope: UsageScope;
	window?: UsageWindow;
	amount: UsageAmount;
	status?: UsageStatus;
	notes?: string[];
}

export interface UsageReport {
	provider: string;
	fetchedAt: number;
	limits: UsageLimit[];
	notes?: string[];
	metadata?: Record<string, unknown>;
	raw?: unknown;
}

export interface UsageFetchParams {
	provider: string;
	credential: { type: string; apiKey?: string };
	baseUrl?: string;
	signal?: AbortSignal;
}

export interface UsageFetchContext {
	fetch: (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<Response>;
	logger?: { warn?: (message: string, fields?: Record<string, unknown>) => void };
}

export interface UsageProvider {
	id: string;
	cacheVersion?: number;
	fetchUsage(params: UsageFetchParams, ctx: UsageFetchContext): Promise<UsageReport | null>;
	supports?(params: UsageFetchParams): boolean;
	validatesCredentials?: boolean;
}

const DEFAULT_ORIGIN = "https://api.commandcode.ai";
/** Bumped past the built-in fetcher (no cacheVersion) so cached built-in reports never cross over. */
const CACHE_VERSION = 3;

function finiteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Epoch seconds or milliseconds; ISO strings via Date.parse. */
function parsePositiveTimestamp(value: unknown): number | undefined {
	const parsed =
		finiteNumber(value) ?? (typeof value === "string" && value ? Date.parse(value) : undefined);
	if (parsed === undefined || parsed <= 0 || !Number.isFinite(parsed)) return undefined;
	return parsed < 1_000_000_000_000 ? parsed * 1000 : parsed;
}

function usageStatus(usedFraction: number | undefined): UsageStatus {
	if (usedFraction === undefined) return "unknown";
	if (usedFraction >= 1) return "exhausted";
	if (usedFraction >= 0.9) return "warning";
	return "ok";
}

/** `https://host/alpha/generate` → `https://host`; unparseable overrides fall back to the default. */
function resolveOrigin(baseUrl: string | undefined): string {
	if (baseUrl) {
		try {
			return new URL(baseUrl).origin;
		} catch {
			// fall through to default
		}
	}
	return DEFAULT_ORIGIN;
}

/** Returns the unwrapped JSON body, null on any failure; only a 401 throws (revoked key). */
async function getJson(
	url: string,
	apiKey: string,
	signal: AbortSignal | undefined,
	ctx: UsageFetchContext,
): Promise<Record<string, unknown> | null> {
	try {
		const response = await ctx.fetch(url, {
			headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
			signal,
		});
		if (!response.ok) {
			if (response.status === 401) {
				throw new Error(`Command Code usage endpoint returned 401 for ${url}`);
			}
			ctx.logger?.warn?.("Command Code usage fetch failed", { url, status: response.status });
			return null;
		}
		const json: unknown = await response.json();
		if (!isRecord(json)) return null;
		return isRecord(json.data) ? json.data : json;
	} catch (error) {
		if (error instanceof Error && error.message.startsWith("Command Code usage endpoint returned 401")) throw error;
		ctx.logger?.warn?.("Command Code usage fetch error", { url, error: String(error) });
		return null;
	}
}

interface WindowSpec {
	key: "fiveHour" | "weekly";
	id: "5h" | "7d";
	limitLabel: string;
	windowLabel: string;
	durationMs: number;
}

const WINDOWS: readonly WindowSpec[] = [
	{ key: "fiveHour", id: "5h", limitLabel: "5-hour limit", windowLabel: "5-hour", durationMs: 5 * HOUR_MS },
	{ key: "weekly", id: "7d", limitLabel: "Weekly limit", windowLabel: "Weekly", durationMs: 7 * DAY_MS },
];

function buildWindowLimit(
	spec: WindowSpec,
	raw: unknown,
	providerId: string,
	accountId: string,
	orgId: string | undefined,
): UsageLimit | undefined {
	if (!isRecord(raw)) return undefined;
	const used = finiteNumber(raw.used);
	if (used === undefined) return undefined;
	const cap = finiteNumber(raw.cap);
	const usedFraction = cap !== undefined && cap > 0 ? used / cap : undefined;
	const resetsAt = parsePositiveTimestamp(raw.resetAt);
	// Absent fields are omitted, not set to `undefined`: the usage wire schema
	// rejects an explicit `undefined` for an optional key.
	return {
		id: `${providerId}:${spec.id}`,
		label: spec.limitLabel,
		scope: { provider: providerId, accountId, ...(orgId ? { orgId } : {}), windowId: spec.id, shared: true },
		window: {
			id: spec.id,
			label: spec.windowLabel,
			durationMs: spec.durationMs,
			...(resetsAt !== undefined ? { resetsAt } : {}),
		},
		amount: {
			used,
			...(cap !== undefined ? { limit: cap } : {}),
			...(usedFraction !== undefined ? { usedFraction } : {}),
			unit: "credits",
		},
		status: raw.exceeded === true ? "exhausted" : usageStatus(usedFraction),
	};
}

/** Monthly limit: spend from the billing-period summary against remaining + spend (the grant). */
function buildMonthlyLimit(
	summary: Record<string, unknown> | null,
	creditsRemaining: number | undefined,
	providerId: string,
	accountId: string,
	orgId: string | undefined,
): UsageLimit | undefined {
	if (!summary || creditsRemaining === undefined) return undefined;
	const monthlySpend = finiteNumber(summary.totalMonthlyCredits);
	if (monthlySpend === undefined) return undefined;

	const grant = creditsRemaining + monthlySpend;
	if (grant <= 0) return undefined;
	const usedFraction = monthlySpend / grant;

	let resetsAt: number | undefined;
	const periodStart = nonEmptyString(summary.periodStart);
	if (periodStart) {
		const start = new Date(periodStart);
		if (!Number.isNaN(start.getTime())) {
			start.setMonth(start.getMonth() + 1);
			resetsAt = start.getTime();
		}
	}

	return {
		id: `${providerId}:monthly`,
		label: "Monthly limit",
		scope: { provider: providerId, accountId, ...(orgId ? { orgId } : {}), windowId: "monthly", shared: true },
		window: {
			id: "monthly",
			label: "Monthly",
			durationMs: MONTH_TAG_MS,
			...(resetsAt !== undefined ? { resetsAt } : {}),
		},
		amount: {
			used: monthlySpend,
			limit: grant,
			usedFraction,
			unit: "credits",
		},
		status: usageStatus(usedFraction),
	};
}

async function fetchCommandCodeUsage(
	providerId: string,
	params: UsageFetchParams,
	ctx: UsageFetchContext,
): Promise<UsageReport | null> {
	if (params.provider !== providerId) return null;
	if (params.credential.type !== "api_key" || !params.credential.apiKey) return null;
	const origin = resolveOrigin(params.baseUrl);
	const apiKey = params.credential.apiKey;

	const [whoami, creditsBody, summary] = await Promise.all([
		getJson(`${origin}/alpha/whoami`, apiKey, params.signal, ctx),
		getJson(`${origin}/alpha/billing/credits`, apiKey, params.signal, ctx),
		getJson(`${origin}/alpha/usage/summary`, apiKey, params.signal, ctx).catch(() => null),
	]);
	if (!whoami || !creditsBody) return null;

	const user = isRecord(whoami.user) ? whoami.user : undefined;
	const org = isRecord(whoami.org) ? whoami.org : undefined;
	const userId = nonEmptyString(user?.id);
	if (!userId) return null;
	const orgId = nonEmptyString(org?.id);

	const credits = isRecord(creditsBody.credits) ? creditsBody.credits : undefined;
	if (!credits) return null;
	const monthly = finiteNumber(credits.monthlyCredits);
	const purchased = finiteNumber(credits.purchasedCredits);
	const free = finiteNumber(credits.freeCredits);
	if (monthly === undefined && purchased === undefined && free === undefined) return null;
	const creditsRemaining = monthly ?? 0;

	const limits: UsageLimit[] = [];
	const windowLimits = isRecord(creditsBody.windowLimits) ? creditsBody.windowLimits : undefined;
	for (const spec of WINDOWS) {
		const limit = buildWindowLimit(spec, windowLimits?.[spec.key], providerId, userId, orgId);
		if (limit) limits.push(limit);
	}
	const monthlyLimit = buildMonthlyLimit(summary, creditsRemaining, providerId, userId, orgId);
	if (monthlyLimit) limits.push(monthlyLimit);

	return {
		provider: providerId,
		fetchedAt: Date.now(),
		limits,
		metadata: {
			accountId: userId,
			email: nonEmptyString(user?.email),
			orgId,
			planType: nonEmptyString(credits.planId),
		},
		raw: { whoami, credits: creditsBody, summary: summary ?? undefined },
	};
}

/**
 * Usage provider for one Command Code provider id. Registered twice:
 * under `commandcode` (overrides the built-in dashboard fetcher, adding the
 * monthly limit) and under `commandcode-go` (this extension's own provider).
 */
export function commandCodeUsageProvider(id: string): UsageProvider {
	return {
		id,
		cacheVersion: CACHE_VERSION,
		fetchUsage: (params, ctx) => fetchCommandCodeUsage(id, params, ctx),
		supports: params => params.provider === id && params.credential.type === "api_key",
		validatesCredentials: true,
	};
}
