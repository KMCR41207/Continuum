/**
 * LLM-based memory extraction provider.
 *
 * Uses an OpenAI-compatible chat completions endpoint to extract durable
 * memories from a conversation. Falls back gracefully to an empty result when
 * unconfigured so the rest of the pipeline is unaffected.
 *
 * Required env vars (all optional — falls back to no-op when absent):
 *   EXTRACTION_URL   HTTPS chat completions endpoint (e.g. https://api.openai.com/v1/chat/completions)
 *   EXTRACTION_MODEL Model name (e.g. gpt-4o-mini, claude-3-haiku)
 *   EXTRACTION_API_KEY Bearer key for the endpoint
 *
 * The provider never logs conversation content. Only the job ID and status
 * are logged. All requests use redirect:error to prevent SSRF.
 */

import type { ConversationInput, Proposal } from "../src/lib/memory.ts";
import { normalize } from "../src/lib/memory.ts";

export interface ExtractionProvider {
  model: string;
  extract(input: ConversationInput): Promise<Proposal[]>;
}

/** System prompt — conservative and evidence-anchored. */
const SYSTEM_PROMPT = `You are a memory extraction assistant. Your job is to extract
durable, reusable facts from an AI conversation that are worth remembering across
future sessions with other AI tools.

Rules:
- Extract only statements from USER messages, never from assistant messages.
- Only extract durable facts: decisions, preferences, standing instructions, project
  facts, goals, skills and notable events. NOT questions, greetings, temporary plans
  ("let's do this today"), or anything phrased as uncertain ("maybe", "perhaps").
- Do NOT extract: passwords, API keys, tokens, emails, SSNs or other sensitive
  credentials (mark sensitivity "sensitive" if unavoidable).
- Each extracted item must be directly evidenced by an exact substring of a user
  message. Include the message_index (0-based) and the evidence substring.
- Return a JSON array. Each item: { content, category, confidence, sensitivity, message_index, evidence, reason }
  - content: the fact to remember (12–1000 chars)
  - category: one of Facts | Preferences | Decisions | Projects | Goals | Skills | Instructions | Events | Summaries
  - confidence: 0.0–1.0 (Decisions = 0.9, explicit preferences = 0.85, inferred = 0.7)
  - sensitivity: "normal" | "sensitive"
  - message_index: 0-based index of the user message this comes from
  - evidence: exact substring from that user message proving this fact
  - reason: one sentence explaining why this is worth remembering
- Return [] if nothing is worth remembering.
- Maximum 20 items per conversation.
- Return ONLY the JSON array, no markdown, no explanation.`;

/** Builds the user message for the LLM. */
function buildPrompt(input: ConversationInput): string {
  const lines: string[] = [
    `Title: ${input.title}`,
    `Platform: ${input.platform}`,
    ``,
    `Messages:`,
  ];
  // Bound the request size: long sessions keep every message index but trim
  // assistant text first, since memories are only extracted from user messages.
  let budget = 120_000;
  input.messages.forEach((m, i) => {
    const limit = m.role === "user" ? 4000 : 1000;
    const text = budget > 0 ? m.content.slice(0, Math.min(limit, budget)) : "[omitted]";
    budget -= text.length;
    lines.push(`[${i}] ${m.role.toUpperCase()}: ${text}`);
  });
  return lines.join("\n");
}

/** Validates and cleans a raw proposal from the LLM. */
function validateProposal(
  raw: unknown,
  input: ConversationInput,
): Proposal | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const content = typeof r.content === "string" ? r.content.trim() : "";
  if (content.length < 12 || content.length > 1000) return null;

  const categories = [
    "Facts", "Preferences", "Decisions", "Projects",
    "Goals", "Skills", "Instructions", "Events", "Summaries",
  ] as const;
  type Category = typeof categories[number];
  const category = categories.includes(r.category as Category)
    ? (r.category as Category)
    : null;
  if (!category) return null;

  const message_index =
    typeof r.message_index === "number" &&
    Number.isInteger(r.message_index) &&
    r.message_index >= 0 &&
    r.message_index < input.messages.length
      ? r.message_index
      : null;
  if (message_index === null) return null;

  // Only extract from user messages
  if (input.messages[message_index].role !== "user") return null;

  // Evidence must appear in the actual message content
  const evidence = typeof r.evidence === "string" ? r.evidence.trim() : "";
  const messageContent = input.messages[message_index].content;
  if (!evidence || !messageContent.includes(evidence)) return null;

  const confidence =
    typeof r.confidence === "number" &&
    r.confidence >= 0 &&
    r.confidence <= 1
      ? Math.round(r.confidence * 100) / 100
      : 0.8;

  // Detect sensitivity in content and evidence
  const sensitivePattern =
    /\b(password|secret|api.?key|token|ssn)\b|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b\d{3}-\d{2}-\d{4}\b/i;
  const sensitivity =
    r.sensitivity === "sensitive" ||
    sensitivePattern.test(content) ||
    sensitivePattern.test(evidence)
      ? "sensitive"
      : "normal";

  const reason =
    typeof r.reason === "string" && r.reason.trim().length > 0
      ? r.reason.trim().slice(0, 500)
      : "LLM-extracted from user statement. Human review required.";

  return {
    content,
    category,
    confidence,
    sensitivity,
    message_index,
    evidence,
    reason,
  };
}

/**
 * Creates an LLM extraction provider from environment variables.
 * Returns null when not configured — the system falls back to rule-based extraction.
 */
export function extractionProvider(
  env: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
): ExtractionProvider | null {
  if (!env.EXTRACTION_URL || !env.EXTRACTION_MODEL || !env.EXTRACTION_API_KEY)
    return null;

  const url = new URL(env.EXTRACTION_URL);
  if (url.protocol !== "https:")
    throw new Error("Extraction endpoint must use HTTPS");

  const model = env.EXTRACTION_MODEL;
  const maxTokens = Number(env.EXTRACTION_MAX_TOKENS || "2048");
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 64000)
    throw new Error("EXTRACTION_MAX_TOKENS must be an integer between 1 and 64000");

  return {
    model,
    async extract(input: ConversationInput): Promise<Proposal[]> {
      const response = await fetcher(url, {
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${env.EXTRACTION_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: buildPrompt(input) },
          ],
          max_tokens: maxTokens,
          temperature: 0.1, // low temperature for consistent extraction
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        throw new Error(`Extraction provider responded with ${response.status}`);
      }

      const data = await response.json() as Record<string, unknown>;

      // Parse the response — handle both array and object wrapping
      let raw: unknown;
      const text = (data?.choices as any)?.[0]?.message?.content;
      if (typeof text !== "string") throw new Error("Unexpected extraction response shape");

      try {
        // Many models wrap JSON in a markdown fence despite instructions; accept that.
        const fenced = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
        const parsed = JSON.parse(fenced ? fenced[1] : text.trim());
        raw = Array.isArray(parsed) ? parsed : (parsed?.items ?? parsed?.memories ?? parsed?.proposals ?? []);
      } catch {
        throw new Error("Extraction provider returned invalid JSON");
      }

      if (!Array.isArray(raw)) throw new Error("Extraction result is not an array");

      // Validate each proposal and deduplicate by normalized content
      const seen = new Set<string>();
      const proposals: Proposal[] = [];
      for (const item of raw) {
        const proposal = validateProposal(item, input);
        if (!proposal) continue;
        const key = normalize(proposal.content);
        if (seen.has(key)) continue;
        seen.add(key);
        proposals.push(proposal);
        if (proposals.length >= 20) break;
      }

      return proposals;
    },
  };
}
