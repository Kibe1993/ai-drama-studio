# MCP Integration Guide

The AI Drama Studio includes a **Model Context Protocol (MCP) server** that exposes project data to external AI assistants (ChatGPT, Claude, Cursor, etc.) without requiring the app to have its own LLM credits.

## Quick Start

### 1. Set the actor user ID

Find your Clerk user ID (from the app's user management or Clerk dashboard) and set it as an environment variable:

```bash
export MCP_ACTOR_USER_ID="user_your_clerk_id_here"
export MONGODB_URI="your_mongodb_connection_string"
```

The MCP server operates as this user — it can only access projects owned by them.

### 2. Start the MCP server

```bash
npm run mcp:server
```

The server communicates via **stdio** (standard input/output), which is the standard MCP transport used by AI assistants.

### 3. Connect from an AI assistant

#### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "drama-studio": {
      "command": "npm",
      "args": ["run", "mcp:server"],
      "cwd": "/path/to/ai-drama-studio",
      "env": {
        "MCP_ACTOR_USER_ID": "user_your_clerk_id_here",
        "MONGODB_URI": "your_mongodb_connection_string"
      }
    }
  }
}
```

#### Cursor / VS Code (with MCP extension)

Add the server to your MCP client configuration:

```json
{
  "mcpServers": {
    "drama-studio": {
      "command": "npx",
      "args": ["tsx", "scripts/mcp-server.ts"],
      "cwd": "/path/to/ai-drama-studio",
      "env": {
        "MCP_ACTOR_USER_ID": "user_your_clerk_id_here",
        "MONGODB_URI": "your_mongodb_connection_string"
      }
    }
  }
}
```

## Available Tools

### Project Tools

| Tool | Description |
|------|-------------|
| `project.list` | List all projects (with optional status filter) |
| `project.get` | Get a single project by ID |
| `project.create` | Create a new drama project |
| `project.update` | Update project metadata |
| `project.delete` | Delete a project permanently |

### Document Tools

| Tool | Description |
|------|-------------|
| `document.get` | Get a document (bible, story, episode, season_plan, scenes) |
| `document.update` | Update a document's content |
| `document.import` | Import content from a JSON string |
| `document.export` | Export a document as a JSON string |

### Canon Tools

| Tool | Description |
|------|-------------|
| `canon.query` | Query the canon (narrative facts) for a project |
| `canon.add` | Add a canon fact to the append-only event store |
| `canon.validate` | Validate canon consistency and entity counts |

### Media Tools

| Tool | Description |
|------|-------------|
| `media.list` | List all media assets for a project |
| `media.upload` | Register a media asset in the project |
| `media.generate_audio` | Trigger TTS audio generation |

### Render Tools

| Tool | Description |
|------|-------------|
| `render.start` | Start a render job for an episode timeline |
| `render.status` | Check the status of a render job |

## Available Resources

Resources are read-only data accessible via URI templates:

| URI | Description |
|-----|-------------|
| `project://{projectId}/bible` | Story Bible (premise, world rules, themes) |
| `project://{projectId}/story` | Current story draft (screenplay scenes) |
| `project://{projectId}/episodes/{n}` | Episode details by number |
| `project://{projectId}/canon` | Latest canon state (characters, locations, facts) |
| `project://{projectId}/assets` | All media assets for the project |
| `project://{projectId}/timeline` | Timeline information for rendering |

## How It Works

```
┌─────────────────┐     stdio      ┌──────────────────┐
│  AI Assistant   │ ◄──────────► │  MCP Server      │
│  (Claude, etc.) │               │  (npm run mcp)   │
└─────────────────┘               └────────┬─────────┘
                                            │
                                            ▼
                                  ┌──────────────────┐
                                  │  MongoDB         │
                                  │  (repositories)  │
                                  └──────────────────┘
```

The MCP server calls repositories directly (bypassing service-layer business gates) using the configured `MCP_ACTOR_USER_ID`. This gives the external AI assistant full read/write access to the user's projects, documents, canon, and media.

## Security Notes

- The MCP server only accesses projects owned by `MCP_ACTOR_USER_ID`.
- There is no admin bypass — the actor user must own the data.
- The server does not expose credentials or API keys.
- All tool inputs are validated with Zod schemas.

## Use Cases

1. **Story development with Claude/ChatGPT**: Export the Story Bible, have the AI assistant refine it, then import the updated version back.
2. **Canon management**: Query the canon, add new facts discovered during writing, validate consistency.
3. **Episode planning**: Read episodes, have the AI suggest plot developments, update episode metadata.
4. **Production review**: List media assets, check render status, all from within the AI assistant.