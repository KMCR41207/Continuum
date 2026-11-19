const MAX_ATTACHMENTS = 20;

/**
 * Keeps only well-formed attachment references from the (untrusted) page:
 * type image|file, a name, and an http(s) URL or "".
 */
export function cleanAttachments(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const url = typeof item.url === "string" && /^https?:\/\//i.test(item.url) && item.url.length <= 2048 ? item.url : "";
    const name = (typeof item.name === "string" ? item.name.trim() : "").slice(0, 200);
    const type = item.type === "image" ? "image" : "file";
    if (!url && !name) continue;
    result.push({ type, name: name || type, url });
    if (result.length >= MAX_ATTACHMENTS) break;
  }
  return result;
}

/**
 * The path that identifies one saved chat, or null on pages that are not a
 * saved chat yet (ChatGPT "/" before the first reply, Claude "/new").
 * Captures of the same path update one conversation in Continuum.
 */
export function chatPath(provider, url) {
  const path = new URL(url).pathname.replace(/\/+$/, "");
  if (provider === "chatgpt") return /(^|\/)c\/[\w-]+$/.test(path) ? path : null;
  if (provider === "claude") return /^\/chat\/[\w-]+$/.test(path) ? path : null;
  return null;
}

/** ChatGPT project chats live under /g/g-p-<id>-<project-slug>/c/<chat>. */
export function providerProjectFromUrl(provider, url) {
  if (provider !== "chatgpt") return "";
  const match = new URL(url).pathname.match(/^\/g\/g-p-[0-9a-z]+-([a-z0-9-]+)\/c\//i);
  return match ? match[1].replace(/-+/g, " ").trim() : "";
}

const GENERIC_TITLES = /^(chatgpt|claude|new chat|untitled|captured conversation)$/i;
/** Page title without the provider suffix; falls back to the first user message. */
export function chatTitle(title, messages) {
  const cleaned = String(title || "").replace(/\s*[-|–—]\s*(ChatGPT|Claude)\s*$/i, "").trim();
  if (cleaned && !GENERIC_TITLES.test(cleaned)) return cleaned.slice(0, 200);
  const first = (messages || []).find((m) => m && m.role === "user" && typeof m.content === "string" && m.content.trim());
  const fromMessage = first ? first.content.replace(/\s+/g, " ").trim().slice(0, 80) : "";
  return fromMessage || "Captured conversation";
}

export function normalizedConversation(provider, messages, title, url, options = {}) {
  const source = new URL(url);
  const allowed = provider === "chatgpt" ? "chatgpt.com" : provider === "claude" ? "claude.ai" : "";
  if (source.hostname !== allowed) throw new Error("Unsupported conversation source");
  if (!chatPath(provider, url)) throw new Error("Waiting for the chat to be saved (no chat ID in the address yet)");
  const cleaned = messages
    .filter((m) => m && ["user", "assistant"].includes(m.role) && typeof m.content === "string")
    .map((m) => {
      const attachments = cleanAttachments(m.attachments);
      // An upload with no typed text still needs content; name what was attached.
      const content = m.content.trim().slice(0, 20000) ||
        (attachments.length ? `[Attached: ${attachments.map((a) => a.name).join(", ")}]`.slice(0, 20000) : "");
      return attachments.length ? { role: m.role, content, attachments } : { role: m.role, content };
    })
    .filter((m) => m.content);
  if (!cleaned.length) throw new Error("No visible conversation content found");
  if (cleaned.length > 500) throw new Error("Conversation too long (max 500 messages)");
  const project = String(options.providerProject || providerProjectFromUrl(provider, url) || "").replace(/\s+/g, " ").trim().slice(0, 100);
  return {
    title: chatTitle(title, cleaned),
    platform: provider,
    metadata: {
      url: source.origin + chatPath(provider, url),
      captured_at: new Date().toISOString(),
      ...(project ? { provider_project: project } : {}),
    },
    messages: cleaned,
  };
}

/** Removes attachment references (used when "Capture files and images" is off). */
export function withoutAttachments(messages) {
  return Array.isArray(messages)
    ? messages.map((m) => {
        if (!m || typeof m !== "object") return m;
        const { attachments: _removed, ...rest } = m;
        return rest;
      })
    : messages;
}

export async function contentHash(conversation) {
  // Exclude captured_at from hash so same content captured twice = same hash
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      ...conversation,
      metadata: { url: conversation.metadata?.url || "" },
    })
  );
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (b) => b.toString(16).padStart(2, "0")
  ).join("");
}
