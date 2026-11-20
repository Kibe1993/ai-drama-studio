import { Agent, fetch as undiciFetch } from "undici";

const BASE_URL = "http://127.0.0.1:11434";
const MODEL = "qwen3:4b-instruct-2507-q4_K_M";

const agent = new Agent({ headersTimeout: 600_000, bodyTimeout: 600_000 });

const systemPrompt = `Develop a detailed series bible, not a short pitch or generic list. Make the world, locations, history, rules, consequences, character motives, relationships, conflicts, and long-term story direction causally connected and internally consistent. Give major characters distinct goals, fears, contradictions, relationships, and credible development potential. Include supporting characters and antagonists where the idea supports them; do not add a crowd of interchangeable names. Make world rules operational: explain what they permit, what they forbid, who benefits, who is harmed, and what happens when a rule is broken. Support a long-running serialized story. Leave room for future seasons and do not force a final ending. Separate established truth from proposal. Put only explicit or logically entailed facts in confirmedFacts. Put new creative inventions in proposedDetails. Keep mysteries unresolved in unresolvedQuestions and do not state a guessed solution as fact. Character knowledge and audience knowledge are different. Do not give every character knowledge they have not earned. Stay inside every field limit: descriptions and world-system entries at most 700 characters; character background at most 900; personality and developmentPotential at most 700; centralPremise at most 2000; narrativeConcept and mainStoryline at most 1800; longTermDirection at most 1500; toneAndAtmosphere, storytellingStyle, and serializedEndingGuidance at most 800; targetAudience at most 500; each list item at most 400 characters. Use complete sentences and never omit a required field to add more detail. Respect the creator's language and requested direction. Do not include markdown or commentary; return only the requested JSON. Never repeat a phrase, sentence, or list item. Write each field once, keep it concise, and stop when the schema limit is reached. When the task is a single section, stay inside that section, reuse the established names and facts supplied below, and do not repeat or regenerate fields from other sections. The output must be valid JSON matching the schema. Do not wrap it in markdown code fences. The model is a small local model; keep the output focused and structured.`;

const userPrompt = `Mode: section
Working title: The Inheritance of Salt
Genre: family drama with supernatural elements
Original idea: A woman returns to her grandmother's coastal estate to settle the estate and discovers the family's ancestral salt-harvesting operation hides a centuries-old covenant with the sea that she must now uphold or break.

Established sections (do not repeat these — use them only as context):
identity: { "workingTitle": "The Inheritance of Salt", "genre": "family drama with supernatural elements", "centralPremise": "A woman inherits a coastal estate and discovers a covenant with the sea that her family has upheld for generations.", "targetAudience": "Readers who enjoy atmospheric family dramas with slow-burn supernatural elements, like The Salt Path or The Ocean at the End of the Lane." }
world: { "timePeriod": "Present day, late autumn", "primaryLocations": ["The coastal estate of Saltmere, perched on a cliff above a tidal inlet", "The salt-harvesting flats below the estate, accessible only at low tide", "The village of Threshpool, a small coastal community dependent on the estate"], "worldRules": ["The covenant requires a member of the family to harvest salt from the tidal flats every full moon, or the sea will reclaim the land.", "The salt harvested under the full moon has properties beyond ordinary salt — it preserves memories, can reveal truths, and can seal promises.", "Breaking the covenant causes the sea to encroach: first the flats, then the village, then the estate itself.", "Only a blood descendant of the original covenant-maker can harvest the salt and uphold the covenant."], "history": ["The covenant was made in 1742 by Elara Saltmere, who bargained with the sea to save her family from ruin after a devastating storm.", "Every generation since has upheld the covenant, though the practice has become increasingly difficult as the family line thins.", "The last salt-keeper, Grandmother Iris, was the last direct descendant. Her death has left the covenant unfulfilled for three full moons."] }

Section to generate: characters
Generate the characters section only. Include the protagonist, key supporting characters, and the antagonist. Each character needs: name, role, background (max 900 chars), personality (max 700 chars), goals, fears, relationships (to other characters), and developmentPotential (max 700 chars).

Return JSON matching this schema:
{ "characters": { "characters": [{ "name": string, "role": string, "background": string, "personality": string, "goals": [string], "fears": [string], "relationships": [{ "character": string, "description": string }], "developmentPotential": string }] } }`;

