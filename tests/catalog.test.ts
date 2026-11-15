import { describe, expect, test } from "bun:test";
import { COMMAND_CODE_GO_MODELS, resolveModel, toWireModelId } from "../src/catalog.js";

describe("catalog", () => {
  test("contains only Go-tier models with zero duplicates", () => {
    expect(COMMAND_CODE_GO_MODELS.length).toBeGreaterThanOrEqual(20);
    const ids = COMMAND_CODE_GO_MODELS.map((m) => m.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
    for (const unavailable of [
      "gpt-5.4",
      "gpt-5.5",
      "claude-sonnet-5",
      "claude-opus-4-7",
      "claude-haiku-4-5-20251001",
    ]) {
      expect(ids).not.toContain(unavailable);
    }
  });

  test("contains key flagship Go models without duplicate prefixes", () => {
    const ids = COMMAND_CODE_GO_MODELS.map((m) => m.id);
    expect(ids).toContain("inkling-2-small-free");
    expect(ids).toContain("glyph-cluster-free");
    expect(ids).toContain("deepseek-v4.1-flash");
    expect(ids).toContain("deepseek-v4-pro");
    expect(ids).toContain("kimi-k2.7-code");
    expect(ids).toContain("minimax-m3");
    expect(ids).toContain("qwen3.7-plus");
    expect(ids).toContain("gpt-6-luna");
    expect(ids).toContain("muse-ember");
  });
  test("normalizes vendor prefixes to wire model IDs", () => {
    expect(toWireModelId("deepseek-v4.1-flash")).toBe("deepseek/deepseek-v4.1-flash");
    expect(toWireModelId("deepseek-v4-flash")).toBe("deepseek/deepseek-v4-flash");
    expect(toWireModelId("kimi-k2.7-code")).toBe("moonshotai/Kimi-K2.7-Code");
    expect(toWireModelId("minimax-m3")).toBe("MiniMaxAI/MiniMax-M3");
    expect(toWireModelId("qwen3.7-plus")).toBe("Qwen/Qwen3.7-Plus");
    expect(toWireModelId("inkling-2-small-free")).toBe("thinkingmachines/inkling-2-small:free");
    expect(toWireModelId("glyph-cluster-free")).toBe("stealth/glyph-cluster:free");
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
