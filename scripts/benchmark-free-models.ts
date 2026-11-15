import { resolveModel } from "../src/catalog.js";
import { streamCommandCodeGo } from "../src/stream.js";
import type { CommandCodeGoModel } from "../src/types.js";

interface BenchmarkResult {
  modelId: string;
  testName: string;
  ttftMs: number;
  totalMs: number;
  inputTokens: number;
  outputTokens: number;
  tokensPerSec: number;
  thinkingTokens?: number;
  outputPreview: string;
  passed: boolean;
  notes: string;
}

const FREE_MODELS = [
  "thinkingmachines/inkling-2-small:free",
  "stealth/glyph-cluster:free",
];

const TESTS = [
  {
    name: "1. Speed & TTFT (Concise Reply)",
    system: "You are an ultra-fast concise assistant. Comply immediately.",
    prompt: "Respond with the single word 'CONFIRMED' and nothing else.",
    verify: (out: string) => out.trim().toUpperCase().includes("CONFIRMED"),
  },
  {
    name: "2. Structured JSON Generation",
    system: "You are a JSON generator. Emit ONLY raw JSON, no markdown fences, no commentary.",
    prompt: 'Return a JSON object with keys: "status" (string: "ok"), "code" (number: 200), "items" (array of strings: ["apple", "banana", "cherry"]).',
    verify: (out: string) => {
      try {
        const clean = out.replace(/```json/g, "").replace(/```/g, "").trim();
        const obj = JSON.parse(clean);
        return obj.status === "ok" && obj.code === 200 && Array.isArray(obj.items) && obj.items.length === 3;
      } catch {
        return false;
      }
    },
  },
  {
    name: "3. Coding (LRU Cache in TypeScript)",
    system: "You are an expert TypeScript engineer. Write clean, working code.",
    prompt: "Write a minimal TypeScript class `LRUCache<K, V>` with `get(key: K): V | undefined` and `put(key: K, val: V): void` using a Map. Keep it under 25 lines of code.",
    verify: (out: string) => out.includes("class LRUCache") && out.includes("get") && out.includes("put"),
  },
  {
    name: "4. Logic & Deduction",
    system: "You are a logic puzzle solver. State your final answer clearly on the last line as 'ANSWER: <X>'.",
    prompt: "Three boxes are labeled: 'Apples', 'Oranges', and 'Apples and Oranges'. Every box is incorrectly labeled. You pick one fruit from the box labeled 'Apples and Oranges' and it is an Apple. What are the true contents of each of the three boxes?",
    verify: (out: string) => out.toLowerCase().includes("oranges") && out.toLowerCase().includes("apples"),
  },
];

async function runSingleTest(modelId: string, testDef: typeof TESTS[0]): Promise<BenchmarkResult> {
  const model = resolveModel(modelId);
  const startTime = performance.now();
  let firstTokenTime: number | null = null;
  let fullText = "";
  let thinkingText = "";
  let usage = { input: 0, output: 0, total: 0 };

  const maxTokens = testDef.name.includes("Coding") ? 1024 : 512;
  const stream = streamCommandCodeGo(
    model,
    {
      systemPrompt: testDef.system,
      messages: [{ role: "user", content: testDef.prompt }],
    },
    {
      maxTokens,
      temperature: 0,
    }
  );

  for await (const event of stream) {
    if (event.type === "text_delta" || event.type === "thinking_delta") {
      if (firstTokenTime === null) {
        firstTokenTime = performance.now();
      }
      if (event.type === "text_delta") {
        fullText += event.delta;
      } else {
        thinkingText += event.delta;
      }
    } else if (event.type === "done") {
      usage = {
        input: event.message.usage.input,
        output: event.message.usage.output,
        total: event.message.usage.totalTokens,
      };
    }
  }

  const endTime = performance.now();
  const ttftMs = firstTokenTime ? Math.round(firstTokenTime - startTime) : Math.round(endTime - startTime);
  const totalMs = Math.round(endTime - startTime);
  const decodeDurationSec = (endTime - (firstTokenTime ?? startTime)) / 1000;
  const tokensPerSec = decodeDurationSec > 0 ? Math.round(usage.output / decodeDurationSec) : 0;
  const passed = testDef.verify(fullText);

  return {
    modelId,
    testName: testDef.name,
    ttftMs,
    totalMs,
    inputTokens: usage.input,
    outputTokens: usage.output,
    tokensPerSec,
    outputPreview: fullText.trim().slice(0, 120).replace(/\n/g, " "),
    passed,
    notes: thinkingText ? `Thinking: ${thinkingText.length} chars` : "Direct answer",
  };
}

async function main() {
  console.log("================================================================================");
  console.log("       COMMAND CODE GO — FREE MODELS BENCHMARK SUITE");
  console.log("================================================================================");
  console.log("Models: " + FREE_MODELS.join(", "));
  console.log("Battery: " + TESTS.length + " tests per model");
  console.log("Cost: $0.00 (100% Free models)");
  console.log("--------------------------------------------------------------------------------\n");

  const results: BenchmarkResult[] = [];

  for (const modelId of FREE_MODELS) {
    console.log(`\n>>> Running Benchmark on: ${modelId} ...`);
    for (const testDef of TESTS) {
      process.stdout.write(`  - Running [${testDef.name}] ... `);
      try {
        const res = await runSingleTest(modelId, testDef);
        results.push(res);
        console.log(`DONE in ${res.totalMs}ms | TTFT: ${res.ttftMs}ms | ${res.tokensPerSec} tok/s | ${res.passed ? "PASS" : "FAIL"}`);
      } catch (err) {
        console.log(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  console.log("\n================================================================================");
  console.log("                             BENCHMARK SUMMARY");
  console.log("================================================================================");
  console.table(
    results.map((r) => ({
      Model: r.modelId.replace(":free", "").split("/")[1] ?? r.modelId,
      Test: r.testName.slice(0, 22),
      "TTFT (ms)": r.ttftMs,
      "Total (ms)": r.totalMs,
      "Speed (tok/s)": r.tokensPerSec,
      "In / Out": `${r.inputTokens} / ${r.outputTokens}`,
      Pass: r.passed ? "YES" : "NO",
      Notes: r.notes,
    }))
  );
}

main().catch(console.error);
