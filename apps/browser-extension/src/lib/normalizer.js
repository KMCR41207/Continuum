export function normalizedConversation(provider, messages, title, url) {
  const source = new URL(url);
  const allowed = provider === "chatgpt" ? "chatgpt.com" : provider === "claude" ? "claude.ai" : "";
  if (source.protocol !== "https:" || source.hostname !== allowed) throw new Error("Unsupported conversation source");
  const cleaned = messages.filter((m) => ["user", "assistant"].includes(m.role) && typeof m.content === "string" && m.content.trim()).map((m) => ({ role: m.role, content: m.content.trim().slice(0, 20000) }));
  if (!cleaned.length || cleaned.length > 500) throw new Error("No supported visible conversation content or too many messages");
  return { title: title.slice(0, 200) || "Captured conversation", platform: provider, metadata: { url: source.origin + source.pathname, captured_at: new Date().toISOString() }, messages: cleaned };
}
export async function contentHash(conversation) {
  // Capture timestamps change each scan; content and visible source identity determine deduplication.
  const bytes = new TextEncoder().encode(JSON.stringify({ ...conversation, metadata: { url: conversation.metadata.url } }));
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
}
