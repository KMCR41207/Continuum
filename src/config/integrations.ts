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
  ...[
    ["chatgpt", "ChatGPT", "C"],
    ["claude", "Claude", "✳"],
    ["gemini", "Google Gemini", "G"],
    ["grok", "Grok", "G"],
    ["cursor", "Cursor", "↗"],
    ["codex", "Codex", "<>"],
    ["antigravity", "Antigravity", "A"],
    ["other", "Other MCP clients", "+"],
  ].map(([id, name, mark]) => ({
    id,
    name,
    mark,
    capability: "Agent access" as Capability,
    status: "Client setup required",
    description:
      "Scoped memory access and explicit authorized imports. Live provider compatibility unverified.",
    setup:
      "Create a scoped token in Connections and configure the local Continuum MCP server or CLI. Retrieval and writing are independently controlled. Normalized JSON import requires capture permission. Automatic conversation capture and provider OAuth are not implemented. No live provider connection is claimed; only the generic MCP client has been tested.",
  })),
];
