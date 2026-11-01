import { describe, it, expect } from "vitest";
// The extension's pure normalization functions run unchanged in Node and browsers.
import {
  normalizedConversation,
  contentHash,
} from "../../apps/browser-extension/src/lib/normalizer.js";
describe("authorized extension snapshots", () => {
  it("retains visible messages while rejecting unsupported sources and hidden roles", () => {
    expect(() =>
      normalizedConversation(
        "chatgpt",
        [{ role: "user", content: "Hello" }],
        "Title",
        "https://unrelated.example/chat",
      ),
    ).toThrow();
    const snapshot = normalizedConversation(
      "chatgpt",
      [
        { role: "user", content: "  Visible question  " },
        { role: "assistant", content: "Visible answer" },
        { role: "system", content: "hidden state" },
      ],
      "Title",
      "https://chatgpt.com/c/visible?secret=never-retain#fragment",
    );
    expect(snapshot.messages).toHaveLength(2);
    expect(snapshot.metadata.url).toBe("https://chatgpt.com/c/visible");
    expect(JSON.stringify(snapshot)).not.toContain("hidden state");
  });
  it("deduplicates unchanged content despite different capture timestamps", async () => {
    const snapshot = normalizedConversation(
      "claude",
      [{ role: "user", content: "I prefer concise explanations." }],
      "Title",
      "https://claude.ai/chat/visible",
    );
    const changedTimestamp = {
      ...snapshot,
      metadata: { ...snapshot.metadata, captured_at: "2099-01-01" },
    };
    expect(await contentHash(snapshot)).toBe(
      await contentHash(changedTimestamp),
    );
  });
});
