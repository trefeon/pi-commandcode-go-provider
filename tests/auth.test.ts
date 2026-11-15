import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { hasApiKey, resolveApiKey } from "../src/auth.js";

describe("auth", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.COMMANDCODE_API_KEY;
    delete process.env.COMMAND_CODE_API_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test("resolves explicit optionsApiKey first", () => {
    process.env.COMMANDCODE_API_KEY = "env_key_123";
    const key = resolveApiKey("explicit_key_456");
    expect(key).toBe("explicit_key_456");
  });

  test("resolves COMMANDCODE_API_KEY from environment", () => {
    process.env.COMMANDCODE_API_KEY = "env_key_abc";
    const key = resolveApiKey();
    expect(key).toBe("env_key_abc");
  });

  test("resolves COMMAND_CODE_API_KEY from environment if COMMANDCODE_API_KEY is unset", () => {
    process.env.COMMAND_CODE_API_KEY = "env_key_def";
    const key = resolveApiKey();
    expect(key).toBe("env_key_def");
  });

  test("reads key from local command-code-go-api-keys fixture if present", () => {
    const fixturePath = "command-code-go-api-keys";
    const alreadyExists = existsSync(fixturePath);
    if (!alreadyExists) {
      writeFileSync(fixturePath, "user_test_dummy_key_1234567890\n");
    }
    try {
      const key = resolveApiKey();
      expect(typeof key).toBe("string");
      expect(key!.length).toBeGreaterThan(10);
      expect(hasApiKey()).toBe(true);
    } finally {
      if (!alreadyExists && existsSync(fixturePath)) {
        unlinkSync(fixturePath);
      }
    }
  });
});
