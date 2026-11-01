import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  ArrowRight,
  Plus,
  Layers,
  FileText,
  FolderKanban,
} from "lucide-react";
import { useWorkspace } from "../../components/AppLayout";
import { Empty, Notice } from "../../components/ui";
import { db } from "../../lib/supabase";
import { useRecords } from "../../lib/useRecords";
import type { Activity } from "../../lib/types";
import { errorMessage } from "../../lib/api";
import { useRpc, type Usage } from "../../lib/product";
export function Overview() {
  const { workspace } = useWorkspace();
  const usage = useRpc<Usage>("workspace_usage", { p_workspace: workspace.id });
  const activity = useRecords<Activity>("audit_logs");
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    Promise.all(
      ["memories", "conversations", "projects", "pending"].map(async (key) => {
        let q = db()
          .from(key === "pending" ? "memories" : key)
          .select("*", { count: "exact", head: true })
          .eq("workspace_id", workspace.id);
        if (key === "pending") q = q.eq("status", "pending");
        if (key === "memories") q = q.eq("status", "active");
        const { count, error } = await q;
        if (error) throw error;
        return [key, count || 0] as const;
      }),
    )
      .then((entries) => {
        if (active) setCounts(Object.fromEntries(entries));
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      });
    return () => {
      active = false;
    };
  }, [workspace.id]);
  return (
    <>
      <div className="page-header">
        <div>
          <span className="eyebrow">YOUR CONTEXT, AT A GLANCE</span>
          <h1>Overview</h1>
          <p>A little less repetition. A little more continuity.</p>
        </div>
        <Link className="button" to="/app/conversations">
          <Plus size={16} />
          Import conversation
        </Link>
      </div>
      {error && <Notice error>{error}</Notice>}
      {usage.error && <Notice error>{usage.error}</Notice>}
      <p>
        <Link className="text-link" to="/app/onboarding">
          Start or resume your onboarding guide
        </Link>
      </p>
      <div className="stats-row">
        {[
          ["memories", "Active memories", Layers],
          ["conversations", "Conversations", FileText],
          ["projects", "Projects", FolderKanban],
          ["pending", "Awaiting review", Layers],
        ].map(([key, label, Icon]) => {
          const IconComponent = Icon as typeof Layers;
          return (
            <Link
              key={String(key)}
              to={
                "/app/" + (key === "pending" ? "memories?status=pending" : key)
              }
            >
              <span>
                {String(label)}
                <IconComponent size={17} />
              </span>
              <strong>{counts ? counts[String(key)] : "—"}</strong>
              <small>
                {key === "pending"
                  ? "Your judgment makes memory better"
                  : "From your workspace records"}
                <ArrowUpRight size={12} />
              </small>
            </Link>
          );
        })}
      </div>
      <div className="overview-grid">
        <section className="app-section">
          <div className="section-bar">
            <h2>Recent activity</h2>
            <Link to="/app/activity">
              View all <ArrowRight size={14} />
            </Link>
          </div>
          {activity.loading ? (
            <p role="status">Loading activity…</p>
          ) : activity.error ? (
            <Notice error>{activity.error}</Notice>
          ) : activity.data.length ? (
            <div className="activity-list">
              {activity.data.slice(0, 8).map((a) => (
                <div key={a.id}>
                  <span className="timeline-dot" />
                  <div>
                    <strong>
                      {a.event
                        .toLowerCase()
                        .replace(/\b\w/g, (c) => c.toUpperCase())}{" "}
                      · {a.entity_type.replaceAll("_", " ")}
                    </strong>
                    <small>{new Date(a.created_at).toLocaleString()}</small>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty title="A fresh page for your thinking.">
              Import your first conversation and your memory activity will
              appear here.
            </Empty>
          )}
        </section>
        <section className="app-section next-steps">
          <span className="eyebrow">MAKE IT YOURS</span>
          <h2>
            Start with one
            <br />
            good conversation.
          </h2>
          <p>
            You don’t need to bring everything. Begin with a decision or a
            project you want to keep moving.
          </p>
          <Link to="/app/projects">
            <span>01</span>Create a project
            <ArrowUpRight size={16} />
          </Link>
          <Link to="/app/conversations">
            <span>02</span>Import a conversation
            <ArrowUpRight size={16} />
          </Link>
          <Link to="/app/memories?status=pending">
            <span>03</span>Review your first memories
            <ArrowUpRight size={16} />
          </Link>
          <div className="connection-summary">
            <span className="status-dot muted" />{" "}
            {usage.data
              ? `${usage.data.verified_agents} verified agent credentials · ${usage.data.connections} active connections · ${usage.data.plan} plan`
              : "Loading connection and plan state…"}
            <Link to="/app/connections">See connection capabilities</Link>
            <Link to="/app/usage">View actual usage and limits</Link>
          </div>
        </section>
      </div>
    </>
  );
}
