/**
 * sessionCapture.ts — captures coding-agent session files into Continuum.
 *
 * Supports Claude Code (.jsonl), Codex (.md export), and Cursor (.json export)
 * session formats, normalizing them into ConversationInput objects.
 */
import { readFile } from "node:fs/promises";
import type { AgentCall } from "./gateway.ts";
import type { ConversationInput } from "../src/lib/memory.ts";

export type SessionProvider = "claude" | "codex" | "cursor";

type CaptureResult = {
  title: string;
  id?: string;
  duplicate?: boolean;
  proposals?: number;
  error?: string;
};

/**
 * Captures a coding-agent session file and uploads it to Continuum.
 *
 * The file format depends on the provider:
 * - claude: JSONL with one message per line, each having {role, content, ...}
 * - codex: Markdown export with code blocks and conversation text
 * - cursor: JSON export with conversation messages
 */
export async function captureCodingSession(
  provider: SessionProvider,
  file: string,
  projectId: string | undefined,
  call: AgentCall,
  dryRun: boolean,
): Promise<{ title: string; uploaded: boolean; imported?: number; duplicates?: number; failed?: number; results?: CaptureResult[] }> {
  const raw = await readFile(file, "utf8");
  const conversation = parseSessionFile(provider, raw, file);

  if (dryRun) {
    return {
      title: conversation.title,
      uploaded: false,
    };
  }

  const results: CaptureResult[] = [];
  try {
    const result = (await call("capture_conversation", {
      project_id: projectId,
      conversation,
    })) as { id: string; duplicate: boolean; proposals: number };
    results.push({ title: conversation.title, ...result });
  } catch (error) {
    results.push({
      title: conversation.title,
      error: error instanceof Error ? error.message : "Capture failed",
    });
  }

  return {
    title: conversation.title,
    uploaded: true,
    imported: results.filter((r) => r.id && !r.duplicate).length,
    duplicates: results.filter((r) => r.duplicate).length,
    failed: results.filter((r) => r.error).length,
    results,
  };
}

function parseSessionFile(provider: SessionProvider, raw: string, filename: string): ConversationInput {
  switch (provider) {
    case "claude":
      return parseClaudeSession(raw, filename);
    case "codex":
      return parseCodexSession(raw, filename);
    case "cursor":
      return parseCursorSession(raw, filename);
    default:
      throw new Error(`Unknown session provider: ${provider}`);
  }
}

/** Claude Code sessions are JSONL files. Each line is a message object. */
function parseClaudeSession(raw: string, filename: string): ConversationInput {
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const messages: { role: string; content: string }[] = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      const role = obj.role === "user" || obj.human_turn ? "user" : "assistant";
      let content = "";
      if (typeof obj.content === "string") {
        content = obj.content;
      } else if (Array.isArray(obj.content)) {
        content = obj.content
          .map((block: { text?: string }) => (typeof block?.text === "string" ? block.text : ""))
          .join("\n")
          .trim();
      }
      content = content.slice(0, 20000);
      if (content) messages.push({ role, content });
    } catch {
      // Skip non-JSON lines
    }
  }
  if (!messages.length) throw new Error(`No messages found in Claude Code session file: ${filename}`);
  return {
    title: filename.replace(/\.jsonl$/, "").slice(-200),
    platform: "claude",
    messages,
    metadata: { captured_at: new Date().toISOString(), source: "claude-code-session" },
  };
}

/** Codex sessions are markdown export files. We extract conversation turns. */
function parseCodexSession(raw: string, filename: string): ConversationInput {
  const messages: { role: string; content: string }[] = [];
  // Split on headers like "## User" / "## Assistant" or role markers
  const blocks = raw.split(/^##?\s+(User|Assistant|Human|AI|Code)\s*$/im);
  for (let i = 1; i < blocks.length; i += 2) {
    const role = blocks[i].toLowerCase().includes("user") || blocks[i].toLowerCase().includes("human")
      ? "user"
      : "assistant";
    const content = (blocks[i + 1] || "").trim().slice(0, 20000);
    if (content) messages.push({ role, content });
  }
  // Fallback: treat whole file as a single user message
  if (!messages.length && raw.trim()) {
    messages.push({ role: "user", content: raw.trim().slice(0, 20000) });
  }
  if (!messages.length) throw new Error(`No messages found in Codex session file: ${filename}`);
  return {
    title: filename.replace(/\.md$/, "").slice(-200),
    platform: "codex",
    messages,
    metadata: { captured_at: new Date().toISOString(), source: "codex-session" },
  };
}

/** Cursor sessions are JSON export files with a messages array. */
function parseCursorSession(raw: string, filename: string): ConversationInput {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`Cursor session file is not valid JSON: ${filename}`);
  }
  const rawMessages = (data.messages || data.chatMessages || []) as Array<Record<string, unknown>>;
  const messages: { role: string; content: string }[] = [];
  for (const m of rawMessages) {
    const role = String(m.role || m.sender || "") === "user" ? "user" : "assistant";
    let content = "";
    if (typeof m.content === "string") {
      content = m.content;
    } else if (typeof m.text === "string") {
      content = m.text;
    }
    content = content.slice(0, 20000);
    if (content) messages.push({ role, content });
  }
  if (!messages.length) throw new Error(`No messages found in Cursor session file: ${filename}`);
  return {
    title: String(data.title || filename.replace(/\.json$/, "")).slice(0, 200),
    platform: "cursor",
    messages,
    metadata: { captured_at: new Date().toISOString(), source: "cursor-session" },
  };
}
