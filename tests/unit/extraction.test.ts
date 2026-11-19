/**
 * extraction.test.ts
 * Unit tests for server/extraction.ts — LLM-based memory extraction provider.
 *
 * Tests the provider factory, response parsing, evidence validation,
 * deduplication, sensitivity detection, and fallback behaviour.
 * No real LLM calls are made.
 */
import { describe, it, expect } from "vitest";
import { extractionProvider } from "../../server/extraction";
import type { ConversationInput } from "../../src/lib/memory";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const baseEnv = {
  EXTRACTION_URL: "https://api.example.test/v1/chat/completions",
  EXTRACTION_MODEL: "test-model",
  EXTRACTION_API_KEY: "sk-fixture",
};

const singleUserConversation: ConversationInput = {
  title: "Architecture decision",
  platform: "chatgpt",
  messages: [
    {
      role: "user",
      content: "We decided to use PostgreSQL for the application database. I prefer TypeScript for all new code.",
    },
    {
      role: "assistant",
      content: "Great choices! PostgreSQL is excellent for relational data.",
    },
  ],
};

function makeFetch(proposals: object[]): typeof fetch {
  return async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify(proposals),
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
}

function makeErrorFetch(status: number): typeof fetch {
  return async () => new Response("{}", { status });
}

function makeInvalidJsonFetch(): typeof fetch {
  return async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: "not valid json {{{{" } }],
      }),
      { status: 200 },
    );
}

// ── Provider factory ──────────────────────────────────────────────────────────

describe("extractionProvider factory", () => {
  it("returns null when env vars are missing", () => {
    expect(extractionProvider({})).toBeNull();
    expect(extractionProvider({ EXTRACTION_URL: "https://x.test" })).toBeNull();
    expect(
      extractionProvider({
        EXTRACTION_URL: "https://x.test",
        EXTRACTION_MODEL: "m",
      }),
    ).toBeNull();
  });

  it("throws when URL is not HTTPS", () => {
    expect(() =>
      extractionProvider({
        ...baseEnv,
        EXTRACTION_URL: "http://api.example.test/v1/chat/completions",
      }),
    ).toThrow(/HTTPS/);
  });

  it("returns a provider with the correct model name", () => {
    const p = extractionProvider(baseEnv, makeFetch([]));
    expect(p).not.toBeNull();
    expect(p!.model).toBe("test-model");
  });
});

// ── Successful extraction ─────────────────────────────────────────────────────

describe("extractionProvider.extract — valid proposals", () => {
  it("returns validated proposals from LLM response", async () => {
    const llmProposals = [
      {
        content: "We decided to use PostgreSQL for the application database.",
        category: "Decisions",
        confidence: 0.9,
        sensitivity: "normal",
        message_index: 0,
        evidence: "We decided to use PostgreSQL for the application database.",
        reason: "Explicit team decision.",
      },
    ];
    const p = extractionProvider(baseEnv, makeFetch(llmProposals))!;
    const results = await p.extract(singleUserConversation);
    expect(results).toHaveLength(1);
    expect(results[0].category).toBe("Decisions");
    expect(results[0].confidence).toBe(0.9);
    expect(results[0].sensitivity).toBe("normal");
    expect(results[0].message_index).toBe(0);
  });

  it("extracts multiple proposals from one conversation", async () => {
    const llmProposals = [
      {
        content: "We decided to use PostgreSQL for the application database.",
        category: "Decisions",
        confidence: 0.9,
        sensitivity: "normal",
        message_index: 0,
        evidence: "We decided to use PostgreSQL for the application database.",
        reason: "Decision.",
      },
      {
        content: "I prefer TypeScript for all new code.",
        category: "Preferences",
        confidence: 0.85,
        sensitivity: "normal",
        message_index: 0,
        evidence: "I prefer TypeScript for all new code.",
        reason: "Preference.",
      },
    ];
    const p = extractionProvider(baseEnv, makeFetch(llmProposals))!;
    const results = await p.extract(singleUserConversation);
    expect(results).toHaveLength(2);
  });

  it("handles LLM wrapping array in object (e.g. {items: [...]})", async () => {
    const fake: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  items: [
                    {
                      content: "We decided to use PostgreSQL for the application database.",
                      category: "Decisions",
                      confidence: 0.9,
                      sensitivity: "normal",
                      message_index: 0,
                      evidence: "We decided to use PostgreSQL for the application database.",
                      reason: "Decision.",
                    },
                  ],
                }),
              },
            },
          ],
        }),
        { status: 200 },
      );
    const p = extractionProvider(baseEnv, fake)!;
    const results = await p.extract(singleUserConversation);
    expect(results).toHaveLength(1);
  });

  it("returns empty array when LLM finds nothing", async () => {
    const p = extractionProvider(baseEnv, makeFetch([]))!;
    const results = await p.extract(singleUserConversation);
    expect(results).toEqual([]);
  });
});

// ── Evidence validation ───────────────────────────────────────────────────────

