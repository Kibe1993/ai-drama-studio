import { logged } from "@/lib/http/logged";
import { readActor, readJson } from "@/lib/http/request";
import { jsonData } from "@/lib/http/errors";
import { resolveApproval } from "@/lib/assistant/approvalManager";

export function POST(request: Request) {
  return logged(request, async () => {
    await readActor();
    const body = await readJson(request);
    const toolCallId = (body as { toolCallId?: string })?.toolCallId;
    const approved = (body as { approved?: boolean })?.approved;
    if (!toolCallId) {
      return jsonData({ ok: false, error: "Missing toolCallId" });
    }
    const resolved = resolveApproval(toolCallId, Boolean(approved));
    return jsonData({ ok: resolved });
  });
}