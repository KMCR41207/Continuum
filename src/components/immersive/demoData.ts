export const sampleMemories = [
  {
    id: "decision",
    category: "Decisions",
    project: "Atlas",
    content:
      "Use PostgreSQL for relational data and transactional consistency.",
    source: "Atlas architecture conversation · user message 3",
    evidence:
      "Let’s use PostgreSQL because we need relational data and transactional consistency.",
  },
  {
    id: "preference",
    category: "Preferences",
    project: "Global",
    content: "Keep explanations concise and include a practical example.",
    source: "Writing preferences · user message 1",
    evidence: "Keep explanations concise. Include a practical example.",
  },
  {
    id: "fact",
    category: "Facts",
    project: "Atlas",
    content: "The Atlas frontend uses React.",
    source: "Atlas setup · user message 2",
    evidence: "This project uses React for its frontend.",
  },
  {
    id: "project",
    category: "Projects",
    project: "Atlas",
    content: "Atlas is a workspace for research notes.",
    source: "Atlas brief · user message 1",
    evidence: "Atlas will be our workspace for research notes.",
  },
  {
    id: "goal",
    category: "Goals",
    project: "Studio",
    content: "Prepare the first design review.",
    source: "Studio planning · user message 4",
    evidence: "My next goal is to prepare the first design review.",
  },
  {
    id: "instruction",
    category: "Instructions",
    project: "Studio",
    content: "Check keyboard navigation before sharing a prototype.",
    source: "Studio accessibility checklist · user message 2",
    evidence: "Always check keyboard navigation before sharing the prototype.",
  },
] as const;
export type CoreMode = "capture" | "store" | "retrieve";
export type CoreNode = {
  id: string;
  label: string;
  kind: "agent" | "memory" | "project" | "source";
  detail: string;
};
export type SceneState = {
  mode: CoreMode;
  selected: string;
  zoom: number;
  project: string;
  reset: number;
};
export const agentNodes: CoreNode[] = [
  {
    id: "chatgpt",
    label: "ChatGPT",
    kind: "agent",
    detail: "Authorized JSON import. No live account connection claimed.",
  },
  {
    id: "claude",
    label: "Claude",
    kind: "agent",
    detail: "MCP client setup required. No live provider session verified.",
  },
  {
    id: "cursor",
    label: "Cursor",
    kind: "agent",
    detail: "Compatible MCP client role; scoped credential and setup required.",
  },
  {
    id: "codex",
    label: "Codex",
    kind: "agent",
    detail: "Compatible MCP client role; no live provider account connected.",
  },
];
