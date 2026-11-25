# AI Provider Compatibility Analysis

**Phase 0 — Read-Only Audit**
**Date:** 2026-11-25
**Status:** Research findings, pending approval

---

## 1. Executive Summary

This document analyzes the free and paid access options for the three requested AI providers — **ChatGPT (OpenAI)**, **Google Gemini**, and **DeepSeek** — and identifies the cheapest practical integration strategy for the unified chat interface.

**Key finding:** Only **Google Gemini** offers a genuine free API tier. **OpenAI** and **DeepSeek** require paid API keys, though DeepSeek is extremely cheap. The existing codebase already has all necessary SDKs installed.

---

## 2. Provider Analysis

### 2.1 ChatGPT (OpenAI)

#### Access Options

| Option | Cost | API Access | Terms-Compliant | Feasible |
|--------|------|------------|-----------------|----------|
| **Browser chat** (chat.openai.com) | Free | No | N/A | No — no API, cannot integrate |
| **OpenAI API** | Paid (per-token) | Yes | Yes | Yes — requires `OPENAI_API_KEY` |
| **GitHub Copilot** | Free tier (50 chat msgs/month) | Yes (via Copilot token) | Yes | Yes — already in `chatProviders.ts` |
| **Azure OpenAI** | Paid (per-token) | Yes | Yes | Yes — but requires Azure setup |

#### API Pricing (as of Nov 2026)

| Model | Input (per 1M tokens) | Output (per 1M tokens) |
|-------|----------------------|------------------------|
| `gpt-4o` | $2.50 | $10.00 |
| `gpt-4o-mini` | $0.15 | $0.60 |
| `gpt-4-turbo` | $10.00 | $30.00 |

#### Existing Integration

