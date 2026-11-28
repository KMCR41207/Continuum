import { describe, expect, it } from "vitest";
import { normalizeActivity } from "../../src/pages/app/Activity";

describe("activity RPC response", () => {
  it("reads the deployed daily_counts and totals fields", () => {
    expect(normalizeActivity({
      daily_counts: [{ date: "2026-11-28", count: 3 }],
      by_agent: [{ connection_id: "a", name: "Editor", count: 3 }],
      recent_lookups: [{ at: "2026-11-28T12:00:00Z", query: "context", connection_name: "Editor" }],
      totals: { requests: 3 },
    })).toEqual({ daily: [{ date: "2026-11-28", count: 3 }], by_agent: [{ connection_id: "a", name: "Editor", count: 3 }], recent_lookups: [{ at: "2026-11-28T12:00:00Z", query: "context", connection_name: "Editor" }], total: 3 });
  });
  it("handles null SQL aggregates as an empty activity result", () => {
    expect(normalizeActivity({ daily_counts: null, by_agent: null, recent_lookups: null, totals: null })).toEqual({ daily: [], by_agent: [], recent_lookups: [], total: 0 });
  });
  it("rejects malformed data rather than crashing or presenting false counts", () => {
    expect(normalizeActivity({ daily_counts: [null], by_agent: [], recent_lookups: [] })).toBeNull();
    expect(normalizeActivity({ daily_counts: [{ date: "bad", count: 1 }], by_agent: [], recent_lookups: [] })).toBeNull();
    expect(normalizeActivity({ error: "denied" })).toBeNull();
  });
});
