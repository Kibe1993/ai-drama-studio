import { logged } from "@/lib/http/logged";
import { readActor } from "@/lib/http/request";
import { jsonData } from "@/lib/http/errors";
import { listChatAgentProviders } from "@/lib/providers/chat/registry";

export function GET(request: Request) {
  return logged(request, async () => {
    await readActor();
    return jsonData({ providers: listChatAgentProviders() });
  });
}