import { OllamaLLMProvider, ollamaBaseUrl, ollamaModel } from "../lib/providers/llm/ollama";

async function main() {
  const baseUrl = ollamaBaseUrl();
  const model = ollamaModel();
  console.log(`[Ollama Test] Checking local Ollama at ${baseUrl} with model '${model}'...`);

  // 1. Check daemon
  try {
    const tagsRes = await fetch(`${baseUrl}/api/tags`);
    if (!tagsRes.ok) {
      console.error(`[Ollama Test] Daemon responded with HTTP ${tagsRes.status}`);
      process.exit(1);
    }
    const tags = (await tagsRes.json()) as { models?: Array<{ name: string }> };
    const available = tags.models?.map((m) => m.name) ?? [];
    console.log(`[Ollama Test] Installed models:`, available.join(", ") || "none");
    const found = available.some((m) => m === model || m.startsWith(`${model}:`));
    if (!found) {
      console.warn(`[Ollama Test] WARNING: Model '${model}' was not found in 'ollama list'. Run: ollama pull ${model}`);
    } else {
      console.log(`[Ollama Test] Model '${model}' is installed.`);
    }
  } catch (error) {
    console.error(`[Ollama Test] Could not connect to Ollama daemon at ${baseUrl}:`, error instanceof Error ? error.message : error);
    console.log(`[Ollama Test] Make sure Ollama is running. In PowerShell, run: ollama serve`);
    process.exit(1);
  }

  // 2. Test text completion
  console.log(`\n[Ollama Test] Testing text completion via complete()...`);
  const provider = new OllamaLLMProvider();
  const startText = Date.now();
  try {
    const textResult = await provider.complete({
      prompt: "Respond in 5 words or less: Are you ready?",
    });
    console.log(`[Ollama Test] Completion success (${Date.now() - startText}ms):`, textResult.text.trim());
    if (textResult.usage) {
      console.log(`[Ollama Test] Token usage:`, textResult.usage);
    }
  } catch (error) {
    console.error(`[Ollama Test] Text completion failed:`, error instanceof Error ? error.message : error);
  }

  // 3. Test character extraction with strict Zod validation
  console.log(`\n[Ollama Test] Testing character extraction with Zod validation (schema mode)...`);
  const schemaProvider = new OllamaLLMProvider({ formatMode: "schema" });
  const startChar = Date.now();
  try {
    const charResult = await schemaProvider.generateCharacters({
      title: "The Meeting",
      screenplay: [
        {
          sceneNumber: 1,
          heading: "INT. CAFE - DAY",
          location: "Cafe",
          timeOfDay: "Day",
          charactersPresent: ["Elena", "Marcus"],
          visualDescription: "A quiet corner table.",
          action: "Elena waits with coffee.",
          dialogue: [{ characterName: "Elena", line: "You came." }],
        },
      ],
    });
    console.log(`[Ollama Test] Character extraction success (${Date.now() - startChar}ms):`, charResult.characters.map((c) => `${c.name} (${c.role || "no role"})`));
  } catch (error) {
    console.error(`[Ollama Test] Character extraction failed:`, error instanceof Error ? error.message : error);
  }

  console.log(`\n[Ollama Test] All checks complete!`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
