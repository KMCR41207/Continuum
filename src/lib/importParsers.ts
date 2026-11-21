/**
 * importParsers.ts
 * Parses ChatGPT, Claude, and Grok provider export JSON files into
 * normalized ConversationInput objects ready for importConversation().
 */

import type { ConversationInput } from "./memory";

const MAX_MESSAGES = 500;

type ParseResult = {
  conversations: ConversationInput[];
  duplicates: number;
};

// ── ChatGPT export ────────────────────────────────────────────────────────────
// Format: array of { title, mapping: { [id]: { message: { author: { role }, content: { parts } } } } }

function parseChatGPTConversation(raw: Record<string, unknown>): ConversationInput[] {
  const title = String(raw.title || "Untitled").trim().slice(0, 200);
  const mapping = raw.mapping as Record<string, unknown> | undefined;
  if (!mapping || typeof mapping !== "object") return [];

  // Build ordered list from parent→children traversal
  const nodes = Object.values(mapping) as Array<Record<string, unknown>>;

  // Sort by create_time if available, otherwise by id
  const messages: { role: string; content: string }[] = [];
  for (const node of nodes) {
    const msg = node.message as Record<string, unknown> | undefined;
    if (!msg) continue;
    const author = (msg.author as Record<string, unknown> | undefined)?.role;
    if (!["user", "assistant"].includes(String(author || ""))) continue;
    // Skip hidden/deleted messages
    const metadata = msg.metadata as Record<string, unknown> | undefined;
    if (metadata?.is_visually_hidden_from_conversation) continue;
    const contentObj = msg.content as Record<string, unknown> | undefined;
    const parts = contentObj?.parts;
    let content = "";
    if (Array.isArray(parts)) {
      content = parts
        .filter((p) => typeof p === "string")
        .join("\n")
        .trim()
        .slice(0, 20000);
    } else if (typeof contentObj?.text === "string") {
      content = contentObj.text.trim().slice(0, 20000);
    }
    if (!content) continue;
    messages.push({ role: String(author), content });
  }

  if (!messages.length) return [];

  // Split into 500-message chunks
  const results: ConversationInput[] = [];
  for (let i = 0; i < messages.length; i += MAX_MESSAGES) {
    const chunk = messages.slice(i, i + MAX_MESSAGES);
    const part = Math.floor(i / MAX_MESSAGES);
    results.push({
      title: part > 0 ? `${title} (part ${part + 1})` : title,
      platform: "chatgpt",
      messages: chunk,
      metadata: { captured_at: new Date().toISOString() },
    });
  }
  return results;
}

// ── Claude export ─────────────────────────────────────────────────────────────
// Format: array of { name, chat_messages: [{ sender: "human"|"assistant", text }] }
// OR array of content-block messages: { sender, content: [{type:"text",text}] }

function parseClaudeConversation(raw: Record<string, unknown>): ConversationInput[] {
  const title = String(raw.name || raw.title || "Untitled").trim().slice(0, 200);
  const chatMessages = raw.chat_messages as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(chatMessages) || !chatMessages.length) return [];

  const messages: { role: string; content: string }[] = [];
  for (const m of chatMessages) {
    const sender = String(m.sender || m.role || "");
    const role = sender === "human" || sender === "user" ? "user" : sender === "assistant" ? "assistant" : null;
    if (!role) continue;
    let content = "";
    if (typeof m.text === "string") {
      content = m.text.trim();
    } else if (Array.isArray(m.content)) {
      content = (m.content as Array<Record<string, unknown>>)
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => String(b.text))
        .join("\n")
        .trim();
    }
    content = content.slice(0, 20000);
    if (!content) continue;
    messages.push({ role, content });
  }

  if (!messages.length) return [];

  const results: ConversationInput[] = [];
  for (let i = 0; i < messages.length; i += MAX_MESSAGES) {
    const chunk = messages.slice(i, i + MAX_MESSAGES);
    const part = Math.floor(i / MAX_MESSAGES);
    results.push({
      title: part > 0 ? `${title} (part ${part + 1})` : title,
      platform: "claude",
      messages: chunk,
      metadata: { captured_at: new Date().toISOString() },
    });
  }
  return results;
}

// ── Grok export ───────────────────────────────────────────────────────────────
// Format: array of { title, messages: [{ role, content }] }

function parseGrokConversation(raw: Record<string, unknown>): ConversationInput[] {
  const title = String(raw.title || "Untitled").trim().slice(0, 200);
  const msgs = raw.messages as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(msgs) || !msgs.length) return [];

  const messages: { role: string; content: string }[] = [];
  for (const m of msgs) {
    const role = String(m.role || "");
    if (!["user", "assistant"].includes(role)) continue;
    const content = String(m.content || "").trim().slice(0, 20000);
    if (!content) continue;
    messages.push({ role, content });
  }

  if (!messages.length) return [];

  const results: ConversationInput[] = [];
  for (let i = 0; i < messages.length; i += MAX_MESSAGES) {
    const chunk = messages.slice(i, i + MAX_MESSAGES);
    const part = Math.floor(i / MAX_MESSAGES);
    results.push({
      title: part > 0 ? `${title} (part ${part + 1})` : title,
      platform: "grok",
      messages: chunk,
      metadata: { captured_at: new Date().toISOString() },
    });
  }
  return results;
}

// ── Top-level parser ──────────────────────────────────────────────────────────

export function parseExport(data: unknown): ParseResult {
  const conversations: ConversationInput[] = [];
  const seenTitles = new Set<string>();
  let duplicates = 0;

  const tryAdd = (conv: ConversationInput) => {
    // Dedup by title+platform within the file
    const key = `${conv.platform}::${conv.title}`;
    if (seenTitles.has(key)) { duplicates++; return; }
    seenTitles.add(key);
    conversations.push(conv);
  };

  if (Array.isArray(data)) {
    for (const item of data as Record<string, unknown>[]) {
      if (typeof item !== "object" || !item) continue;
      // Claude: has chat_messages
      if (Array.isArray(item.chat_messages)) {
        parseClaudeConversation(item).forEach(tryAdd);
      }
      // ChatGPT: has mapping
      else if (item.mapping && typeof item.mapping === "object") {
        parseChatGPTConversation(item).forEach(tryAdd);
      }
      // Grok: has messages array with role/content
      else if (Array.isArray(item.messages)) {
        parseGrokConversation(item).forEach(tryAdd);
      }
    }
  } else if (typeof data === "object" && data !== null) {
    const obj = data as Record<string, unknown>;
    // Single ChatGPT conversation
    if (obj.mapping) {
      parseChatGPTConversation(obj).forEach(tryAdd);
    }
    // Single Claude conversation
    else if (Array.isArray(obj.chat_messages)) {
      parseClaudeConversation(obj).forEach(tryAdd);
    }
    // Wrapped: { conversations: [...] }
    else if (Array.isArray(obj.conversations)) {
      return parseExport(obj.conversations);
    }
  }

  return { conversations, duplicates };
}
