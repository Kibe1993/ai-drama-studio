# MCP Client Compatibility

**Date:** 2026-11-24
**MCP SDK:** `@modelcontextprotocol/sdk@^1.32.2`
**Current transport:** stdio only

---

## Compatibility Statuses

| Status | Meaning |
|--------|---------|
| **Verified** | Tested successfully against the deployed AI Drama Studio MCP server |
| **Supported (untested)** | Official documentation confirms required functionality; not yet tested |
| **Restricted** | Known product, plan, or regional limitation |
| **Blocked** | Cannot work without changes to AI Drama Studio (e.g. needs remote transport) |

---

## Current Blocking Issue

**The MCP server only supports stdio transport.** No remote/HTTP transport exists. Clients that require a remote URL cannot connect. This blocks all remote-client targets until Phase 1 adds Streamable HTTP transport.

---

## Primary Targets

### A. Claude

| Client | Transport | Remote? | Status | Notes |
|--------|-----------|---------|--------|-------|
| Claude Desktop | stdio | No | **Supported (untested)** | Configure via `claude_desktop_config.json` `mcpServers` entry pointing to `npm run mcp:server`. Local only. |
| Claude Code (CLI) | stdio | No | **Supported (untested)** | Supports stdio MCP servers via `.mcp.json` config. |
| Claude web (custom connectors) | HTTP | Yes | **Blocked** | Requires remote MCP endpoint. Needs Streamable HTTP transport + auth. |

**Setup (Claude Desktop, local stdio):**
```json
{
  "mcpServers": {
    "ai-drama-studio": {
      "command": "npm",
      "args": ["run", "mcp:server"],
      "cwd": "/path/to/ai-drama-studio",
      "env": {
        "MONGODB_URI": "...",
        "MCP_ACTOR_USER_ID": "clerk-user-id"
      }
    }
  }
}
```

**Plan restrictions:** Claude web custom connectors may require a Business/Enterprise plan. Free/Pro accounts may not support custom MCP connectors. Verify per account.

---

### B. Kimi / Moonshot

| Client | Transport | Remote? | Status | Notes |
|--------|-----------|---------|--------|-------|
| Kimi Code (CLI) | stdio + HTTP | Both | **Blocked** (remote); **Supported (untested)** (local stdio) | CLI supports stdio. Remote needs HTTP transport. |
| Kimi Code (desktop) | HTTP | Yes | **Blocked** | Requires remote MCP endpoint. |

**Notes:** Kimi Code CLI is documented to support both stdio and remote MCP. The stdio path should work with the current server. Remote requires Phase 1.

---

### C. Qwen

| Client | Transport | Remote? | Status | Notes |
|--------|-----------|---------|--------|-------|
| Qwen Code | stdio + HTTP | Both | **Blocked** (remote); **Supported (untested)** (local stdio) | Similar to Kimi Code. |

**Notes:** Qwen Code (based on OpenAI Cline fork) supports MCP server configuration. Verify whether it accepts stdio config or requires a URL.

---

### D. Cline

| Client | Transport | Remote? | Status | Notes |
|--------|-----------|---------|--------|-------|
| Cline (VS Code extension) | stdio + HTTP | Both | **Blocked** (remote); **Supported (untested)** (local stdio) | Cline supports `command` (stdio) and `url` (remote/SSE) MCP server configs. |

**Notes:** Cline treats model/provider authentication separately from MCP authentication. The MCP auth is about the connection to AI Drama Studio, not about the LLM provider. This is the correct separation.

**Setup (Cline, local stdio):**
Add to Cline's MCP settings:
```json
{
  "mcpServers": {
    "ai-drama-studio": {
      "command": "npm",
      "args": ["run", "mcp:server"],
      "cwd": "/path/to/ai-drama-studio",
      "env": {
        "MONGODB_URI": "...",
        "MCP_ACTOR_USER_ID": "clerk-user-id"
      }
    }
  }
}
```

---

## Additional Targets

### E. ChatGPT

| Client | Transport | Remote? | Status | Notes |
|--------|-----------|---------|--------|-------|
| ChatGPT (custom connectors) | HTTP | Yes | **Blocked** | Requires remote MCP endpoint. |

**Plan restrictions:**
- Custom MCP connectors may require ChatGPT Pro, Business, Enterprise, or Edu plans.
- Free/Plus accounts may not support custom connectors.
- Write operations may not be supported on all plan tiers — some accounts may only support read/fetch.
- **Do not assume** every account can connect. Document the difference between Pro and Business/Enterprise/Edu.

**Regional restrictions:** OpenAI services have regional availability. Verify per user location.

---

### F. Gemini

| Client | Transport | Remote? | Status | Notes |
|--------|-----------|---------|--------|-------|
| Gemini (Connected Apps) | HTTP | Yes | **Blocked** | Requires remote MCP endpoint. |

**Restrictions:**
- Gemini Connected Apps use the MCP server URL.
- Account, region, language, and eligibility restrictions apply.
- **The user's account in Kenya may not currently be able to connect.** Do not build around a workaround that violates product restrictions.
- Verify eligibility before claiming support.

---

## Transport Requirements Summary

| Client | stdio | Streamable HTTP | SSE |
|--------|-------|-----------------|-----|
| Claude Desktop | ✅ | — | — |
| Claude Code | ✅ | — | — |
| Claude web connectors | — | ✅ | — |
| Kimi Code (CLI) | ✅ | ✅ | — |
| Kimi Code (desktop) | — | ✅ | — |
| Qwen Code | ✅ | ✅ | — |
| Cline | ✅ | ✅ | ✅ |
| ChatGPT connectors | — | ✅ | — |
| Gemini Connected Apps | — | ✅ | — |

**Conclusion:** Streamable HTTP is the critical missing transport. It unblocks all remote clients. stdio is already sufficient for local clients (Claude Desktop, Claude Code, Cline local, Kimi Code CLI local).

---

## Testing Plan (for Phase 3)

For each client, test:

1. **Connection** — Can the client discover and connect to the MCP server?
2. **Authentication** — Does the auth flow correctly identify the user?
3. **Tool discovery** — Does the client list all 17 tools?
4. **Project retrieval** — Can `project.list` and `project.get` return data?
5. **Document retrieval** — Can `document.get` return Story Bible, story, episodes?
6. **Canon retrieval** — Can `canon.query` return approved canon?
7. **Proposed changes** — Can the assistant propose a document update?
8. **Approval** — Does the approval flow work?
9. **Successful persistence** — Does an approved change persist?
10. **Rejection** — Does a rejected change not persist?
11. **Unauthorized access** — Can the client access another user's projects? (Should fail)
12. **Connection failure** — What happens when the server is unreachable?

Report actual results. Do not claim compatibility without a real test.