/**
 * Command Code Go ($1/mo plan) custom provider extension for Oh My Pi (OMP) and Pi.
 *
 * Implements the proprietary `/alpha/generate` protocol used by the official `cmd` CLI,
 * enabling full access to all 30 CommandCode Go models without requiring the $15/mo Provider API.
 */

import { hasApiKey, resolveApiKey } from "./src/auth.js";
import { COMMAND_CODE_GO_MODELS, resolveModel } from "./src/catalog.js";
import { fetchQuota } from "./src/quota.js";
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
    maxTokens: model.maxTokens,
    cost: model.cost,
  };
}

export function createProviderConfig(): ProviderConfig {
  const models = COMMAND_CODE_GO_MODELS.map(toProviderModelConfig);
  const apiKey = resolveApiKey();

  return {
    name: PROVIDER_NAME,
    baseUrl: GATEWAY_BASE_URL,
    apiKey: apiKey ?? "$COMMANDCODE_API_KEY",
    api: PROVIDER_API,
    streamSimple: (model: CommandCodeGoModel, context: ContextLike, options?: StreamOptions) => {
      return streamCommandCodeGo(model, context, options);
    },
    models,
    // OMP uses fetchDynamicModels (merged with static fallback)
    fetchDynamicModels: async () => models,
    // Pi uses refreshModels (replaces catalog; must not return empty)
    refreshModels: async () => models,
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

  // Register as both 'commandcode-go' and 'commandcode' so users can use either:
  // --model commandcode-go/<model> or the standard --model commandcode/<model>
  pi.registerProvider(PROVIDER_ID, config);
  pi.registerProvider("commandcode", config);
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
      description: "Check Command Code account quota and subscription status",
      handler: async (_args: string, ctx: ExtensionContext) => {
        if (!hasApiKey()) {
          ctx.ui?.notify("No Command Code API key configured.", "warning");
          return;
        }

        ctx.ui?.notify("Fetching Command Code account quota...", "info");
        const quota = await fetchQuota();
        if (!quota) {
          ctx.ui?.notify("Unable to retrieve quota information from Command Code.", "warning");
          return;
        }

        const lines = [
          "Command Code Account Quota:",
          quota.plan ? `Plan: ${quota.plan}` : undefined,
          quota.fiveHourWindow
            ? `5h Window: ${quota.fiveHourWindow.used} / ${quota.fiveHourWindow.cap} used`
            : undefined,
          quota.weeklyWindow
            ? `Weekly Window: ${quota.weeklyWindow.used} / ${quota.weeklyWindow.cap} used`
            : undefined,
        ].filter(Boolean) as string[];

        ctx.ui?.notify(lines.join("\n"), "info");
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
