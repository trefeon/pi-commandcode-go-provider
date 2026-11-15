# omp-command-code-go-provider

Custom provider extension for **Oh My Pi (OMP)** and **Pi coding agent** that connects to the **Command Code Go plan ($1/mo)**.

---

## Background & Problem

Command Code accounts fall into two categories:
1. **Provider API ($15/mo Provider plan, GOAT, Pro, Max):** Uses documented inference endpoints (`/provider/v1/messages`, `/provider/v1/chat/completions`, `/provider/v1/responses`).
2. **Command Code Go plan ($1/mo):** Has **no Provider API entitlement**. If called against `/provider/v1/`, upstream rejects requests with `403 upgrade_required`. Existing plugins (such as `pi-commandcode-provider`) intentionally halt on this error and do not fallback to internal endpoints.

Command Code Go instead communicates via Command Code's internal CLI gateway:
- **Endpoint:** `POST https://api.commandcode.ai/alpha/generate`
- **Protocol:** Line-delimited JSON (NDJSON) streaming
- **Headers:** `x-command-code-version: 0.26.20`, `x-cli-environment: production`, `user-agent: cli`

This extension implements that wire protocol directly, allowing OMP and Pi to use all 30 models included in the Go plan with full tool calling, reasoning/thinking, and streaming support.

---

## Quick Install (One-Liner)

### Windows (PowerShell)
```powershell
irm https://raw.githubusercontent.com/trefeon/omp-command-code-go-provider/main/scripts/install.ps1 | iex
```

### Linux / macOS / Git Bash
```bash
curl -fsSL https://raw.githubusercontent.com/trefeon/omp-command-code-go-provider/main/scripts/install.sh | bash
```

### Manual Installation
Clone the repository into your OMP extensions folder:
```bash
git clone https://github.com/trefeon/omp-command-code-go-provider.git ~/.omp/agent/extensions/omp-command-code-go-provider
```
Then create `~/.omp/agent/extensions/commandcode-go.ts`:
```typescript
import extension from "./omp-command-code-go-provider/index.ts";
export default extension;
```

---

## Automated Model Sync & Self-Updates

You never need to manually monitor upstream changes:
1. **Runtime Background Auto-Sync:** On startup, the provider silently checks `https://api.commandcode.ai/provider/v1/models` in the background and caches newly released models automatically.
2. **Instant In-Session Refresh:** Run `/commandcode-go-refresh` in OMP to force an immediate upstream model catalog check.
3. **In-Session Git Self-Update:** Run `/commandcode-go-update` in OMP to pull the latest code updates directly from GitHub without leaving your terminal.
4. **GitHub Actions Daily Sync:** A scheduled daily GitHub Action probes upstream Command Code catalogs and automatically commits new models and updated limits to this repository.
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
omp --model commandcode-go/deepseek-v4-flash -p "Explain goroutine scheduling"

# Reasoning models with effort level
omp --model commandcode-go/claude-sonnet-5 --thinking=high "Review this architecture"

