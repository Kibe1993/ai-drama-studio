"use client";

import { Plug, PlugZap } from "lucide-react";

export function MCPStatus({ configured }: { configured: boolean }) {
  return (
    <div
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{
        backgroundColor: configured ? "rgba(107, 179, 107, 0.12)" : "rgba(107, 98, 88, 0.12)",
        color: configured ? "#6bb36b" : "#a39b8f",
        border: `1px solid ${configured ? "rgba(107, 179, 107, 0.3)" : "rgba(107, 98, 88, 0.3)"}`,
      }}
      title={configured ? "MCP server is configured" : "MCP server is not configured"}
    >
      {configured ? <PlugZap className="h-3 w-3" /> : <Plug className="h-3 w-3" />}
      <span>MCP {configured ? "Ready" : "Off"}</span>
    </div>
  );
}