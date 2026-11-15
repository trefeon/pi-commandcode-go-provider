import { afterEach, describe, expect, test } from "bun:test";
import { fetchQuota, fetchUsageOverview, fetchUsageSummary } from "../src/quota.js";

const UPSTREAM_PAYLOAD = {
  credits: {
    belowThreshold: false,
    creditThreshold: 0,
    monthlyCredits: 4.9269072322,
    purchasedCredits: 0,
    freeCredits: 0,
  },
  windowLimits: {
    limited: true,
    exceeded: null,
    fiveHour: {
      used: 2.2223956644,
      cap: 3,
      exceeded: false,
      resetAt: 1794780596274,
    },
    weekly: {
      used: 5.0004987318,
      cap: 6,
      exceeded: false,
      resetAt: 1795349364243,
    },
  },
  sandboxAccess: false,
  sandboxMinutes: null,
};

const USAGE_SUMMARY_PAYLOAD = {
  totalCount: 1431,
  totalCost: 5.0730927677999995,
  averageCost: 0.003545138202515723,
  successRate: 100,
  completedCount: 1431,
  failedCount: 0,
  totalTokensIn: 357388805,
  totalTokensOut: 671554,
  totalTokens: 358060359,
  totalCredits: 5.0730927677999995,
  totalFreeCredits: 0,
  totalMonthlyCredits: 5.0730927677999995,
  totalPurchasedCredits: 0,
  periodBasis: "billing-period",
  periodStart: "2026-11-15T11:41:09.000Z",
  daily: [],
};

const originalFetch = globalThis.fetch;

function stubFetch(payload: unknown, status = 200): void {
  stubFetchRoutes({ "/": payload }, status);
}

/** Routes by URL substring; unmatched URLs get the "/" fallback payload. */
function stubFetchRoutes(routes: Record<string, unknown>, status = 200): void {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    const match = Object.keys(routes).find((key) => url.includes(key)) ?? "/";
    return new Response(JSON.stringify(routes[match]), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("fetchQuota", () => {
  test("parses credit balance and nested windowLimits from the live shape", async () => {
    stubFetch(UPSTREAM_PAYLOAD);
    const quota = await fetchQuota("user_test_key");
    expect(quota).toBeDefined();
    expect(quota!.creditsRemaining).toBeCloseTo(4.9269072322, 10);
    expect(quota!.purchasedCredits).toBe(0);
    expect(quota!.freeCredits).toBe(0);
    expect(quota!.belowThreshold).toBeUndefined();
    expect(quota!.fiveHourWindow!.used).toBeCloseTo(2.2223956644, 10);
    expect(quota!.fiveHourWindow!.cap).toBe(3);
    expect(quota!.fiveHourWindow!.resetAt).toBe(new Date(1794780596274).toISOString());
    expect(quota!.weeklyWindow!.used).toBeCloseTo(5.0004987318, 10);
    expect(quota!.weeklyWindow!.cap).toBe(6);
    expect(quota!.weeklyWindow!.resetAt).toBe(new Date(1795349364243).toISOString());
  });

  test("flags belowThreshold credits", async () => {
    stubFetch({
      credits: { belowThreshold: true, creditThreshold: 0.5, monthlyCredits: 0.2, purchasedCredits: 0, freeCredits: 0 },
      windowLimits: {},
    });
    const quota = await fetchQuota("user_test_key");
    expect(quota!.belowThreshold).toBe(true);
    expect(quota!.creditsRemaining).toBe(0.2);
  });

  test("still parses legacy top-level window shapes", async () => {
    stubFetch({
      plan: "individual-go",
      "5h": { used: 1, cap: 3, resetAt: "2026-11-16T00:00:00.000Z" },
      weekly: { used: 2, cap: 6, resetAt: "2026-11-22T00:00:00.000Z" },
    });
    const quota = await fetchQuota("user_test_key");
    expect(quota!.plan).toBe("individual-go");
    expect(quota!.fiveHourWindow).toEqual({ used: 1, cap: 3, resetAt: "2026-11-16T00:00:00.000Z" });
    expect(quota!.weeklyWindow).toEqual({ used: 2, cap: 6, resetAt: "2026-11-22T00:00:00.000Z" });
  });

  test("returns undefined on non-OK responses", async () => {
    stubFetch({ error: "nope" }, 401);
    const quota = await fetchQuota("user_test_key");
    expect(quota).toBeUndefined();
  });
});

describe("fetchUsageSummary", () => {
  test("parses the Studio Overview shape", async () => {
    stubFetch(USAGE_SUMMARY_PAYLOAD);
    const summary = await fetchUsageSummary("user_test_key");
    expect(summary).toBeDefined();
    expect(summary!.totalRuns).toBe(1431);
    expect(summary!.completedRuns).toBe(1431);
    expect(summary!.failedRuns).toBe(0);
    expect(summary!.successRate).toBe(100);
    expect(summary!.totalTokens).toBe(358060359);
    expect(summary!.totalTokensIn).toBe(357388805);
    expect(summary!.totalTokensOut).toBe(671554);
    expect(summary!.totalMonthlyCredits).toBeCloseTo(5.0730927678, 10);
    expect(summary!.periodBasis).toBe("billing-period");
    expect(summary!.periodStart).toBe("2026-11-15T11:41:09.000Z");
  });

  test("returns undefined on non-OK responses", async () => {
    stubFetch({ error: "nope" }, 500);
    const summary = await fetchUsageSummary("user_test_key");
    expect(summary).toBeUndefined();
  });
});

describe("fetchUsageOverview", () => {
  test("merges summary and credits; monthly grant = remaining + monthly spend", async () => {
    stubFetchRoutes({
      "/billing/credits": UPSTREAM_PAYLOAD,
      "/usage/summary": USAGE_SUMMARY_PAYLOAD,
    });
    const overview = await fetchUsageOverview("user_test_key");
    expect(overview).toBeDefined();
    expect(overview!.summary.totalRuns).toBe(1431);
    expect(overview!.quota!.creditsRemaining).toBeCloseTo(4.9269072322, 10);
    expect(overview!.monthlyGrant).toBeCloseTo(10.0, 6);
    expect(overview!.quota!.fiveHourWindow!.cap).toBe(3);
    expect(overview!.quota!.weeklyWindow!.cap).toBe(6);
  });

  test("returns undefined when the summary endpoint fails", async () => {
    stubFetchRoutes({
      "/billing/credits": UPSTREAM_PAYLOAD,
      "/usage/summary": { error: "nope" },
    }, 500);
    const overview = await fetchUsageOverview("user_test_key");
    expect(overview).toBeUndefined();
  });
});
