import { afterEach, describe, expect, test } from "bun:test";
import { FALLBACK_CLI_VERSION, getCliVersion, refreshCliVersion } from "../src/version.js";
import { autoUpdateEnabled } from "../src/self-update.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.COMMANDCODE_GO_AUTO_UPDATE;
});

describe("cli version tracking", () => {
  test("getCliVersion is never older than the bundled fallback", () => {
    expect(getCliVersion().split(".").map(Number)[0]).toBeGreaterThanOrEqual(
      Number(FALLBACK_CLI_VERSION.split(".")[0]),
    );
  });

  test("refresh ignores malformed registry payloads and network errors", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ version: "not-a-version" }))) as unknown as typeof fetch;
    const before = getCliVersion();
    expect(await refreshCliVersion(true)).toBe(before);
    globalThis.fetch = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await refreshCliVersion(true)).toBe(before);
  });

  test("auto-update can be disabled via env", () => {
    expect(autoUpdateEnabled()).toBe(true);
    process.env.COMMANDCODE_GO_AUTO_UPDATE = "0";
    expect(autoUpdateEnabled()).toBe(false);
  });
});
