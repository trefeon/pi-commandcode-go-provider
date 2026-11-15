import { resolveApiKey } from "../src/auth.js";
import { resolveModel } from "../src/catalog.js";
import { streamCommandCodeGo } from "../src/stream.js";

const modelId = process.argv[2] ?? "thinkingmachines/inkling-2-small:free";
const prompt = process.argv[3] ?? "Say 1";

console.log(`[test-model] Testing model: ${modelId}`);
console.log(`[test-model] Prompt: "${prompt}"`);

const key = resolveApiKey();
if (!key) {
  console.error("[test-model] Error: No API key found!");
  process.exit(1);
}
console.log(`[test-model] API Key found (starts with: ${key.slice(0, 6)}...)`);

const model = resolveModel(modelId);
console.log(`[test-model] Resolved model: ${model.id} (${model.name}), cost: ${JSON.stringify(model.cost)}`);

const stream = streamCommandCodeGo(
  model,
  {
    systemPrompt: "You are a concise test assistant.",
    messages: [{ role: "user", content: prompt }],
  },
  {
    maxTokens: 128,
    temperature: 0,
  }
);

let fullText = "";
let thinkingText = "";

for await (const event of stream) {
  if (event.type === "text_delta") {
    process.stdout.write(event.delta);
    fullText += event.delta;
  } else if (event.type === "thinking_delta") {
    thinkingText += event.delta;
  } else if (event.type === "error") {
    console.error(`\n[test-model] Stream error:`, event.error.errorMessage);
  } else if (event.type === "done") {
    console.log(`\n\n[test-model] Stream finished successfully.`);
    console.log(`[test-model] Reason:`, event.reason);
    console.log(`[test-model] Usage:`, event.message.usage);
  }
}

if (thinkingText) {
  console.log(`\n[test-model] Thinking:`, thinkingText);
}
console.log(`\n[test-model] Final text output: "${fullText}"`);
