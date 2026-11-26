import "server-only";

type PendingEntry = {
  resolve: (approved: boolean) => void;
  timeout: ReturnType<typeof setTimeout>;
};

const pendingApprovals = new Map<string, PendingEntry>();

export function createPendingApproval(toolCallId: string, timeoutMs = 120_000): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      pendingApprovals.delete(toolCallId);
      resolve(false);
    }, timeoutMs);
    pendingApprovals.set(toolCallId, { resolve, timeout });
  });
}

export function resolveApproval(toolCallId: string, approved: boolean): boolean {
  const entry = pendingApprovals.get(toolCallId);
  if (!entry) return false;
  clearTimeout(entry.timeout);
  pendingApprovals.delete(toolCallId);
  entry.resolve(approved);
  return true;
}

export function cancelApproval(toolCallId: string): void {
  const entry = pendingApprovals.get(toolCallId);
  if (!entry) return;
  clearTimeout(entry.timeout);
  pendingApprovals.delete(toolCallId);
  entry.resolve(false);
}

export function hasPendingApproval(toolCallId: string): boolean {
  return pendingApprovals.has(toolCallId);
}