describe("extractionProvider.extract — evidence validation", () => {
  it("rejects proposals where evidence is not in the source message", async () => {
    const llmProposals = [
      {
        content: "We use MongoDB for caching.",
        category: "Facts",
        confidence: 0.8,
        sensitivity: "normal",
        message_index: 0,
        evidence: "We use MongoDB for caching.", // not in the actual message
        reason: "Hallucinated.",
      },
    ];
    const p = extractionProvider(baseEnv, makeFetch(llmProposals))!;
    const results = await p.extract(singleUserConversation);
    expect(results).toHaveLength(0);
  });

  it("rejects proposals from assistant messages (message_index pointing to assistant)", async () => {
    const conv: ConversationInput = {
      title: "Test",
      platform: "claude",
      messages: [
        { role: "user", content: "What database should I use?" },
        {
          role: "assistant",
          content: "I recommend PostgreSQL for reliability.",
        },
      ],
    };
    const llmProposals = [
      {
        content: "I recommend PostgreSQL for reliability.",
        category: "Facts",
        confidence: 0.8,
        sensitivity: "normal",
        message_index: 1, // assistant message — must be rejected
        evidence: "I recommend PostgreSQL for reliability.",
        reason: "Assistant claim.",
      },
    ];
    const p = extractionProvider(baseEnv, makeFetch(llmProposals))!;
    const results = await p.extract(conv);
    expect(results).toHaveLength(0);
  });

  it("rejects proposals with out-of-range message_index", async () => {
    const llmProposals = [
      {
        content: "Some valid looking fact.",
        category: "Facts",
        confidence: 0.8,
        sensitivity: "normal",
        message_index: 99, // doesn't exist
        evidence: "Some valid looking fact.",
        reason: "Test.",
      },
    ];
    const p = extractionProvider(baseEnv, makeFetch(llmProposals))!;
    const results = await p.extract(singleUserConversation);
    expect(results).toHaveLength(0);
  });

  it("rejects proposals with content too short", async () => {
    const llmProposals = [
      {
        content: "Short.",
        category: "Facts",
        confidence: 0.8,
        sensitivity: "normal",
        message_index: 0,
        evidence: "Short.",
        reason: "Test.",
      },
    ];
    const p = extractionProvider(baseEnv, makeFetch(llmProposals))!;
    const results = await p.extract(singleUserConversation);
    expect(results).toHaveLength(0);
  });

  it("rejects proposals with unknown category", async () => {
    const llmProposals = [
      {
        content: "We decided to use PostgreSQL for the application database.",
        category: "RandomCategory", // invalid
        confidence: 0.8,
        sensitivity: "normal",
        message_index: 0,
        evidence: "We decided to use PostgreSQL for the application database.",
        reason: "Test.",
      },
    ];
    const p = extractionProvider(baseEnv, makeFetch(llmProposals))!;
    const results = await p.extract(singleUserConversation);
    expect(results).toHaveLength(0);
  });
});

// ── Sensitivity detection ─────────────────────────────────────────────────────

describe("extractionProvider.extract — sensitivity", () => {
  it("marks sensitivity=sensitive when content contains password keyword", async () => {
    const conv: ConversationInput = {
      title: "Config",
      platform: "chatgpt",
      messages: [
        {
          role: "user",
          content: "Please use my API key sk-1234 for all requests in this project.",
        },
      ],
    };
    const llmProposals = [
      {
        content: "Please use my API key sk-1234 for all requests in this project.",
        category: "Instructions",
        confidence: 0.8,
        sensitivity: "normal", // LLM might miss it — we re-check
        message_index: 0,
        evidence: "Please use my API key sk-1234 for all requests in this project.",
        reason: "Instruction with credential.",
      },
    ];
    const p = extractionProvider(baseEnv, makeFetch(llmProposals))!;
    const results = await p.extract(conv);
    expect(results).toHaveLength(1);
    expect(results[0].sensitivity).toBe("sensitive");
  });

  it("marks sensitivity=sensitive when LLM says so", async () => {
    const conv: ConversationInput = {
      title: "Config",
      platform: "chatgpt",
      messages: [
        {
          role: "user",
          content: "My email for this project is alice@example.com.",
        },
      ],
    };
    const llmProposals = [
      {
        content: "My email for this project is alice@example.com.",
        category: "Facts",
        confidence: 0.8,
        sensitivity: "sensitive",
        message_index: 0,
        evidence: "My email for this project is alice@example.com.",
        reason: "Contains personal data.",
      },
    ];
    const p = extractionProvider(baseEnv, makeFetch(llmProposals))!;
    const results = await p.extract(conv);
    expect(results[0].sensitivity).toBe("sensitive");
  });

  it("keeps sensitivity=normal for non-sensitive content", async () => {
    const llmProposals = [
      {
        content: "We decided to use PostgreSQL for the application database.",
        category: "Decisions",
        confidence: 0.9,
        sensitivity: "normal",
        message_index: 0,
        evidence: "We decided to use PostgreSQL for the application database.",
        reason: "Decision.",
      },
    ];
    const p = extractionProvider(baseEnv, makeFetch(llmProposals))!;
    const results = await p.extract(singleUserConversation);
    expect(results[0].sensitivity).toBe("normal");
  });
});

