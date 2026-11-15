import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";


function parseJsonAuth(filePath: string): string | undefined {
  try {
    if (!existsSync(filePath)) return undefined;
    const raw = readFileSync(filePath, "utf-8").trim();
    if (!raw) return undefined;

    // Direct string in file
    if (!raw.startsWith("{") && !raw.startsWith("[")) {
      return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : undefined;
    }

    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object") return undefined;

    const record = data as Record<string, unknown>;

    // Common schemas:
    // { "apiKey": "user_..." }
    if (typeof record.apiKey === "string" && record.apiKey.trim().length > 0) return record.apiKey.trim();
    if (typeof record.key === "string" && record.key.trim().length > 0) return record.key.trim();
    if (typeof record.commandcode === "string" && record.commandcode.trim().length > 0) return record.commandcode.trim();
    if (typeof record["command-code"] === "object" && record["command-code"] !== null) {
      const cc = record["command-code"] as Record<string, unknown>;
      if (typeof cc.key === "string" && cc.key.trim().length > 0) return cc.key.trim();
      if (typeof cc.apiKey === "string" && cc.apiKey.trim().length > 0) return cc.apiKey.trim();
    }
    // { "commandcode": { "key": "user_..." } }
    if (typeof record.commandcode === "object" && record.commandcode !== null) {
      const cc = record.commandcode as Record<string, unknown>;
      if (typeof cc.key === "string" && cc.key.trim().length > 0) return cc.key.trim();
      if (typeof cc.apiKey === "string" && cc.apiKey.trim().length > 0) return cc.apiKey.trim();
    }
  } catch {
    // Silently ignore malformed files
  }
  return undefined;
}

function readLocalKeyFile(filePath: string): string | undefined {
  try {
    if (existsSync(filePath)) {
      const raw = readFileSync(filePath, "utf-8").trim();
      if (raw.length > 0) {
        // If it has multiple lines, take the first non-empty line
        const lines = raw.split(/\r?\n/).map((l: string) => l.trim()).filter((l: string) => l.length > 0);
        if (lines.length > 0) {
          return lines[0];
        }
      }
    }
  } catch {
    // Ignore read errors
  }
  return undefined;
}

/**
 * Resolves the CommandCode Go API key following strict precedence:
 * 1. Explicitly passed apiKey in options
 * 2. COMMANDCODE_API_KEY environment variable
 * 3. COMMAND_CODE_API_KEY environment variable
 * 4. Local fixture file `command-code-go-api-keys` in cwd or project root
 * 5. ~/.commandcode/auth.json
 * 6. ~/.pi/agent/auth.json
 * 7. ~/.omp/agent/auth.json
 */
export function resolveApiKey(optionsApiKey?: string): string | undefined {
  if (typeof optionsApiKey === "string" && optionsApiKey.trim().length > 0) {
    return optionsApiKey.trim();
  }

  const envKey = process.env.COMMANDCODE_API_KEY || process.env.COMMAND_CODE_API_KEY;
  if (typeof envKey === "string" && envKey.trim().length > 0) {
    return envKey.trim();
  }

  // Check local fixture in current working directory
  const cwdKeyFile = resolve(process.cwd(), "command-code-go-api-keys");
  const cwdKey = readLocalKeyFile(cwdKeyFile);
  if (cwdKey) return cwdKey;

  // Check local fixture in module directory
  const moduleDir = fileURLToPath(new URL(".", import.meta.url));
  const moduleDirKeyFile = resolve(moduleDir, "../command-code-go-api-keys");
  const moduleKey = readLocalKeyFile(moduleDirKeyFile);
  if (moduleKey) return moduleKey;

  // Check standard user home directories
  const home = homedir();
  const authPaths = [
    join(home, ".commandcode", "auth.json"),
    join(home, ".pi", "agent", "auth.json"),
    join(home, ".omp", "agent", "auth.json"),
  ];

  for (const path of authPaths) {
    const key = parseJsonAuth(path);
    if (key) return key;
  }

  return undefined;
}

export function hasApiKey(optionsApiKey?: string): boolean {
  return resolveApiKey(optionsApiKey) !== undefined;
}
