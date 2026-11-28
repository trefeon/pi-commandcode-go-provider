/**
 * Bumps FALLBACK_CLI_VERSION in src/version.ts to the latest `command-code` on npm.
 * Usage: `bun run scripts/sync-cli-version.ts` (add `--check` to fail when stale).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { NPM_LATEST_URL } from "../src/version.js";

const FILE = resolve(import.meta.dir, "../src/version.ts");
const res = await fetch(NPM_LATEST_URL, { headers: { accept: "application/json" } });
if (!res.ok) throw new Error(`npm registry returned ${res.status}`);
const { version } = (await res.json()) as { version?: string };
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`unexpected version: ${version}`);

const src = readFileSync(FILE, "utf-8");
const next = src.replace(/(FALLBACK_CLI_VERSION = ")[\d.]+(")/, `$1${version}$2`);
if (next === src) {
  console.log(`CLI version already ${version}`);
} else if (process.argv.includes("--check")) {
  console.error(`CLI version stale; latest is ${version}`);
  process.exit(1);
} else {
  writeFileSync(FILE, next, "utf-8");
  console.log(`CLI version bumped to ${version}`);
}
