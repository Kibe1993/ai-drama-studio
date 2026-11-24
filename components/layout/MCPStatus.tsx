"use client";

import { Plug, PlugZap } from "lucide-react";

export function MCPStatus({ configured }: { configured: boolean }) {
  return (
    <div
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{
        backgroundColor: configured ? "var(--color-green-100, #dcfce7)" : "var(--color-gray-100, #f3f4f6)",
        color: configured ? "var(--color-green-700, #15803d)" : "var(--color-gray-500, #6b7280)",
      }}
      title={configured ? "MCP server is configured" : "MCP server is not configured"}
    >
      {configured ? <PlugZap className="h-3 w-3" /> : <Plug className="h-3 w-3" />}
      <span>MCP {configured ? "Ready" : "Off"}</span>
    </div>
  );
}