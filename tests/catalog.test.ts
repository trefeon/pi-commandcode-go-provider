import { describe, expect, test } from "bun:test";
import { COMMAND_CODE_GO_MODELS, resolveModel, toWireModelId } from "../src/catalog.js";

describe("catalog", () => {
  test("contains at least 30 Command Code Go models", () => {
    expect(COMMAND_CODE_GO_MODELS.length).toBeGreaterThanOrEqual(30);
  });

  test("contains key flagship models", () => {
    const ids = COMMAND_CODE_GO_MODELS.map((m) => m.id);
    expect(ids).toContain("claude-haiku-4-5-20251001");
    expect(ids).toContain("claude-opus-4-7");
    expect(ids).toContain("claude-sonnet-4-6");
    expect(ids).toContain("claude-sonnet-5");
    expect(ids).toContain("deepseek-v4-flash");
    expect(ids).toContain("deepseek-v4-pro");
    expect(ids).toContain("gpt-5.3-codex");
    expect(ids).toContain("gpt-5.4");
    expect(ids).toContain("gemini-3.5-flash");
    expect(ids).toContain("kimi-k2.7-code");
    expect(ids).toContain("minimax-m3");
    expect(ids).toContain("qwen3.7-plus");
  });

  test("normalizes vendor prefixes to wire model IDs", () => {
    expect(toWireModelId("deepseek/deepseek-v4-flash")).toBe("deepseek-v4-flash");
    expect(toWireModelId("google/gemini-3.5-flash")).toBe("gemini-3.5-flash");
    expect(toWireModelId("moonshotai/Kimi-K2.7-Code")).toBe("kimi-k2.7-code");
    expect(toWireModelId("MiniMaxAI/MiniMax-M3")).toBe("minimax-m3");
    expect(toWireModelId("Qwen/Qwen3.7-Plus")).toBe("qwen3.7-plus");
  });

  test("provides dynamic fallback for uncatalogued models", () => {
    const fallback = resolveModel("future-model-99");
    expect(fallback.id).toBe("future-model-99");
    expect(fallback.contextWindow).toBe(1_000_000);
    expect(fallback.maxTokens).toBe(64_000);
  });

  test("all models have valid context window and maxTokens", () => {
    for (const model of COMMAND_CODE_GO_MODELS) {
      expect(model.contextWindow).toBeGreaterThan(0);
      expect(model.maxTokens).toBeGreaterThan(0);
      expect(model.name).toBeTruthy();
    }
  });
});
