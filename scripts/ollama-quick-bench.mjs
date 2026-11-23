import { Agent, setGlobalDispatcher } from "undici";

const BASE_URL = "http://127.0.0.1:11434";
const MODEL = "qwen3:4b-instruct-2507-q4_K_M";

setGlobalDispatcher(new Agent({ headersTimeout: 300_000, bodyTimeout: 300_000 }));

const systemPrompt = "You are a helpful assistant. Return only valid JSON.";
const userPrompt = `Return a JSON object with a "title" field and a "description" field. Both must be non-empty strings. The title should be "The Courtyard" and the description should be exactly 2 sentences about a family drama.`;

const sectionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string", minLength: 1 },
    description: { type: "string", minLength: 1 },
  },
  required: ["title", "description"],
};

async function bench(label, opts) {
  const payload = {
    model: MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    stream: true,
    format: opts.format ?? "json",
    options: {
      temperature: 0.2,
      top_p: 0.8,
      repeat_penalty: 1.3,
      num_predict: 200,
      num_ctx: opts.numCtx,
    },
  };

  const start = Date.now();
  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let inputTokens, outputTokens, loadDuration, promptEvalDuration, evalDuration;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const chunk = JSON.parse(trimmed);
        if (chunk.message?.content) text += chunk.message.content;
        if (typeof chunk.prompt_eval_count === "number") inputTokens = chunk.prompt_eval_count;
        if (typeof chunk.eval_count === "number") outputTokens = chunk.eval_count;
        if (typeof chunk.load_duration === "number") loadDuration = chunk.load_duration;
        if (typeof chunk.prompt_eval_duration === "number") promptEvalDuration = chunk.prompt_eval_duration;
        if (typeof chunk.eval_duration === "number") evalDuration = chunk.eval_duration;
      } catch {}
    }
  }

  const wallMs = Date.now() - start;
  const tps = outputTokens != null && evalDuration ? (outputTokens / (evalDuration / 1e9)).toFixed(2) : "?";
  const peTps = inputTokens != null && promptEvalDuration ? (inputTokens / (promptEvalDuration / 1e9)).toFixed(2) : "?";

  console.log(`\n=== ${label} ===`);
  console.log(`  Wall time:     ${(wallMs / 1000).toFixed(1)}s`);
  console.log(`  Input tokens:  ${inputTokens ?? "?"}`);
  console.log(`  Output tokens: ${outputTokens ?? "?"}`);
  console.log(`  Load:          ${loadDuration != null ? (loadDuration / 1e9).toFixed(1) + "s" : "?"}`);
  console.log(`  Prompt eval:   ${promptEvalDuration != null ? (promptEvalDuration / 1e9).toFixed(1) + "s" : "?"} (${peTps} t/s)`);
  console.log(`  Token gen:     ${evalDuration != null ? (evalDuration / 1e9).toFixed(1) + "s" : "?"} (${tps} t/s)`);

  return { wallMs, inputTokens, outputTokens, tps: parseFloat(tps), peTps: parseFloat(peTps) };
}

async function main() {
  console.log("Quick benchmark: num_ctx and format comparison");
  console.log(`Model: ${MODEL}`);
  console.log(`Prompt: ${systemPrompt.length + userPrompt.length} chars`);

  console.log("\n--- R7: num_ctx 8192 vs 16384 (format=json) ---");
  const r8192 = await bench("num_ctx=8192, json", { numCtx: 8192, format: "json" });
  const r16384 = await bench("num_ctx=16384, json", { numCtx: 16384, format: "json" });

  console.log("\n--- R8: schema vs json (num_ctx=8192) ---");
  const rJson = await bench("format=json", { numCtx: 8192, format: "json" });
  const rSchema = await bench("format=schema", { numCtx: 8192, format: sectionSchema });

  console.log("\n=== R7 SUMMARY (num_ctx) ===");
  console.log(`  Wall time:  8192=${(r8192.wallMs/1000).toFixed(1)}s  16384=${(r16384.wallMs/1000).toFixed(1)}s`);
  console.log(`  Gen speed:  8192=${r8192.tps} t/s  16384=${r16384.tps} t/s`);
  console.log(`  PE speed:   8192=${r8192.peTps} t/s  16384=${r16384.peTps} t/s`);

  console.log("\n=== R8 SUMMARY (format) ===");
  console.log(`  Wall time:  json=${(rJson.wallMs/1000).toFixed(1)}s  schema=${(rSchema.wallMs/1000).toFixed(1)}s`);
  console.log(`  Gen speed:  json=${rJson.tps} t/s  schema=${rSchema.tps} t/s`);
  console.log(`  PE speed:   json=${rJson.peTps} t/s  schema=${rSchema.peTps} t/s`);
}

main().catch(e => { console.error("Benchmark failed:", e.message); process.exit(1); });