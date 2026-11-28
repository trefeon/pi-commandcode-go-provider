# pi-commandcode-go-provider

Custom provider extension for **Oh My Pi (OMP)** and **Pi coding agent** that connects to the **Command Code Go plan ($1/mo)**.

---

## Background & Problem

Command Code accounts fall into two categories:
1. **Provider API ($15/mo Provider plan, GOAT, Pro, Max):** Uses documented inference endpoints (`/provider/v1/messages`, `/provider/v1/chat/completions`, `/provider/v1/responses`).
2. **Command Code Go plan ($1/mo):** Has **no Provider API entitlement**. If called against `/provider/v1/`, upstream rejects requests with `403 upgrade_required`. Existing plugins (such as `pi-commandcode-provider`) intentionally halt on this error and do not fallback to internal endpoints.

Command Code Go instead communicates via Command Code's internal CLI gateway:
- **Endpoint:** `POST https://api.commandcode.ai/alpha/generate`
- **Protocol:** Line-delimited JSON (NDJSON) streaming
- **Headers:** `x-command-code-version: 1.93.5 (auto-tracked from npm `command-code`)`, `x-cli-environment: production`, `user-agent: cli`

This extension implements that wire protocol directly, allowing OMP and Pi to use the full Go-plan model catalog (60 models at the time of writing) with full tool calling, reasoning/thinking, and streaming support.

---

## Quick Install (One-Liner)

### Windows (PowerShell)
```powershell
irm https://raw.githubusercontent.com/trefeon/pi-commandcode-go-provider/main/scripts/install.ps1 | iex
```

### Linux / macOS / Git Bash
```bash
curl -fsSL https://raw.githubusercontent.com/trefeon/pi-commandcode-go-provider/main/scripts/install.sh | bash
```

### Manual Installation
Clone the repository into your OMP extensions folder:
```bash
git clone https://github.com/trefeon/pi-commandcode-go-provider.git ~/.omp/agent/extensions/pi-commandcode-go-provider
```
Then create `~/.omp/agent/extensions/commandcode-go.ts`:
```typescript
import extension from "./pi-commandcode-go-provider/index.ts";
export default extension;
```

---

## Model Catalog & Sync

The provider ships `src/generated-catalog.ts`, generated from Command Code's public catalog with only Go-plan rows (`minimumPlan=individual-go`, hidden rows excluded, `max_tokens` clamped to the 200K gateway ceiling):

1. **Runtime Refresh:** OMP queries `GET /provider/v1/models?view=client` on model refresh; Pi does the same via `refreshModels`. Newly published Go models are merged in and cached for 6 hours.
2. **Instant In-Session Refresh:** Run `/commandcode-go-refresh` in OMP to force an immediate upstream catalog check.
3. **Auto-Update:** On every session start the plugin refreshes the CLI version header (latest `command-code` on npm, 6h cache), the model catalog, and fast-forwards its own git checkout (skipped if dirty; set `COMMANDCODE_GO_AUTO_UPDATE=0` to disable the git pull). Run `/commandcode-go-update` to force all three now; `/reload` applies code updates.
4. **GitHub Actions Daily Sync:** A scheduled workflow reruns `bun run scripts/generate-catalog.ts` and commits the regenerated catalog.
---

## Coexistence with OMP's built-in `commandcode` provider

This extension registers its own provider id `commandcode-go` (API `commandcode-go`), so models, `/model` refs, and streaming never touch the built-in `commandcode` provider (`/provider/v1/*`, Provider-plan keys). The only shared surface is `/usage`: by default the plugin overrides the built-in `commandcode` usage fetcher to add the monthly limit. Set `COMMANDCODE_GO_BUILTIN_USAGE=0` to leave the built-in fetcher untouched. API-key lookup reads the same `COMMANDCODE_API_KEY` sources, so one key serves both.

---

## Authentication

The provider automatically searches for your API key in the following precedence order:
1. Explicit `--api-key` or stream options passed by host
2. Environment variable: `COMMANDCODE_API_KEY`
3. Environment variable: `COMMAND_CODE_API_KEY`
4. Local fixture file: `command-code-go-api-keys` (in current working directory or plugin directory)
5. `~/.commandcode/auth.json`
6. `~/.pi/agent/auth.json`
7. `~/.omp/agent/auth.json`

---

## Usage

Reference models with the `commandcode-go/` provider prefix:

```bash
# Non-interactive command
omp --model commandcode-go/deepseek-v4.1-flash -p "Explain goroutine scheduling"

# Reasoning models with effort level
omp --model commandcode-go/gpt-6-luna --thinking=high "Review this architecture"

# Fast coding
omp --model commandcode-go/kimi-k2.7-code
```

### Extension Commands

Inside OMP / Pi interactive session:
- `/commandcode-go-status` â€” Displays gateway URL, API key status, model count, and active model.
- `/commandcode-go-models` â€” Lists every Go-plan model with context, output cap, and reasoning efforts.
- `/commandcode-go-quota` â€” Studio-style usage overview: billing-period token/run totals, credit balance (monthly/purchased/free), and 5-hour/weekly/monthly limit percentages with reset times.

### Native `/usage` Dashboard

The extension overrides omp's built-in `commandcode` usage fetcher, so the native `/usage` dashboard (TUI overlay and `omp usage`) renders the full per-account limit set for Command Code: 5-hour, weekly, and **monthly** (spend vs. the $10.00 credit grant, reset = billing-period start + 1 month). The built-in fetcher never calls `/alpha/usage/summary`, so the monthly row was missing. Model registration for the built-in id stays disabled via `disabledProviders`; only the usage section is overridden (`cacheVersion: 3` keeps the two report caches separate).