# Fast coding
omp --model commandcode-go/kimi-k2.7-code
```

### Extension Commands

Inside OMP / Pi interactive session:
- `/commandcode-go-status` — Displays gateway URL, API key status, model count, and active model.
- `/commandcode-go-models` — Lists all 30 available models and capabilities.
- `/commandcode-go-quota` — Checks rolling 5-hour and weekly usage windows.

---

## Supported Models

| ID | Name | Context Window | Max Output | Reasoning | Modalities |
|---|---|---|---|---|---|
| `claude-haiku-4-5-20251001` | Claude Haiku 4.5 | 200K | 8K | No | Text, Image |
| `claude-opus-4-7` | Claude Opus 4.7 | 1M | 32K | Yes (low..max) | Text, Image |
| `claude-sonnet-4-6` | Claude Sonnet 4.6 | 1M | 16K | Yes (low..max) | Text, Image |
| `claude-sonnet-5` | Claude Sonnet 5 | 1M | 64K | Yes (low..max) | Text, Image |
| `gpt-5.3-codex` | GPT-5.3 Codex | 400K | 128K | Yes (low..max) | Text, Image |
| `gpt-5.4` | GPT-5.4 | 400K | 128K | Yes (low..max) | Text, Image |
| `gpt-5.4-mini` | GPT-5.4 Mini | 400K | 128K | Yes (low..max) | Text, Image |
| `gpt-5.5` | GPT-5.5 | 256K | 128K | Yes (low..max) | Text, Image |
| `deepseek-v4-flash` | DeepSeek V4 Flash | 1M | 384K | Yes (off, high, max) | Text, Image |
| `deepseek-v4-pro` | DeepSeek V4 Pro | 1M | 384K | Yes (off, high, max) | Text, Image |
| `gemini-3.1-flash-lite` | Gemini 3.1 Flash Lite | 1M | 64K | Yes (low..high) | Text, Image |
| `gemini-3.5-flash` | Gemini 3.5 Flash | 1M | 64K | Yes (low..high) | Text, Image |
| `glm-5` | GLM-5 | 200K | 131K | No | Text |
| `glm-5.1` | GLM-5.1 | 200K | 131K | No | Text |
| `glm-5.2` | GLM-5.2 | 1M | 131K | Yes (high, max) | Text |
| `kimi-k2.5` | Kimi K2.5 | 256K | 131K | No | Text, Image |
| `kimi-k2.6` | Kimi K2.6 | 256K | 131K | No | Text, Image |
| `kimi-k2.7-code` | Kimi K2.7 Code | 262K | 131K | Yes (off, high, max) | Text, Image |
| `kimi-k2.7-code-highspeed` | Kimi K2.7 Code HighSpeed | 262K | 131K | Yes (off, high, max) | Text, Image |
| `minimax-m2.5` | MiniMax M2.5 | 200K | 131K | No | Text |
| `minimax-m2.7` | MiniMax M2.7 | 1M | 131K | No | Text |
| `minimax-m3` | MiniMax M3 | 1M | 524K | Yes (low..high) | Text, Image |
| `qwen3.6-max-preview` | Qwen 3.6 Max Preview | 1M | 131K | Yes (low..high) | Text |
| `qwen3.6-plus` | Qwen 3.6 Plus | 1M | 131K | Yes (low..high) | Text, Image |
| `qwen3.7-max` | Qwen 3.7 Max | 1M | 131K | Yes (low..xhigh) | Text |
| `qwen3.7-plus` | Qwen 3.7 Plus | 1M | 131K | Yes (low..xhigh) | Text, Image |
| `step-3.5-flash` | Step 3.5 Flash | 1M | 131K | Yes (low..high) | Text |
| `step-3.7-flash` | Step 3.7 Flash | 1M | 131K | Yes (low..high) | Text, Image |
| `mimo-v2.5-pro` | MiMo V2.5 Pro | 1M | 131K | Yes (low..high) | Text, Image |
| `mimo-v2.5` | MiMo V2.5 | 1M | 131K | Yes (low..high) | Text, Image |
| `nemotron-3-ultra` | Nemotron 3 Ultra | 1M | 131K | Yes (low..high) | Text |

*Vendor-prefixed aliases (e.g. `deepseek/deepseek-v4-flash`, `moonshotai/Kimi-K2.7-Code`) are automatically recognized and normalized.*

---

## Tool Calling Invariant Protection

Upstream Command Code `/alpha/generate` proxies declared tools to strict OpenAI Responses. This provider automatically applies:
- `clientSchema`: Makes optional parameters nullable with prompt hints on the request wire so the gateway does not reject omitted optional arguments.
- `dropNullArguments`: Filters out injected `null` defaults on return to ensure tools in OMP receive exact inputs.

---

## Testing

```bash
bun test
bun run typecheck
```
All tests use mock stream responders and do not make live network calls.
