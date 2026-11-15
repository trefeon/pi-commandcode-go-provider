import { afterEach, describe, expect, test } from "bun:test";
import { commandCodeUsageProvider, COMMANDCODE_BUILTIN_ID } from "../src/usage.js";

const WHOAMI = {
  success: true,
  user: { id: "6c1cb861-3ae8-4829-bf38-80ee355f2325", name: "T", email: "trefeon@gmail.com", userName: "trefeon" },
  org: null,
};

const CREDITS = {
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
    fiveHour: { used: 2.2949897004, cap: 3, exceeded: false, resetAt: 1794780596274 },
    weekly: { used: 5.0730927678, cap: 6, exceeded: false, resetAt: 1795349364243 },
  },
  sandboxAccess: false,
  sandboxMinutes: null,
};

const SUMMARY = {
  totalCount: 1431,
  totalCost: 5.0730927678,
  successRate: 100,
  completedCount: 1431,
  failedCount: 0,
  totalTokens: 358060359,
  totalTokensIn: 357388805,
  totalTokensOut: 671554,
  totalMonthlyCredits: 5.0730927678,
  totalPurchasedCredits: 0,
  totalFreeCredits: 0,
  periodBasis: "billing-period",
  periodStart: "2026-11-15T11:41:09.000Z",
  daily: [],
};

const PROVIDER = commandCodeUsageProvider(COMMANDCODE_BUILTIN_ID);
const BASE_PARAMS = {
  provider: COMMANDCODE_BUILTIN_ID,
  credential: { type: "api_key", apiKey: "user_test_key" },
  baseUrl: "https://api.commandcode.ai/alpha/generate",
};

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

async function run(routes: Record<string, unknown>, status = 200, failing: readonly string[] = []) {
  const fetchImpl = (async (u: string) => {
    const key = Object.keys(routes).find((k) => u.includes(k)) ?? "";
    return new Response(JSON.stringify(routes[key]), {
      status: failing.includes(key) ? 500 : status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as (url: string, init?: unknown) => Promise<Response>;
  return PROVIDER.fetchUsage({ ...BASE_PARAMS }, { fetch: fetchImpl } as never);
}

describe("commandCodeUsageProvider", () => {
  test("reports 5h, weekly, monthly, and balance limits", async () => {
    const report = await run({ whoami: WHOAMI, "billing/credits": CREDITS, "usage/summary": SUMMARY });
    expect(report).not.toBeNull();
    expect(report!.provider).toBe("commandcode");
    expect(report!.limits.map((limit) => limit.id)).toEqual([
      "commandcode:5h",
      "commandcode:7d",
      "commandcode:monthly",
      "commandcode:balance",
    ]);

    const fiveHour = report!.limits[0];
    expect(fiveHour.amount.usedFraction).toBeCloseTo(2.2949897004 / 3, 12);
    expect(fiveHour.window!.resetsAt).toBe(1794780596274);

    const monthly = report!.limits[2];
    expect(monthly.label).toBe("Monthly limit");
    expect(monthly.amount.used).toBeCloseTo(5.0730927678, 12);
    expect(monthly.amount.limit).toBeCloseTo(10.0, 6);
    expect(monthly.amount.usedFraction).toBeCloseTo(5.0730927678 / 10.0, 12);
    expect(monthly.window!.resetsAt).toBe(new Date("2026-12-15T11:41:09.000Z").getTime());
    expect(monthly.status).toBe("ok");

    const balance = report!.limits[3];
    expect(balance.amount.remaining).toBeCloseTo(4.9269072322, 12);
    expect(report!.metadata!.email).toBe("trefeon@gmail.com");
  });

  test("omits the monthly limit when the summary endpoint fails", async () => {
    const report = await run(
      { whoami: WHOAMI, "billing/credits": CREDITS, "usage/summary": { error: "nope" } },
      200,
      ["usage/summary"],
    );
    expect(report).not.toBeNull();
    expect(report!.limits.map((limit) => limit.id)).toEqual(["commandcode:5h", "commandcode:7d", "commandcode:balance"]);
  });

  test("returns null when whoami or credits fail", async () => {
    const routes = { whoami: WHOAMI, "billing/credits": CREDITS, "usage/summary": SUMMARY };
    expect(await run(routes, 200, ["whoami"])).toBeNull();
    expect(await run(routes, 200, ["billing/credits"])).toBeNull();
  });

  test("returns null for other providers and non-api_key credentials", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response(JSON.stringify({}), { status: 200 });
    }) as unknown as (url: string, init?: unknown) => Promise<Response>;
    expect(
      await PROVIDER.fetchUsage({ ...BASE_PARAMS, provider: "other" }, { fetch: fetchImpl } as never),
    ).toBeNull();
    expect(
      await PROVIDER.fetchUsage(
        { ...BASE_PARAMS, credential: { type: "oauth" } },
        { fetch: fetchImpl } as never,
      ),
    ).toBeNull();
    expect(calls).toBe(0);
  });

  test("throws on 401 so revoked keys purge cached reports", async () => {
    const fetchImpl = (async () => new Response("unauthorized", { status: 401 })) as unknown as (
      url: string,
      init?: unknown,
    ) => Promise<Response>;
    expect(PROVIDER.fetchUsage({ ...BASE_PARAMS }, { fetch: fetchImpl } as never)).rejects.toThrow("401");
  });
});
