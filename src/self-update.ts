import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const PLUGIN_DIR = fileURLToPath(new URL("..", import.meta.url));

async function git(args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { cwd: PLUGIN_DIR, timeout: 30_000, windowsHide: true });
  return stdout.trim();
}

export interface UpdateResult {
  status: "updated" | "current" | "skipped";
  detail: string;
}

/** Fast-forwards the plugin checkout from its upstream. Skips dirty trees, non-git installs, and diverged branches. */
export async function selfUpdate(): Promise<UpdateResult> {
  if (!existsSync(join(PLUGIN_DIR, ".git"))) return { status: "skipped", detail: "not a git checkout" };
  try {
    if (await git(["status", "--porcelain", "--untracked-files=no"])) {
      return { status: "skipped", detail: "local changes present" };
    }
    await git(["fetch", "--quiet"]);
    const behind = Number.parseInt(await git(["rev-list", "--count", "HEAD..@{u}"]), 10);
    if (!Number.isFinite(behind) || behind === 0) return { status: "current", detail: "already up to date" };
    await git(["merge", "--ff-only", "@{u}"]);
    return { status: "updated", detail: `pulled ${behind} commit(s)` };
  } catch (err) {
    return { status: "skipped", detail: err instanceof Error ? err.message.split("\n")[0] : String(err) };
  }
}

export function autoUpdateEnabled(): boolean {
  return process.env.COMMANDCODE_GO_AUTO_UPDATE !== "0";
}