---

## Supported Models

The catalog is generated from upstream and contains every Go-plan model (60 rows today). Flagship entries:

| ID | Name | Context | Max Output | Reasoning Efforts | Modalities |
|---|---|---|---|---|---|
| `deepseek-v4.1-flash` | DeepSeek V4.1 Flash (latest) | 1M | 200K | off, low, high, max | text, image |
| `deepseek-v4-pro` | DeepSeek V4 Pro (latest) | 1M | 200K | off, high, max | text |
| `gpt-6-luna` | GPT-6 Luna | 1.05M | 200K | low, medium, high, xhigh, max | text, image |
| `glm-5.3-flash` | GLM-5.3 Flash | 1.05M | 131K | low, high, max | text, image |
| `kimi-k2.7-code` | Kimi K2.7 Code | 256K | 200K | auto | text, image |
| `minimax-m3` | MiniMax M3 | 1M | 200K | low, medium, high | text, image |
| `qwen3.7-plus` | Qwen 3.7 Plus | 1M | 200K | auto | text, image |
| `step-3.7-flash` | Step 3.7 Flash | 256K | 200K | auto | text, image |
| `muse-ember` | Muse Ember | 1.05M | 200K | low, medium, high, xhigh, max | text, image |
| `grok-4.5` | Grok 4.5 | 500K | 200K | low, medium, high | text, image |
| `mistral-large-4` | Mistral Large 4 | 524K | 200K | low, medium, high | text, image |
| `glyph-cluster-free` | Glyph Cluster | 256K | 200K | low, medium, high, xhigh | text |

*Full list: `/commandcode-go-models` or `omp models commandcode-go`. Vendor-prefixed aliases (e.g. `deepseek/deepseek-v4.1-flash`, `moonshotai/Kimi-K2.7-Code`) are accepted and normalized to the exact upstream id.*

Models above the Go plan (Claude, GPT-5.x Pro/Max, Gemini, etc.) are filtered out of the catalog, so the picker only shows runnable models.

Model rows declare their effort ladders but no default level: a new session's starting effort comes from your selector suffix (e.g. `commandcode-go/deepseek-v4.1-flash:max` in `modelRoles`) or the host `defaultThinkingLevel`, not from a level baked into the plugin.

---

## Protocol Compatibility (OMP & Pi)

- **Wire protocol:** `/alpha/generate` NDJSON stream with the official CLI headers (`x-command-code-version: 1.93.5 (auto-tracked from npm `command-code`)`, `x-cli-environment: production`, `user-agent: cli`).
- **Tool schemas:** sent verbatim as `input_schema`, matching `command-code@1.89.1`'s `toWireTools` â€” no injected nullability hints.
- **Tool inputs:** official-CLI parity (`coerceToolInput`): single-element array unwrap, JSON-string parse, bare-string root wrapping, plus smashed-key repair for reasoning models.
- **Tool results:** accepts OMP's `role: "toolResult"`, Pi's `role: "tool"`, and any message carrying a `toolCallId`, emitting one wire `tool` turn per result with the original call id and tool name.
- **Stream parsing:** text and reasoning deltas, `tool-call` frames, usage totals, finish reasons, and mid-stream error events.
- **Usage accounting:** upstream `inputTokens` is the whole prompt, cache hits included (`noCacheTokens + cacheReadTokens + cacheWriteTokens`). `usage.input` carries only the uncached remainder and `usage.contextTokens` the full prompt, matching the host convention (`input + cacheRead + cacheWrite`). Without this split every cache hit is counted twice and the context gauge doubles â€” a 570K-token prompt renders at ~105% of a 1M window.
- **Idle timeout:** `timeoutMs` (Pi's `httpIdleTimeoutMs`, default 300s) bounds the gap between stream chunks, not total generation time. The timer re-arms on every raw chunk, so long reasoning turns that stream steadily are not cut off at exactly `timeoutMs`; a genuinely stalled stream still aborts. Ported from patlux/pi-commandcode-provider#87 â†’ PR #88.
- **Output budget:** `max_tokens` uses each model's upstream declared cap, or the full gateway ceiling (200,000) when upstream declares none. The gateway hard-rejects anything above 200,000 â€” verified against models that declare 256K/262K â€” so 200K is the highest the endpoint accepts. If upstream ever reports a lower cap in a 400, the request retries once with that value.
- **Compaction:** every registered model carries a `compactionModel` reference resolved by `preferredCompactionModelId()` â€” picked from the upstream price list at the compaction workload (500K in / 8K out): 1M+ window required (the target must read the oversized context), free/stealth-preview rows excluded (capacity-gated, refuse under load â€” the failure that motivated this), then cheapest tier-aware cost using the upstream `contextTiers` the catalog carries. Flat base rates mislead: `gpt-6-luna` is 0.10/M base but 0.20/M above 272K, and `qwen3.7-flash`'s 0.03 is its â‰¤32K tier (0.20/M above 256K) â€” both lose to `muse-spark-1.2-contributor`'s 0.10/0.20 flat. The compaction reference resolves before the session model; a withdrawn upstream id degrades gracefully back to it.

---

## Testing

```bash
bun test
bun run typecheck
```
All tests use mock stream responders and do not make live network calls.
