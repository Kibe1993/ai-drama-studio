"use client";

import { useState, useEffect, useCallback } from "react";
import { Wrench, FileText, Plug, Copy, Check, AlertTriangle, Terminal } from "lucide-react";
import styles from "./mcp.module.css";

interface McpStatus {
  configured: boolean;
  endpoint: string;
  toolCount: number;
  resourceCount: number;
  authMode: string;
}

const TOOLS = [
  "project.list", "project.get", "project.create", "project.update", "project.delete",
  "document.read", "document.update", "document.import",
  "canon.add", "canon.summary",
  "media.upload", "media.generate_audio",
  "render.start",
] as const;

const RESOURCES = [
  "project://list", "project://{id}", "story://{projectId}/draft",
  "bible://{projectId}", "canon://{projectId}", "timeline://{projectId}",
] as const;

const ASSISTANT_CONFIGS = [
  {
    name: "Claude Desktop",
    config: `{
  "mcpServers": {
    "drama-studio": {
      "url": "<ENDPOINT>",
      "headers": {
        "Authorization": "Bearer <TOKEN>"
      }
    }
  }
}`,
    note: "Add to ~/Library/Application Support/Claude/claude_desktop_config.json (macOS) or %APPDATA%\\Claude\\claude_desktop_config.json (Windows).",
  },
  {
    name: "Cline (VS Code)",
    config: `{
  "mcpServers": {
    "drama-studio": {
      "url": "<ENDPOINT>",
      "headers": {
        "Authorization": "Bearer <TOKEN>"
      },
      "disabled": false,
      "alwaysAllow": []
    }
  }
}`,
    note: "Add via Cline settings > MCP Servers, or edit cline_mcp_settings.json in your VS Code profile.",
  },
  {
    name: "Kimi / Moonshot",
    config: `# Kimi supports MCP via stdio bridge:
# python -m mcp_client --http-url <ENDPOINT> --token <TOKEN>

# Or configure in Kimi's MCP panel:
Server URL: <ENDPOINT>
Auth Header: Authorization: Bearer <TOKEN>`,
    note: "Kimi's MCP integration uses an HTTP-to-stdio bridge. Check Kimi docs for the latest configuration format.",
  },
  {
    name: "Qwen / Tongyi",
    config: `# Qwen Agent MCP config (application.yml):
mcp:
  servers:
    drama-studio:
      url: <ENDPOINT>
      headers:
        Authorization: Bearer <TOKEN>`,
    note: "Configure in your Qwen Agent application config. The server supports streamable HTTP transport.",
  },
  {
    name: "Gemini CLI",
    config: `{
  "mcpServers": {
    "drama-studio": {
      "url": "<ENDPOINT>",
      "headers": {
        "Authorization": "Bearer <TOKEN>"
      }
    }
  }
}`,
    note: "Add to Gemini CLI's settings.json MCP servers section.",
  },
  {
    name: "ChatGPT (Custom GPT)",
    config: `# ChatGPT does not natively support MCP yet.
# Use the stdio bridge as a Custom Action:
# 1. Run: npm run mcp:server
# 2. Expose via ngrok or cloudflared
# 3. Add as a Custom GPT Action with OpenAPI schema

# HTTP endpoint for future MCP support:
# <ENDPOINT>`,
    note: "ChatGPT does not yet have native MCP support. Use the stdio server with a tunnel, or wait for OpenAI MCP integration.",
  },
];