- **LLM registry:** `lib/providers/llm/openai.ts` — uses `openai` SDK via `chatJson`, default model `gpt-6-luna`.
- **Chat providers:** NOT in `chatProviders.ts` (the 10 free-tier providers don't include OpenAI).
- **Free policy:** Classified as `PAID` in `freePolicy.ts` — blocked when `LLM_FREE_ONLY=true` (default).
- **SDK:** `openai@^7.47.0` already installed.

#### Free Access Verdict

**No free API tier exists for OpenAI.** The browser chat at chat.openai.com is free but provides no API access — scraping it would violate OpenAI's Terms of Service.

**Alternative:** GitHub Copilot provides free-tier access to GPT-4o models (50 chat messages/month, 2000 code completions/month). This is already integrated in `lib/providers/llm/chatProviders.ts` with the `copilot` provider ID. However, it requires a GitHub Copilot subscription ($10/month or free for students/maintainers).

**Recommendation:** Support OpenAI via `OPENAI_API_KEY` (paid, user-provided). Show a clear "not configured" status when the key is absent. Mention GitHub Copilot as a free alternative in the UI.

---

### 2.2 Google Gemini

#### Access Options

| Option | Cost | API Access | Terms-Compliant | Feasible |
|--------|------|------------|-----------------|----------|
| **Browser chat** (gemini.google.com) | Free | No | N/A | No — no API |
| **Google AI Studio API** | Free tier available | Yes | Yes | **Yes — recommended** |
| **Vertex AI** | Paid (per-token) | Yes | Yes | Yes — but requires GCP setup |

#### Free Tier Details (Google AI Studio)

| Feature | Free Tier Limit |
|---------|-----------------|
| `gemini-3.8-flash` | 15 RPM, 1M TPM, 1500 RPD |
| `gemini-3.6-flash` | 15 RPM, 1M TPM, 1500 RPD |
| `gemini-2.0-flash` | 15 RPM, 1M TPM, 1500 RPD |
| Context window | 1M tokens |
| Price | **$0.00** (free tier) |

**RPM** = requests per minute, **TPM** = tokens per minute, **RPD** = requests per day.

The free tier is generous for a personal drama studio: 1500 requests per day with 1M tokens per request is more than sufficient for conversational analysis of story bibles, scripts, and character data.

#### API Key Acquisition

1. Go to [Google AI Studio](https://aistudio.google.com/apikey)
2. Click "Create API Key"
3. Copy the key (starts with `AIza...`)
4. Set as `GEMINI_API_KEY` environment variable

No credit card required. No billing setup required. The key works immediately.

#### Existing Integration

- **LLM registry:** `lib/providers/llm/gemini.ts` — uses `@google/genai` SDK, default model `gemini-flash-latest`.
- **Free policy:** `FREE_GEMINI_MODELS = ["gemini-3.8-flash", "gemini-3.6-flash"]` — these models are allowed in free-only mode.
- **SDK:** `@google/genai@^2.32.0` already installed.
- **Streaming:** The `@google/genai` SDK supports `ai.models.generateContentStream()` for streaming responses.

#### Free Access Verdict

**Gemini has a genuine, generous free API tier.** This is the cheapest option — zero cost with no credit card required. The existing SDK and integration can be reused directly.

**Recommendation:** Use Gemini as the default provider. Free model `gemini-3.8-flash` with `GEMINI_API_KEY` from Google AI Studio.

---

### 2.3 DeepSeek

#### Access Options

| Option | Cost | API Access | Terms-Compliant | Feasible |
|--------|------|------------|-----------------|----------|
| **Browser chat** (chat.deepseek.com) | Free | No | N/A | No — no API |
| **DeepSeek API** | Paid (per-token, very cheap) | Yes | Yes | Yes — requires `DEEPSEEK_API_KEY` |

#### API Pricing (as of Nov 2026)

| Model | Input (per 1M tokens) | Output (per 1M tokens) |
|-------|----------------------|------------------------|
| `deepseek-chat` | $0.27 | $1.10 |
| `deepseek-reasoner` | $0.55 | $2.19 |

**Cost comparison:** DeepSeek is ~10x cheaper than OpenAI GPT-4o for equivalent usage. A typical conversation (10K input tokens, 2K output tokens) costs ~$0.005 — less than a cent.

#### Free Tier

DeepSeek offers **$0.50 free credit** on new account signup (as of recent promotions). This is enough for ~100-200 conversations. After the credit is exhausted, the API requires payment (pay-as-you-go, no subscription).

#### API Key Acquisition

1. Go to [DeepSeek Platform](https://platform.deepseek.com/api_keys)
2. Create an account
3. Generate an API key
4. Set as `DEEPSEEK_API_KEY` environment variable

Credit card required for continued use after the free credit is exhausted.

#### Existing Integration

- **LLM registry:** `lib/providers/llm/deepseek.ts` — uses `openai` SDK via `chatJson` with `baseURL: "https://api.deepseek.com"`. OpenAI-compatible.
- **Free policy:** Classified as `PAID` in `freePolicy.ts` — blocked when `LLM_FREE_ONLY=true`.
- **SDK:** Uses `openai@^7.47.0` (already installed) — no DeepSeek-specific SDK needed.
- **Tool use:** DeepSeek supports OpenAI-compatible function calling.

#### Free Access Verdict

**No ongoing free API tier.** DeepSeek offers a one-time signup credit ($0.50), after which the API is paid. However, the cost is extremely low — a typical conversation costs less than a cent.

**Recommendation:** Support DeepSeek via `DEEPSEEK_API_KEY` (paid, user-provided). Show a clear "not configured" status when the key is absent. The cost is low enough that most users can afford it.

---

## 3. Comparison Matrix

| Feature | ChatGPT (OpenAI) | Gemini (Google) | DeepSeek |
|---------|-------------------|------------------|----------|
| **Free API tier** | No | **Yes** (generous) | No ($0.50 credit) |
| **API cost** | $2.50-$10.00/1M tokens | **$0.00** (free tier) | $0.27-$1.10/1M tokens |
| **SDK installed** | `openai@^7.47.0` | `@google/genai@^2.32.0` | `openai@^7.47.0` (compatible) |
| **Existing integration** | LLM registry (story gen) | LLM registry (story gen) | LLM registry (story gen) |
| **Streaming support** | Yes (SDK) | Yes (SDK) | Yes (OpenAI-compatible) |
| **Tool use / function calling** | Yes | Yes | Yes |
| **Credit card required** | Yes | **No** | Yes (after credit) |
| **Best model for chat** | `gpt-4o` | `gemini-3.8-flash` | `deepseek-chat` |
| **Context window** | 128K tokens | **1M tokens** | 64K tokens |
| **OpenAI-compatible API** | Native | No (own SDK) | Yes |
| **Privacy** | US servers | US servers | China servers |

---

## 4. Integration Options Per Provider

### 4.1 OpenAI (ChatGPT)

**Option 1: Direct API (Recommended)**
- **How:** `OPENAI_API_KEY` env var → `openai` SDK → `client.chat.completions.create({ stream: true, tools: [...] })`.
- **Cost:** Paid (per-token).
- **Pros:** Native tool use, streaming, best model quality.
- **Cons:** Requires paid API key.
- **Implementation:** `OpenAIChatProvider` class using `openai` SDK.

**Option 2: GitHub Copilot Proxy (Free alternative)**
- **How:** `GITHUB_COPILOT_TOKEN` env var → Copilot token exchange → OpenAI-compatible API at `api.githubcopilot.com`.
- **Cost:** Free (50 chat messages/month with Copilot subscription).
- **Pros:** Free access to GPT-4o.
- **Cons:** Requires Copilot subscription, limited messages, not true "ChatGPT" API.
- **Implementation:** Already in `chatProviders.ts` — could be surfaced as a "ChatGPT (via Copilot)" option.

**Recommendation:** Implement Option 1 (direct API). Mention Option 2 in the UI as a free alternative.

### 4.2 Gemini

**Option 1: Google AI Studio Free Tier (Recommended)**
- **How:** `GEMINI_API_KEY` env var → `@google/genai` SDK → `ai.models.generateContentStream({ tools: [...] })`.
- **Cost:** Free.
- **Pros:** Free, generous limits, 1M context window, already have SDK.
- **Cons:** Rate limits (15 RPM, 1500 RPD).
- **Implementation:** `GeminiChatProvider` class using `@google/genai` SDK.

**Recommendation:** Implement Option 1. This is the default provider.

### 4.3 DeepSeek

**Option 1: Direct API (Recommended)**
- **How:** `DEEPSEEK_API_KEY` env var → `openai` SDK with `baseURL: "https://api.deepseek.com"` → `client.chat.completions.create({ stream: true, tools: [...] })`.
- **Cost:** Paid (very cheap, ~$0.005/conversation).
- **Pros:** OpenAI-compatible, very cheap, good reasoning.
- **Cons:** Requires API key, China-based servers (privacy consideration).
- **Implementation:** `DeepSeekChatProvider` class using `openai` SDK with custom baseURL.

**Recommendation:** Implement Option 1. The cost is low enough for most users.

---

## 5. MCP SuperAssistant Browser Integration

### 5.1 What Is the SuperAssistant?

The SuperAssistant is an **external AI client application** (not part of this repo) that connects to the AI Drama Studio MCP server. The only artifact in the codebase is `superassistant-config.json`:

```json
{"mcpServers":{"ai-drama-studio":{"url":"http://127.0.0.1:3007/api/mcp"}}}
```

This config tells the SuperAssistant to connect to the MCP server via the auth bridge (port 3007).

### 5.2 Can It Support the Unified Interface?

**No.** The SuperAssistant is:
- An **external application** — it runs outside the Next.js app.
- A **consumer** of the MCP server, not a provider of chat services.
- Not controllable from within the Next.js app — it has its own UI, its own conversation management, its own model selection.
- Not embeddable in the Next.js app — it's not a browser extension or iframe-able widget.

The SuperAssistant cannot be used as the chat backend for the unified interface. The unified interface needs its own provider abstraction that calls LLM APIs directly and uses the MCP server for tool execution.

### 5.3 Relationship to the Unified Interface

The SuperAssistant and the unified interface are **complementary**:
- **SuperAssistant:** External AI client → MCP server → project data. Used from outside the app.
- **Unified interface:** In-app chat → LLM APIs + MCP server → project data. Used from inside the app.

Both use the same MCP server and the same project data. Neither duplicates the other.

---

## 6. Existing Gemini/SuperAssistant Connection

### 6.1 Current State

The spec says "Preserve the current working Gemini/SuperAssistant connection." Based on the audit:

1. **Gemini in LLM registry:** `lib/providers/llm/gemini.ts` — used for story generation via the `@google/genai` SDK with `GEMINI_API_KEY`. This is the primary LLM provider for the Story Engine pipeline. **This must not be disturbed.**

2. **SuperAssistant config:** `superassistant-config.json` — points to the auth bridge at port 3007. This is a static config file for an external application. **This must not be disturbed.**

3. **MCP server:** `lib/mcp/server.ts` — the existing MCP tools, resources, and HTTP transport. **This must not be disturbed.**

### 6.2 Preservation Strategy

The unified chat interface is **purely additive**:
- New provider classes in `lib/providers/chat/` — separate from `lib/providers/llm/`.
- New models in `lib/models/conversation.ts` and `lib/models/chatMessage.ts` — separate from existing models.
- New API routes in `app/api/assistant/` — separate from existing routes.
- New UI in `app/(studio)/assistant/` — separate from existing pages.
- One modification to `StudioShell.tsx` — add a nav link.

**No changes to:**
- `lib/providers/llm/gemini.ts` (existing Gemini provider)
- `lib/providers/llm/registry.ts` (LLM registry)
- `lib/mcp/server.ts` (MCP server)
- `superassistant-config.json` (SuperAssistant config)
- `mcp-auth-bridge.cjs` (auth bridge)
- Any existing model, repository, service, or route.

---

## 7. Cost Summary

### 7.1 For the User (API Costs)

| Provider | Setup Cost | Per-Conversation Cost | Monthly Estimate (100 conversations) |
|----------|------------|----------------------|--------------------------------------|
| Gemini (free tier) | $0 | $0 | **$0** |
| DeepSeek | $0 (signup credit) | ~$0.005 | **~$0.50** |
| OpenAI (gpt-4o) | $0 | ~$0.05 | **~$5.00** |
| OpenAI (gpt-4o-mini) | $0 | ~$0.003 | **~$0.30** |

### 7.2 For the Project (Dependencies)

| Dependency | Size | Already Installed |
|------------|------|-------------------|
| `openai` | ~500KB | Yes |
| `@google/genai` | ~200KB | Yes |
| `@modelcontextprotocol/sdk` | ~300KB | Yes |
| `react-markdown` | ~50KB | No (new) |
| `remark-gfm` | ~30KB | No (new) |

**Total new dependencies:** 2 (markdown rendering, ~80KB combined).

---

## 8. Recommendations

1. **Default provider: Gemini** — Free API tier, no credit card required, generous limits, 1M context window. Already have the SDK and integration patterns.

2. **Second provider: DeepSeek** — Extremely cheap (~$0.005/conversation), OpenAI-compatible, good reasoning. Requires API key but cost is negligible for most users.

3. **Third provider: OpenAI** — Best model quality, but paid. Requires `OPENAI_API_KEY`. UI should show a clear "requires paid API key" status when not configured.

4. **Free alternative for OpenAI:** GitHub Copilot (already in `chatProviders.ts`) provides free GPT-4o access for Copilot subscribers. Could be surfaced as "ChatGPT (via Copilot)" in the agent selector.

5. **No unofficial workarounds.** Do not scrape browser chat interfaces. Do not use reverse-engineered APIs. All integrations use official, terms-compliant API endpoints.

6. **Transparent UI.** Each provider shows:
   - "Configured and ready" (green) — API key present.
   - "Not configured — requires [ENV_VAR]" (yellow) — API key absent.
   - "Free tier" / "Paid" label.
   - Link to API key acquisition docs.