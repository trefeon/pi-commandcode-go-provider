import { describe, expect, test } from "bun:test";
import { COMMAND_CODE_GO_MODELS, resolveModel, toWireModelId } from "../src/catalog.js";

describe("catalog", () => {
  test("contains at least 30 Command Code Go models", () => {
    expect(COMMAND_CODE_GO_MODELS.length).toBeGreaterThanOrEqual(30);
  });

  test("contains key flagship models", () => {
    const ids = COMMAND_CODE_GO_MODELS.map((m) => m.id);
    expect(ids).toContain("thinkingmachines/inkling-2-small:free");
    expect(ids).toContain("stealth/glyph-cluster:free");
    expect(ids).toContain("deepseek/deepseek-v4-flash");
    expect(ids).toContain("deepseek/deepseek-v4-pro");
    expect(ids).toContain("google/gemini-3.5-flash");
    expect(ids).toContain("moonshotai/Kimi-K2.7-Code");
    expect(ids).toContain("MiniMaxAI/MiniMax-M3");
    expect(ids).toContain("Qwen/Qwen3.7-Plus");
    expect(ids).toContain("gpt-5.4");
    expect(ids).toContain("claude-sonnet-5");
  });

  test("normalizes vendor prefixes to wire model IDs", () => {
    expect(toWireModelId("deepseek-v4-flash")).toBe("deepseek/deepseek-v4-flash");
    expect(toWireModelId("gemini-3.5-flash")).toBe("google/gemini-3.5-flash");
    expect(toWireModelId("kimi-k2.7-code")).toBe("moonshotai/Kimi-K2.7-Code");
    expect(toWireModelId("minimax-m3")).toBe("MiniMaxAI/MiniMax-M3");
    expect(toWireModelId("qwen3.7-plus")).toBe("Qwen/Qwen3.7-Plus");
    expect(toWireModelId("inkling-2-small:free")).toBe("thinkingmachines/inkling-2-small:free");
    expect(toWireModelId("glyph-cluster:free")).toBe("stealth/glyph-cluster:free");
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