export default function McpPage() {
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const token = process.env.NEXT_PUBLIC_MCP_AUTH_TOKEN;
    setStatus({
      configured: true,
      endpoint: `${origin}/api/mcp`,
      toolCount: TOOLS.length,
      resourceCount: RESOURCES.length,
      authMode: token ? "Bearer token" : "Clerk session",
    });
    setLoading(false);
  }, []);

  const copy = useCallback((text: string, id: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    });
  }, []);

  if (loading || !status) {
    return <div className={styles.page}><p style={{ color: "#a39b8f" }}>Loading MCP status…</p></div>;
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <p className={styles.eyebrow}>Integration</p>
        <h1 className={styles.title}>MCP Server</h1>
        <p className={styles.subtitle}>
          Connect external AI assistants — Claude, Kimi, Qwen, Cline, Gemini — to your drama studio
          via the Model Context Protocol. The server exposes {status.toolCount} tools and{" "}
          {status.resourceCount} resources over streamable HTTP with per-user authentication.
        </p>
      </div>

      <div className={styles.grid}>
        <div className={styles.card}>
          <div className={styles.cardTitle}>Server Status</div>
          <div className={styles.statusRow}>
            <span className={`${styles.statusDot} ${styles.statusDotOnline}`} />
            <span className={styles.statusText}>Online</span>
          </div>
          <div className={styles.stats}>
            <div>
              <div className={styles.statValue}>{status.toolCount}</div>
              <div className={styles.statLabel}>Tools</div>
            </div>
            <div>
              <div className={styles.statValue}>{status.resourceCount}</div>
              <div className={styles.statLabel}>Resources</div>
            </div>
            <div>
              <div className={styles.statValue}>HTTP</div>
              <div className={styles.statLabel}>Transport</div>
            </div>
          </div>
          <div className={styles.endpoint}>
            <Plug size={14} style={{ color: "#c4a574", flexShrink: 0 }} />
            <span>{status.endpoint}</span>
            <button className={styles.copyBtn} onClick={() => copy(status.endpoint, "endpoint")}>
              {copied === "endpoint" ? <Check size={12} /> : <Copy size={12} />}
              {copied === "endpoint" ? "Copied" : "Copy"}
            </button>
          </div>
          <p className={styles.note}>
            Auth mode: <code>{status.authMode}</code>. Set <code>MCP_AUTH_TOKEN</code> and{" "}
            <code>MCP_ACTOR_USER_ID</code> env vars for Bearer token auth, or use Clerk session
            cookies for browser-based access.
          </p>
        </div>

        <div className={styles.card}>
          <div className={styles.cardTitle}>Available Tools</div>
          <div className={styles.toolGrid}>
            {TOOLS.map((tool) => (
              <div key={tool} className={styles.toolItem}>
                <Wrench size={13} className={styles.toolIcon} />
                <span>{tool}</span>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.card}>
          <div className={styles.cardTitle}>Resources</div>
          <div className={styles.toolGrid}>
            {RESOURCES.map((res) => (
              <div key={res} className={styles.toolItem}>
                <FileText size={13} className={styles.toolIcon} />
                <span>{res}</span>
              </div>
            ))}
          </div>
        </div>

        <div className={`${styles.card} ${styles.warning}`}>
          <div className={styles.cardTitle}>Approval Workflows</div>
          <p className={styles.warningText}>
            Destructive operations require explicit confirmation:
          </p>
          <ul className={styles.warningText} style={{ marginTop: "0.5rem", paddingLeft: "1.2rem" }}>
            <li><code style={{ color: "#c4a574" }}>project.delete</code> — requires <code style={{ color: "#c4a574" }}>confirmProjectName</code> matching the title</li>
            <li><code style={{ color: "#c4a574" }}>document.update</code> — requires <code style={{ color: "#c4a574" }}>confirm: true</code> to apply changes</li>
            <li><code style={{ color: "#c4a574" }}>document.import</code> — requires <code style={{ color: "#c4a574" }}>confirm: true</code> to apply import</li>
            <li><code style={{ color: "#c4a574" }}>canon.add</code> — requires <code style={{ color: "#c4a574" }}>confirm: true</code> to commit canon facts</li>
          </ul>
        </div>

        {ASSISTANT_CONFIGS.map((assistant) => {
          const configText = assistant.config
            .replace(/<ENDPOINT>/g, status.endpoint)
            .replace(/<TOKEN>/g, "YOUR_MCP_AUTH_TOKEN");
          return (
            <div key={assistant.name} className={styles.card}>
              <div className={styles.configSection}>
                <div className={styles.configHeader}>
                  <span className={styles.configName}>{assistant.name}</span>
                  <button
                    className={styles.copyBtn}
                    onClick={() => copy(configText, assistant.name)}
                  >
                    {copied === assistant.name ? <Check size={12} /> : <Copy size={12} />}
                    {copied === assistant.name ? "Copied" : "Copy"}
                  </button>
                </div>
                <pre className={styles.configBlock}>{configText}</pre>
                <p className={styles.note}>{assistant.note}</p>
              </div>
            </div>
          );
        })}

        <div className={styles.card}>
          <div className={styles.cardTitle}>Local Stdio Server</div>
          <p className={styles.note} style={{ marginBottom: "0.75rem" }}>
            For local development without HTTP, run the stdio server directly:
          </p>
          <div className={styles.endpoint}>
            <Terminal size={14} style={{ color: "#c4a574", flexShrink: 0 }} />
            <span>npm run mcp:server</span>
            <button className={styles.copyBtn} onClick={() => copy("npm run mcp:server", "stdio")}>
              {copied === "stdio" ? <Check size={12} /> : <Copy size={12} />}
              {copied === "stdio" ? "Copied" : "Copy"}
            </button>
          </div>
          <p className={styles.note}>
            Set <code>MCP_ACTOR_USER_ID</code> to your Clerk user ID. The stdio server uses the
            same tools and service-layer routing as the HTTP server.
          </p>
        </div>
      </div>
    </div>
  );
}