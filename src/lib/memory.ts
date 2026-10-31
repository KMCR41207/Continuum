import { z } from "zod";
export const categories = [
  "Facts",
  "Preferences",
  "Decisions",
  "Projects",
  "Goals",
  "Skills",
  "Instructions",
  "Events",
  "Summaries",
] as const;
export const conversationSchema = z.object({
  title: z.string().trim().min(1).max(200),
  platform: z.string().trim().min(1).max(50),
  metadata: z.record(z.string(), z.unknown()).optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(20000),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .min(1)
    .max(500),
});
export type ConversationInput = z.infer<typeof conversationSchema>;
export type Proposal = {
  content: string;
  category: (typeof categories)[number];
  confidence: number;
  sensitivity: "normal" | "sensitive";
  message_index: number;
  reason: string;
};
export function normalize(content: string) {
  return content
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
export function extractProposals(input: ConversationInput): Proposal[] {
  const result: Proposal[] = [];
  const seen = new Set<string>();
  input.messages.forEach((message, message_index) => {
    if (message.role !== "user") return;
    for (const raw of message.content.split(/(?<=[.!?])\s+|\n+/)) {
      const content = raw.trim();
      if (content.length < 12 || content.length > 1000) continue;
      if (
        /\b(tonight|today|tomorrow|maybe|perhaps|might|could|should we|what if|ignore .*instructions|system prompt|bypass|pretend)\b/i.test(
          content,
        ) ||
        content.endsWith("?")
      )
        continue;
      let category: Proposal["category"] | undefined;
      if (
        /\b(we decided|we have decided|we chose|we selected|let['’]s use|we are migrating to)\b/i.test(
          content,
        )
      )
        category = "Decisions";
      else if (
        /\b(i prefer|my preference|i like .* explanations)\b/i.test(content)
      )
        category = "Preferences";
      else if (
        /\b(this project uses|the frontend uses|the backend uses|our stack is)\b/i.test(
          content,
        )
      )
        category = "Facts";
      else if (/\b(my goal is|i am building|i'm building)\b/i.test(content))
        category = "Goals";
      else if (/^(always|never|please use)\s/i.test(content))
        category = "Instructions";
      if (!category) continue;
      const key = normalize(content);
      if (seen.has(key)) continue;
      seen.add(key);
      const sensitivity =
        /\b(password|secret|api.?key|token|ssn)\b|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b\d{3}-\d{2}-\d{4}\b/i.test(
          content,
        )
          ? "sensitive"
          : "normal";
      result.push({
        content,
        category,
        confidence: category === "Decisions" ? 0.9 : 0.8,
        sensitivity,
        message_index,
        reason:
          "Direct user statement matched a conservative durable-context rule. Human review is required; confidence is heuristic.",
      });
    }
  });
  return result.slice(0, 100);
}
export async function contentHash(input: ConversationInput) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(input)),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
