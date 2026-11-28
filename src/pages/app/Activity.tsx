import { useState } from "react";
import { useWorkspace } from "../../components/AppLayout";
import { useRpc } from "../../lib/product";
import { Notice } from "../../components/ui";
import { selfHosted } from "../../lib/localBackend";

type ActivitySummary = {
  daily: { date: string; count: number }[];
  by_agent: { connection_id: string; name: string; count: number }[];
  recent_lookups: { at: string; query: string; connection_name: string }[];
  total: number;
};

/** Convert supported activity RPC contracts without trusting malformed rows. */
export function normalizeActivity(raw: unknown): ActivitySummary | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const rawDaily = Object.hasOwn(value, "daily_counts") ? value.daily_counts : value.daily;
  const rawAgents = value.by_agent;
  const rawLookups = value.recent_lookups;
  // SQL aggregate results can be null when there are no matching rows.
  if (!(Array.isArray(rawDaily) || rawDaily === null) ||
      !(Array.isArray(rawAgents) || rawAgents === null) ||
      !(Array.isArray(rawLookups) || rawLookups === null)) return null;
  const record = (item: unknown): Record<string, unknown> | null =>
    item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : null;
  const count = (n: unknown): number | null => {
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
    return n;
  };
  const daily: ActivitySummary["daily"] = [];
  for (const item of rawDaily ?? []) {
    const row = record(item);
    const date = row?.date ?? row?.day;
    const amount = count(row?.count ?? row?.requests);
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || amount === null) return null;
    daily.push({ date, count: amount });
  }
  const by_agent: ActivitySummary["by_agent"] = [];
  for (const [index, item] of (rawAgents ?? []).entries()) {
    const row = record(item);
    const amount = count(row?.count ?? row?.requests);
    if (!row || amount === null) return null;
    by_agent.push({ connection_id: String(row.connection_id ?? row.id ?? index), name: String(row.name ?? row.connection_name ?? "Unknown agent"), count: amount });
  }
  const recent_lookups: ActivitySummary["recent_lookups"] = [];
  for (const item of rawLookups ?? []) {
    const row = record(item);
    const at = row?.at ?? row?.created_at;
    if (!row || typeof at !== "string" || !Number.isFinite(Date.parse(at))) return null;
    recent_lookups.push({ at, query: typeof row.query === "string" ? row.query : "", connection_name: String(row.connection_name ?? row.name ?? "Unknown agent") });
  }
  const totals = record(value.totals);
  const total = count(value.total) ?? count(value.totals) ?? count(totals?.requests) ??
    count(totals?.total) ?? count(totals?.total_requests) ?? daily.reduce((sum, row) => sum + row.count, 0);
  return { daily, by_agent, recent_lookups, total };
}

const RANGES = [
  { label: "30 days", value: 30 },
  { label: "60 days", value: 60 },
  { label: "90 days", value: 90 },
];

export function ActivityPage() {
  const { workspace } = useWorkspace();
  const [days, setDays] = useState(30);
  const r = useRpc<Record<string, unknown>>("get_activity_summary", {
    p_workspace: workspace.id,
    p_days: days,
  });

  const raw = r.data;
  const data = normalizeActivity(raw);
  const invalidData = raw !== null && !data;
  const maxCount = data?.by_agent.reduce((m, a) => Math.max(m, a.count), 1) ?? 1;

  // Group the selected range by UTC dates, matching the backend's buckets.
  const dailyMap = new Map(data?.daily.map((d) => [d.date, d.count]) ?? []);
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const cells = Array.from({ length: days }, (_, i) => {
    const date = new Date(todayUtc - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10);
    return { date, count: dailyMap.get(date) ?? 0 };
  });
  const weeks: { date: string; count: number }[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  const heatLevel = (count: number) => {
    if (count === 0) return "0";
    if (count < 5) return "1";
    if (count < 15) return "2";
    if (count < 40) return "3";
    return "4";
  };

  return (
    <>
      <div className="page-header">
        <div>
          <span className="eyebrow">WORKSPACE INTELLIGENCE</span>
          <h1>Activity</h1>
          <p>Memory retrievals and captures across all agents over time.</p>
        </div>
      </div>

      <div className="range-selector" style={{ marginBottom: "1.5rem" }}>
        {RANGES.map((opt) => (
          <button
            key={opt.value}
            className={days === opt.value ? "active" : ""}
            aria-pressed={days === opt.value}
            onClick={() => setDays(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {r.error && <Notice error>{r.error}</Notice>}
      {invalidData && <Notice error>Activity data is unavailable: the server returned an unexpected response.</Notice>}
      {r.loading && <p role="status">Loading activity…</p>}

      {selfHosted && (
        <Notice>Activity data requires the Supabase backend. This feature is not available in self-hosted mode.</Notice>
      )}

      {data && (
        <>
          <section className="app-section">
            <h2>{days}-day overview · {data.total.toLocaleString()} total requests</h2>
            <div className="heatmap" aria-label="Activity heatmap">
              {weeks.map((week, wi) => (
                <div className="heatmap-week" key={wi}>
                  {week.map((cell) => (
                    <div
                      key={cell.date}
                      className="heatmap-cell"
                      data-level={heatLevel(cell.count)}
                      title={`${cell.date}: ${cell.count} requests`}
                    />
                  ))}
                </div>
              ))}
            </div>
          </section>

          {data.by_agent.length > 0 && (
            <section className="app-section">
              <h2>By agent</h2>
              <div className="activity-bars">
                {data.by_agent.map((agent) => (
                  <div className="activity-bar-row" key={agent.connection_id}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {agent.name}
                    </span>
                    <div className="activity-bar-track">
                      <div
                        className="activity-bar-fill"
                        style={{ width: `${Math.round((agent.count / maxCount) * 100)}%` }}
                      />
                    </div>
                    <span className="activity-count">{agent.count.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {data.recent_lookups.length > 0 && (
            <section className="app-section">
              <h2>Recent lookups</h2>
              <div className="activity-feed">
                {data.recent_lookups.map((item, i) => (
                  <div className="activity-feed-item" key={i}>
                    <time dateTime={item.at}>
                      {new Date(item.at).toLocaleString()}
                    </time>
                    <span>{item.connection_name}</span>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.query}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {data.total === 0 && (
            <p>No agent activity recorded in the last {days} days.</p>
          )}
        </>
      )}
    </>
  );
}
