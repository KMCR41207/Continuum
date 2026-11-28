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

  // The deployed RPC names these fields daily_counts and totals.
  const raw = r.data;
  const daily = raw?.daily_counts ?? raw?.daily;
  const agents = raw?.by_agent;
  const lookups = raw?.recent_lookups;
  const totals = raw?.totals;
  const totalValue = typeof raw?.total === "number" ? raw.total
    : typeof totals === "number" ? totals
    : totals && typeof totals === "object" && !Array.isArray(totals)
      ? Object.entries(totals).find(([key, value]) => ["requests", "total", "total_requests"].includes(key) && typeof value === "number")?.[1]
      : undefined;
  const data: ActivitySummary | null = Array.isArray(daily) && Array.isArray(agents) && Array.isArray(lookups)
    ? {
        daily: daily.map((item) => ({ date: String(item.date ?? item.day ?? ""), count: Number(item.count ?? item.requests ?? 0) || 0 })),
        by_agent: agents.map((item, index) => ({ connection_id: String(item.connection_id ?? item.id ?? index), name: String(item.name ?? item.connection_name ?? "Unknown agent"), count: Number(item.count ?? item.requests ?? 0) || 0 })),
        recent_lookups: lookups.map((item) => ({ at: String(item.at ?? item.created_at ?? ""), query: String(item.query ?? ""), connection_name: String(item.connection_name ?? item.name ?? "Unknown agent") })),
        total: typeof totalValue === "number" ? totalValue : daily.reduce((sum, item) => sum + (Number(item.count ?? item.requests ?? 0) || 0), 0),
      }
    : null;
  const invalidData = raw !== null && !data;
  const responseShape = Array.isArray(raw)
    ? `array (${raw.length} items)`
    : raw && typeof raw === "object"
      ? `fields: ${Object.keys(raw).sort().join(", ") || "none"}`
      : typeof raw;
  const maxCount = data?.by_agent.reduce((m, a) => Math.max(m, a.count), 1) ?? 1;

  // Build a 12-week heatmap grid (84 cells, most-recent day last)
  const dailyMap = new Map(data?.daily.map((d) => [d.date, d.count]) ?? []);
  const today = new Date();
  const cells: { date: string; count: number }[] = [];
  for (let i = 83; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    cells.push({ date: key, count: dailyMap.get(key) ?? 0 });
  }
  // Chunk into 12 weeks of 7 days
  const weeks: { date: string; count: number }[][] = [];
  for (let w = 0; w < 12; w++) {
    weeks.push(cells.slice(w * 7, w * 7 + 7));
  }
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
      {invalidData && <Notice error>Activity data is unavailable: the server returned an unexpected response ({responseShape}).</Notice>}
      {r.loading && <p role="status">Loading activity…</p>}

      {selfHosted && (
        <Notice>Activity data requires the Supabase backend. This feature is not available in self-hosted mode.</Notice>
      )}

      {data && (
        <>
          <section className="app-section">
            <h2>12-week overview · {data.total.toLocaleString()} total requests</h2>
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
