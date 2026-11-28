import { logged } from "@/lib/http/logged";
import { readActor } from "@/lib/http/request";
import { jsonData } from "@/lib/http/errors";
import { listChatAgentProviders } from "@/lib/providers/chat/registry";
import { fetchOllamaModels } from "@/lib/providers/chat/ollamaChatProvider";

export function GET(request: Request) {
  return logged(request, async () => {
    await readActor();
    const providers = listChatAgentProviders();
    try {
      const ollamaModels = await fetchOllamaModels(undefined, request.signal);
      const ollamaEntry = providers.find((p) => p.id === "ollama");
      if (ollamaEntry) {
        ollamaEntry.models = ollamaModels.length > 0 ? ollamaModels : ollamaEntry.models;
        ollamaEntry.configured = true;
      }
    } catch {
      const ollamaEntry = providers.find((p) => p.id === "ollama");
      if (ollamaEntry) {
        ollamaEntry.configured = false;
      }
    }
    return jsonData({ providers });
  });
}