async function bench(numCtx, label) {
  const payload = {
    model: MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    stream: true,
    format: "json",
    options: {
      temperature: 0.2,
      top_p: 0.8,
      repeat_penalty: 1.3,
      repeat_last_n: 128,
      num_predict: 2500,
      num_ctx: numCtx,
    },
  };

  const start = Date.now();
  const res = await undiciFetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    dispatcher: agent,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let inputTokens, outputTokens, loadDuration, promptEvalDuration, evalDuration, totalDuration, doneReason;

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
        if (typeof chunk.done_reason === "string") doneReason = chunk.done_reason;
        if (typeof chunk.load_duration === "number") loadDuration = chunk.load_duration;
        if (typeof chunk.prompt_eval_duration === "number") promptEvalDuration = chunk.prompt_eval_duration;
        if (typeof chunk.eval_duration === "number") evalDuration = chunk.eval_duration;
        if (typeof chunk.total_duration === "number") totalDuration = chunk.total_duration;
      } catch {}
    }
  }

  const wallMs = Date.now() - start;
  const tps = outputTokens != null && evalDuration ? (outputTokens / (evalDuration / 1e9)).toFixed(2) : "?";
  const peTps = inputTokens != null && promptEvalDuration ? (inputTokens / (promptEvalDuration / 1e9)).toFixed(2) : "?";

  console.log(`\n=== ${label} (num_ctx=${numCtx}) ===`);
  console.log(`  Wall time:       ${(wallMs / 1000).toFixed(1)}s`);
  console.log(`  Input tokens:    ${inputTokens ?? "?"}`);
  console.log(`  Output tokens:   ${outputTokens ?? "?"}`);
  console.log(`  Load duration:   ${loadDuration != null ? (loadDuration / 1e9).toFixed(1) + "s" : "?"}`);
  console.log(`  Prompt eval:     ${promptEvalDuration != null ? (promptEvalDuration / 1e9).toFixed(1) + "s" : "?"} (${peTps} t/s)`);
  console.log(`  Eval (gen):      ${evalDuration != null ? (evalDuration / 1e9).toFixed(1) + "s" : "?"} (${tps} t/s)`);
  console.log(`  Total:           ${totalDuration != null ? (totalDuration / 1e9).toFixed(1) + "s" : "?"}`);
  console.log(`  Done reason:     ${doneReason ?? "?"}`);
  console.log(`  Output chars:    ${text.length}`);
  console.log(`  JSON valid:      ${(() => { try { JSON.parse(text); return "yes"; } catch { return "no"; } })()}`);

  return { wallMs, inputTokens, outputTokens, tps: parseFloat(tps), peTps: parseFloat(peTps) };
}

async function main() {
  console.log("Benchmarking 8,192 vs 16,384 context window");
  console.log(`Model: ${MODEL}`);
  console.log(`System prompt: ${systemPrompt.length} chars`);
  console.log(`User prompt:   ${userPrompt.length} chars`);
  console.log(`Total input:   ${systemPrompt.length + userPrompt.length} chars`);

  console.log("\n--- Warmup 1: num_ctx=8192 ---");
  await bench(8192, "warmup 8192");
  console.log("\n--- Benchmark 1: num_ctx=8192 ---");
  const r8192 = await bench(8192, "benchmark 8192");

  console.log("\n--- Warmup 2: num_ctx=16384 (includes model reload) ---");
  await bench(16384, "warmup 16384");
  console.log("\n--- Benchmark 2: num_ctx=16384 ---");
  const r16384 = await bench(16384, "benchmark 16384");

  console.log("\n=== COMPARISON ===");
  console.log(`  Wall time:   8192=${(r8192.wallMs/1000).toFixed(1)}s  16384=${(r16384.wallMs/1000).toFixed(1)}s  diff=${((r16384.wallMs - r8192.wallMs)/1000).toFixed(1)}s`);
  console.log(`  Gen speed:   8192=${r8192.tps} t/s  16384=${r16384.tps} t/s  diff=${(r16384.tps - r8192.tps).toFixed(2)} t/s`);
  console.log(`  PE speed:    8192=${r8192.peTps} t/s  16384=${r16384.peTps} t/s  diff=${(r16384.peTps - r8192.peTps).toFixed(2)} t/s`);
  console.log(`  Output:      8192=${r8192.outputTokens} tokens  16384=${r16384.outputTokens} tokens`);
}

main().catch(e => { console.error("Benchmark failed:", e.message); process.exit(1); });