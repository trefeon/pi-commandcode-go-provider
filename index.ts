/**
 * Command Code Go ($1/mo plan) custom provider extension for Oh My Pi (OMP) and Pi.
 *
 * Implements the proprietary `/alpha/generate` protocol used by the official `cmd` CLI,
 * enabling full access to all 30 CommandCode Go models without requiring the $15/mo Provider API.
 */

import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { hasApiKey, resolveApiKey } from "./src/auth.js";
import { COMMAND_CODE_GO_MODELS, registerCatalogModels } from "./src/catalog.js";
import { loadCachedCatalog, refreshCatalog } from "./src/dynamic-catalog.js";
import { clampMaxTokens } from "./src/protocol.js";
import { fetchUsageOverview } from "./src/quota.js";
import { COMMANDCODE_BUILTIN_ID, commandCodeUsageProvider } from "./src/usage.js";
import { streamCommandCodeGo } from "./src/stream.js";
import type {
  CommandCodeGoModel,
  ContextLike,
  ExtensionAPI,
  ExtensionContext,
  ProviderConfig,
  ProviderModelConfig,
  StreamOptions,
} from "./src/types.js";

export const PROVIDER_ID = "commandcode-go";
export const PROVIDER_NAME = "Command Code Go";
export const PROVIDER_API = "commandcode-go";
export const GATEWAY_BASE_URL = "https://api.commandcode.ai/alpha/generate";

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatCountdown(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return iso;
  if (ms <= 0) return "now";
  const minutes = Math.round(ms / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function toProviderModelConfig(model: CommandCodeGoModel): ProviderModelConfig {
  return {
    id: model.id,
    name: model.name,
    api: PROVIDER_API,
    reasoning: model.reasoning,
    thinking: model.thinking,
    thinkingLevelMap: model.thinkingLevelMap,
    input: model.input ? [...model.input] : ["text"],
    contextWindow: model.contextWindow,
    maxTokens: clampMaxTokens(model.maxTokens),
    cost: model.cost,
  };
}

export function createProviderConfig(): ProviderConfig {
  registerCatalogModels(loadCachedCatalog());
  const initialModels = loadCachedCatalog().map(toProviderModelConfig);
  const apiKey = resolveApiKey();

  return {
    name: PROVIDER_NAME,
    baseUrl: GATEWAY_BASE_URL,
    apiKey: apiKey ?? "COMMANDCODE_API_KEY",
    api: PROVIDER_API,
    // No `usage` here: registering one synthesizes a reportable account from
    // this config's apiKey and the dashboard renders the same data twice —
    // once as "Commandcode" (the overridden built-in id below) and once as
    // "Commandcode Go". The override on the built-in id is the single source.
    streamSimple: (model: CommandCodeGoModel, context: ContextLike, options?: StreamOptions) => {
      return streamCommandCodeGo(model, context, options);
    },
    models: initialModels,
    // OMP uses fetchDynamicModels (merged with static fallback)
    fetchDynamicModels: async () => {
      const res = await refreshCatalog();
      return res.models.map(toProviderModelConfig);
    },
    // Pi uses refreshModels (replaces catalog; must not return empty)
    refreshModels: async () => {
      const res = await refreshCatalog();
      return res.models.map(toProviderModelConfig);
    },
    oauth: {
      name: PROVIDER_NAME,
      login: async (callbacks) => {
        const raw = await callbacks.onPrompt({
          message: "Paste your Command Code Go API key (starts with user_...):",
        });
        const key = raw.trim();
        if (!key) throw new Error("No API key provided");
        return {
          refresh: key,
          access: key,
          expires: Date.now() + 10 * 365 * 24 * 60 * 60 * 1000,
        };
      },
      refreshToken: async (credentials) => credentials,
      getApiKey: (credentials) => credentials.access,
    },
  };
}

export default async function (pi: ExtensionAPI): Promise<void> {
  const config = createProviderConfig();

  // Register custom provider for Command Code Go
  pi.registerProvider(PROVIDER_ID, config);

  // Override the built-in `commandcode` usage fetcher so omp's native `/usage`
  // dashboard renders the monthly limit (built-in only shows 5h/weekly/balance).
  // Models for that id stay hidden via `disabledProviders`; only usage is overridden.
  pi.registerProvider(COMMANDCODE_BUILTIN_ID, {
    usage: commandCodeUsageProvider(COMMANDCODE_BUILTIN_ID),
  });
  // Status command: displays configuration and active key presence safely
  if (pi.registerCommand) {
    pi.registerCommand("commandcode-go-status", {
      description: "Show Command Code Go provider configuration and auth status",
      handler: async (_args: string, ctx: ExtensionContext) => {
        const keyPresent = hasApiKey();
        const activeModel = ctx.model?.provider === PROVIDER_ID ? ctx.model.id : "none";
        const message = [
          `Provider: ${PROVIDER_NAME} (${PROVIDER_ID})`,
          `Gateway: ${GATEWAY_BASE_URL}`,
          `Models available: ${COMMAND_CODE_GO_MODELS.length}`,
          `API key configured: ${keyPresent ? "Yes" : "No (set COMMANDCODE_API_KEY or command-code-go-api-keys file)"}`,
          `Active model: ${activeModel}`,
        ].join("\n");

        if (ctx.ui?.notify) {
          ctx.ui.notify(message, keyPresent ? "info" : "warning");
        } else {
          console.log(message);
        }
      },
    });

    pi.registerCommand("commandcode-go-models", {
      description: "List all models supported by Command Code Go plan",
      handler: async (_args: string, ctx: ExtensionContext) => {
        const lines = [
          `Command Code Go Models (${COMMAND_CODE_GO_MODELS.length} available):`,
          ...COMMAND_CODE_GO_MODELS.map(
            (m) =>
              `- ${m.id} (${m.name}) | ctx: ${(m.contextWindow / 1000).toFixed(0)}k | out: ${(m.maxTokens / 1000).toFixed(0)}k | reasoning: ${m.reasoning ? "yes" : "no"}`
          ),
        ];
        const text = lines.join("\n");
        if (ctx.ui?.notify) {
          ctx.ui.notify(text, "info");
        } else {
          console.log(text);
        }
      },
    });

    pi.registerCommand("commandcode-go-quota", {
      description:
        "Show Command Code usage overview: token/run totals, credit balance, and 5h/weekly/monthly limits",
      handler: async (_args: string, ctx: ExtensionContext) => {
        if (!hasApiKey()) {
          ctx.ui?.notify("No Command Code API key configured.", "warning");
          return;
        }

        ctx.ui?.notify("Fetching Command Code usage overview...", "info");
        const overview = await fetchUsageOverview();
        if (!overview) {
          ctx.ui?.notify("Unable to retrieve usage information from Command Code.", "warning");
          return;
        }

        const { summary, quota, monthlyGrant } = overview;
        const monthDay = (iso: string) =>
          new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

        let monthlyReset: string | undefined;
        if (summary.periodStart) {
          const d = new Date(summary.periodStart);
          if (!Number.isNaN(d.getTime())) {
            d.setMonth(d.getMonth() + 1);
            monthlyReset = monthDay(d.toISOString());
          }
        }

        const pct = (used: number, cap: number) => (cap > 0 ? `${Math.round((used / cap) * 100)}%` : "0%");
        const usd = (n: number) => `$${n.toFixed(2)}`;

        const lines = [
          "Command Code Usage Overview:",
          summary.periodStart ? `Billing period: since ${monthDay(summary.periodStart)}` : undefined,
          `Total tokens: ${formatTokens(summary.totalTokens)} (in ${formatTokens(summary.totalTokensIn)} / out ${formatTokens(summary.totalTokensOut)})`,
          `Total runs: ${summary.totalRuns.toLocaleString()}${
            summary.successRate !== undefined ? ` (${Math.round(summary.successRate)}% success)` : ""
          }${summary.failedRuns > 0 ? `, ${summary.failedRuns} failed` : ""}`,
          quota?.creditsRemaining !== undefined
            ? monthlyGrant !== undefined
              ? `Credit balance: ${usd(quota.creditsRemaining)} of ${usd(monthlyGrant)} monthly credits remaining`
              : `Credit balance: ${usd(quota.creditsRemaining)} monthly credits remaining`
            : undefined,
          quota?.purchasedCredits !== undefined ? `Purchased credits: ${usd(quota.purchasedCredits)}` : undefined,
          quota?.freeCredits !== undefined ? `Free credits: ${usd(quota.freeCredits)}` : undefined,
          quota?.fiveHourWindow
            ? `5-Hour Limit: ${pct(quota.fiveHourWindow.used, quota.fiveHourWindow.cap)} (${usd(quota.fiveHourWindow.used)} of ${usd(quota.fiveHourWindow.cap)})${
                quota.fiveHourWindow.resetAt ? ` — resets in ${formatCountdown(quota.fiveHourWindow.resetAt)}` : ""
              }`
            : undefined,
          quota?.weeklyWindow
            ? `Weekly Limit: ${pct(quota.weeklyWindow.used, quota.weeklyWindow.cap)} (${usd(quota.weeklyWindow.used)} of ${usd(quota.weeklyWindow.cap)})${
                quota.weeklyWindow.resetAt ? ` — resets in ${formatCountdown(quota.weeklyWindow.resetAt)}` : ""
              }`
            : undefined,
          monthlyGrant !== undefined
            ? `Monthly Limit: ${pct(summary.totalMonthlyCredits, monthlyGrant)} (${usd(summary.totalMonthlyCredits)} of ${usd(monthlyGrant)})${
                monthlyReset ? ` — resets on ${monthlyReset}` : ""
              }`
            : summary.totalMonthlyCredits !== undefined
              ? `Monthly spend: ${usd(summary.totalMonthlyCredits)}`
              : undefined,
          quota?.belowThreshold ? "Warning: credit balance below threshold." : undefined,
        ].filter(Boolean) as string[];

        ctx.ui?.notify(lines.join("\n"), "info");
      },
    });
    pi.registerCommand("commandcode-go-refresh", {
      description: "Auto-refresh model catalog from Command Code upstream",
      handler: async (_args: string, ctx: ExtensionContext) => {
        ctx.ui?.notify("Checking for new Command Code models upstream...", "info");
        const { models, newCount } = await refreshCatalog(true);
        const msg = newCount > 0
          ? `Found ${newCount} new model(s)! Total catalog: ${models.length} models.`
          : `Catalog is up to date (${models.length} models available).`;
        ctx.ui?.notify(msg, "info");
      },
    });

    pi.registerCommand("commandcode-go-update", {
      description: "Pull latest plugin updates from git repository",
      handler: async (_args: string, ctx: ExtensionContext) => {
        try {
          const moduleDir = fileURLToPath(new URL(".", import.meta.url));
          ctx.ui?.notify("Pulling latest plugin updates from git...", "info");
          const out = execSync("git pull --ff-only", { cwd: moduleDir, encoding: "utf-8" }).trim();
          ctx.ui?.notify(`Plugin update: ${out}. Run /reload to apply.`, "info");
        } catch (err) {
          ctx.ui?.notify(`Update check failed: ${err instanceof Error ? err.message : String(err)}`, "warning");
        }
      },
    });
  }

  // Auto-bind model on session start if selected
  if (pi.on) {
    pi.on("session_start", async (_event: unknown, ctx: ExtensionContext) => {
      const provider = ctx.model?.provider;
      if ((provider === PROVIDER_ID || provider === "commandcode") && ctx.model && ctx.modelRegistry && pi.setModel) {
        const registered = ctx.modelRegistry.find(provider, ctx.model.id);
        if (registered) {
          await pi.setModel(registered);
        }
      }
    });
  }
}