// ── Deduplication ─────────────────────────────────────────────────────────────

describe("extractionProvider.extract — deduplication", () => {
  it("deduplicates proposals with identical normalized content", async () => {
    const llmProposals = [
      {
        content: "We decided to use PostgreSQL for the application database.",
        category: "Decisions",
        confidence: 0.9,
        sensitivity: "normal",
        message_index: 0,
        evidence: "We decided to use PostgreSQL for the application database.",
        reason: "Decision.",
      },
      {
        content: "We decided to use PostgreSQL for the application database.",
        category: "Decisions",
        confidence: 0.9,
        sensitivity: "normal",
        message_index: 0,
        evidence: "We decided to use PostgreSQL for the application database.",
        reason: "Duplicate.",
      },
    ];
    const p = extractionProvider(baseEnv, makeFetch(llmProposals))!;
    const results = await p.extract(singleUserConversation);
    expect(results).toHaveLength(1);
  });

  it("caps results at 20 even if LLM returns more", async () => {
    const conv: ConversationInput = {
      title: "Many facts",
      platform: "chatgpt",
      messages: [
        {
          role: "user",
          content: Array.from({ length: 30 }, (_, i) =>
            `I prefer option ${i} for my workflow.`
          ).join(" "),
        },
      ],
    };
    const llmProposals = Array.from({ length: 30 }, (_, i) => ({
      content: `I prefer option ${i} for my workflow.`,
      category: "Preferences",
      confidence: 0.8,
      sensitivity: "normal",
      message_index: 0,
      evidence: `I prefer option ${i} for my workflow.`,
      reason: `Preference ${i}.`,
    }));
    const p = extractionProvider(baseEnv, makeFetch(llmProposals))!;
    const results = await p.extract(conv);
    expect(results.length).toBeLessThanOrEqual(20);
  });
});

// ── Error handling ────────────────────────────────────────────────────────────

describe("extractionProvider.extract — error handling", () => {
  it("throws on non-200 response from provider", async () => {
    const p = extractionProvider(baseEnv, makeErrorFetch(500))!;
    await expect(p.extract(singleUserConversation)).rejects.toThrow("500");
  });

  it("throws when provider returns invalid JSON in content", async () => {
    const p = extractionProvider(baseEnv, makeInvalidJsonFetch())!;
    await expect(p.extract(singleUserConversation)).rejects.toThrow(
      /invalid JSON/i,
    );
  });

  it("throws on 401 from provider", async () => {
    const p = extractionProvider(baseEnv, makeErrorFetch(401))!;
    await expect(p.extract(singleUserConversation)).rejects.toThrow("401");
  });
});

// ── Request shape ─────────────────────────────────────────────────────────────

describe("extractionProvider — request shape", () => {
  it("sends correct model and Authorization header", async () => {
    let capturedRequest: RequestInit | undefined;
    const captureFetch: typeof fetch = async (_url, init) => {
      capturedRequest = init;
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "[]" } }] }),
        { status: 200 },
      );
    };
    const p = extractionProvider(baseEnv, captureFetch)!;
    await p.extract(singleUserConversation);

    expect(capturedRequest).toBeDefined();
    const body = JSON.parse(capturedRequest!.body as string);
    expect(body.model).toBe("test-model");
    expect(body.temperature).toBe(0.1);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[1].role).toBe("user");

    const headers = capturedRequest!.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer sk-fixture");
  });

  it("includes conversation title and platform in the prompt", async () => {
    let promptContent = "";
    const captureFetch: typeof fetch = async (_url, init) => {
      const body = JSON.parse(init!.body as string);
      promptContent = body.messages[1].content;
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "[]" } }] }),
        { status: 200 },
      );
    };
    const p = extractionProvider(baseEnv, captureFetch)!;
    await p.extract(singleUserConversation);
    expect(promptContent).toContain("Architecture decision");
    expect(promptContent).toContain("chatgpt");
    expect(promptContent).toContain("[0] USER:");
    expect(promptContent).toContain("[1] ASSISTANT:");
  });

  it("respects EXTRACTION_MAX_TOKENS env var", async () => {
    let capturedMaxTokens = 0;
    const captureFetch: typeof fetch = async (_url, init) => {
      capturedMaxTokens = JSON.parse(init!.body as string).max_tokens;
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "[]" } }] }),
        { status: 200 },
      );
    };
    const p = extractionProvider(
      { ...baseEnv, EXTRACTION_MAX_TOKENS: "1024" },
      captureFetch,
    )!;
    await p.extract(singleUserConversation);
    expect(capturedMaxTokens).toBe(1024);
  });
});
