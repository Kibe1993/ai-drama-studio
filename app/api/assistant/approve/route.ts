import { logged } from "@/lib/http/logged";
import { readActor, readJson } from "@/lib/http/request";
import { jsonData } from "@/lib/http/errors";

const pendingApprovals = new Map<string, { approved: boolean }>();

export function POST(request: Request) {
  return logged(request, async () => {
    await readActor();
    const body = await readJson(request);
    const toolCallId = (body as { toolCallId?: string })?.toolCallId;
    const approved = (body as { approved?: boolean })?.approved;
    if (!toolCallId) {
      return jsonData({ ok: false, error: "Missing toolCallId" });
    }
    pendingApprovals.set(toolCallId, { approved: Boolean(approved) });
    return jsonData({ ok: true });
  });
}

export function getApproval(toolCallId: string): { approved: boolean } | undefined {
  return pendingApprovals.get(toolCallId);
}

export function clearApproval(toolCallId: string): void {
  pendingApprovals.delete(toolCallId);
}