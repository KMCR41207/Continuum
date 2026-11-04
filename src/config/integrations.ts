export type Capability =
  "Manual import" | "Agent access" | "Conversation capture";

export const integrations: {
  id: string;
  name: string;
  mark: string;
  capability: Capability;
  status: string;
  description: string;
  setup: string;
  mcpConfig?: string;
  captureMethod?: string;
}[] = [
  {
    id: "import",
    name: "Conversation import",
    mark: "↓",
    capability: "Manual import",
    status: "Available after setup",
    description: "Bring authorized conversations into your workspace.",
    setup:
      "Apply the database migrations, sign in and import normalized JSON in Conversations. Or use a scoped connection with capture enabled. All extracted memories require review.",
  },
  {
    id: "chatgpt",
    name: "ChatGPT",
    mark: "C",
    capability: "Agent access",
    status: "Client setup required",
    description: "Scoped memory retrieval via local MCP server. Requires ChatGPT desktop app with MCP support.",
    setup: "Create a scoped token in Connections with Retrieval enabled. Add the Continuum MCP server to ChatGPT desktop settings under Beta Features → Model Context Protocol.",
    mcpConfig: `{\n  "mcpServers": {\n    "continuum": {\n      "command": "node",\n      "args": ["/absolute/path/to/continuum/server/mcp.ts"],\n      "env": {\n        "CONTINUUM_SUPABASE_URL": "YOUR_SUPABASE_URL",\n        "CONTINUUM_SUPABASE_KEY": "YOUR_ANON_KEY",\n        "CONTINUUM_TOKEN": "ctm_your_token"\n      }\n    }\n  }\n}`,
    captureMethod: "Export conversations from ChatGPT (Settings → Data Controls → Export) then convert to Continuum JSON format and import via Conversations.",
  },
  {
    id: "claude",
    name: "Claude",
    mark: "✳",
    capability: "Agent access",
    status: "Client setup required",
    description: "Scoped memory retrieval via local MCP server. Requires Claude desktop app.",
    setup: "Create a scoped token in Connections with Retrieval enabled. Add the Continuum MCP server to Claude desktop config at ~/Library/Application Support/Claude/claude_desktop_config.json (macOS) or %APPDATA%/Claude/claude_desktop_config.json (Windows).",
    mcpConfig: `{\n  "mcpServers": {\n    "continuum": {\n      "command": "node",\n      "args": ["/absolute/path/to/continuum/server/mcp.ts"],\n      "env": {\n        "CONTINUUM_SUPABASE_URL": "YOUR_SUPABASE_URL",\n        "CONTINUUM_SUPABASE_KEY": "YOUR_ANON_KEY",\n        "CONTINUUM_TOKEN": "ctm_your_token"\n      }\n    }\n  }\n}`,
    captureMethod: "Export conversations from Claude.ai (Settings → Privacy → Export Data) then convert to Continuum JSON format and import via Conversations.",
  },
  {
    id: "cursor",
    name: "Cursor",
    mark: "↗",
    capability: "Agent access",
    status: "Client setup required",
    description: "Scoped memory retrieval via MCP. Add Continuum as an MCP server in Cursor settings.",
    setup: "Create a scoped token in Connections with Retrieval enabled. In Cursor: Settings → Features → MCP Servers → Add server.",
    mcpConfig: `{\n  "mcpServers": {\n    "continuum": {\n      "command": "node",\n      "args": ["/absolute/path/to/continuum/server/mcp.ts"],\n      "env": {\n        "CONTINUUM_SUPABASE_URL": "YOUR_SUPABASE_URL",\n        "CONTINUUM_SUPABASE_KEY": "YOUR_ANON_KEY",\n        "CONTINUUM_TOKEN": "ctm_your_token"\n      }\n    }\n  }\n}`,
    captureMethod: "Export conversation history from Cursor then import as normalized JSON via Conversations.",
  },
  {
    id: "codex",
    name: "Codex",
    mark: "<>",
    capability: "Agent access",
    status: "Client setup required",
    description: "Scoped memory retrieval via MCP for OpenAI Codex CLI.",
    setup: "Create a scoped token in Connections with Retrieval enabled. Configure the Continuum MCP server in your Codex CLI config or pass the MCP server command directly.",
    mcpConfig: `{\n  "mcpServers": {\n    "continuum": {\n      "command": "node",\n      "args": ["/absolute/path/to/continuum/server/mcp.ts"],\n      "env": {\n        "CONTINUUM_SUPABASE_URL": "YOUR_SUPABASE_URL",\n        "CONTINUUM_SUPABASE_KEY": "YOUR_ANON_KEY",\n        "CONTINUUM_TOKEN": "ctm_your_token"\n      }\n    }\n  }\n}`,
    captureMethod: "Import exported Codex conversations as normalized JSON via Conversations.",
  },
  {
    id: "gemini",
    name: "Google Gemini",
    mark: "G",
    capability: "Agent access",
    status: "Client setup required",
    description: "Scoped memory access via MCP-compatible Gemini clients. MCP support availability varies by client.",
    setup: "Create a scoped token in Connections. Use the Continuum HTTP MCP server (server/http.ts) if your Gemini client supports HTTP MCP transport. Stdio MCP requires a compatible Gemini client.",
    mcpConfig: `# HTTP MCP transport (if supported by your client)\nnode server/http.ts\n# Then point your client to: http://localhost:3001/mcp`,
    captureMethod: "Export conversations from Google AI Studio or Gemini and convert to normalized JSON format for import via Conversations.",
  },
  {
    id: "grok",
    name: "Grok",
    mark: "G",
    capability: "Agent access",
    status: "Client setup required",
    description: "Scoped memory access for xAI Grok via MCP-compatible clients.",
    setup: "Create a scoped token in Connections. Use the Continuum local MCP server with any MCP-compatible client that supports Grok. Native Grok MCP integration is unverified.",
    mcpConfig: `{\n  "mcpServers": {\n    "continuum": {\n      "command": "node",\n      "args": ["/absolute/path/to/continuum/server/mcp.ts"],\n      "env": {\n        "CONTINUUM_SUPABASE_URL": "YOUR_SUPABASE_URL",\n        "CONTINUUM_SUPABASE_KEY": "YOUR_ANON_KEY",\n        "CONTINUUM_TOKEN": "ctm_your_token"\n      }\n    }\n  }\n}`,
    captureMethod: "Export and convert Grok conversations to normalized JSON format for import via Conversations.",
  },
  {
    id: "antigravity",
    name: "Antigravity",
    mark: "A",
    capability: "Agent access",
    status: "Client setup required",
    description: "Scoped memory access and explicit authorized imports.",
    setup: "Create a scoped token in Connections and configure the local Continuum MCP server or CLI. Retrieval and writing are independently controlled.",
    mcpConfig: `{\n  "mcpServers": {\n    "continuum": {\n      "command": "node",\n      "args": ["/absolute/path/to/continuum/server/mcp.ts"],\n      "env": {\n        "CONTINUUM_SUPABASE_URL": "YOUR_SUPABASE_URL",\n        "CONTINUUM_SUPABASE_KEY": "YOUR_ANON_KEY",\n        "CONTINUUM_TOKEN": "ctm_your_token"\n      }\n    }\n  }\n}`,
    captureMethod: "Import authorized conversations as normalized JSON via Connections or the CLI.",
  },
  {
    id: "other",
    name: "Other MCP clients",
    mark: "+",
    capability: "Agent access",
    status: "Client setup required",
    description: "Any MCP-compatible client can connect using a scoped token and the local MCP server.",
    setup: "Create a scoped token in Connections and configure the local Continuum MCP server (server/mcp.ts) or HTTP server (server/http.ts). The MCP protocol is tested with the official MCP SDK client.",
    mcpConfig: `{\n  "mcpServers": {\n    "continuum": {\n      "command": "node",\n      "args": ["/absolute/path/to/continuum/server/mcp.ts"],\n      "env": {\n        "CONTINUUM_SUPABASE_URL": "YOUR_SUPABASE_URL",\n        "CONTINUUM_SUPABASE_KEY": "YOUR_ANON_KEY",\n        "CONTINUUM_TOKEN": "ctm_your_token"\n      }\n    }\n  }\n}`,
    captureMethod: "Import authorized conversations as normalized JSON via Connections or the CLI.",
  },
];
