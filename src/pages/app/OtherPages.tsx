import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Search, Download, ShieldCheck } from "lucide-react";
import { useRecords } from "../../lib/useRecords";
import { useWorkspace } from "../../components/AppLayout";
import { useAuth } from "../../lib/AuthContext";
import { db } from "../../lib/supabase";
import { exportWorkspace, errorMessage } from "../../lib/api";
import type { Activity } from "../../lib/types";
import { Empty, Notice, ActionLink } from "../../components/ui";
export function ActivityPage() {
  const records = useRecords<Activity>("audit_logs");
  const [query, setQuery] = useState("");
  const filtered = records.data.filter((a) =>
    (a.event + " " + a.entity_type).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <div className="page-header">
        <div>
          <span className="eyebrow">A RECORD OF WHAT CHANGED</span>
          <h1>Activity</h1>
          <p>Workspace events, without sensitive conversation content.</p>
        </div>
      </div>
      <div className="filter-bar">
        <label className="search-field">
          <Search size={16} />
          <input
            aria-label="Search activity"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search events"
          />
        </label>
      </div>
      {records.error && <Notice error>{records.error}</Notice>}
      {records.loading ? (
        <p role="status">Loading activity…</p>
      ) : filtered.length ? (
        <div className="activity-list full-activity">
          {filtered.map((a) => (
            <div key={a.id}>
              <span className="timeline-dot" />
              <div>
                <strong>
                  {a.event} · {a.entity_type.replaceAll("_", " ")}
                </strong>
                <small>{new Date(a.created_at).toLocaleString()}</small>
                <code>{a.entity_id}</code>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Empty title="A quiet start.">
          Workspace changes will appear here as you begin importing and
          organizing context.
        </Empty>
      )}
    </>
  );
}
export function SettingsPage() {
  const { workspace, reload } = useWorkspace();
  const { session } = useAuth();
  const [tab, setTab] = useState("Profile");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    const f = new FormData(e.currentTarget);
    try {
      if (tab === "Profile") {
        const { error } = await db().auth.updateUser({
          data: { full_name: String(f.get("name")).trim() },
        });
        if (error) throw error;
      } else if (tab === "Workspace") {
        const name = String(f.get("name")).trim();
        if (!name) throw new Error("Workspace name is required.");
        const { error } = await db()
          .from("workspaces")
          .update({ name })
          .eq("id", workspace.id);
        if (error) throw error;
        await reload();
      }
      setNotice("Changes saved.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-header">
        <div>
          <span className="eyebrow">MAKE IT WORK FOR YOU</span>
          <h1>Settings</h1>
          <p>Your account, your workspace, and your information.</p>
        </div>
      </div>
      <div className="settings-layout">
        <nav aria-label="Settings sections">
          {[
            "Profile",
            "Workspace",
            "Memory",
            "Privacy",
            "Developer",
            "Billing",
          ].map((t) => (
            <button
              key={t}
              className={tab === t ? "selected" : ""}
              onClick={() => {
                setTab(t);
                setError("");
                setNotice("");
              }}
            >
              {t}
            </button>
          ))}
        </nav>
        <section className="settings-panel">
          <h2>{tab}</h2>
          {error && <Notice error>{error}</Notice>}
          {notice && <Notice>{notice}</Notice>}
          {["Profile", "Workspace"].includes(tab) && (
            <form key={tab} onSubmit={save}>
              <label>
                {tab === "Profile" ? "Full name" : "Workspace name"}
                <input
                  name="name"
                  required
                  maxLength={100}
                  defaultValue={
                    tab === "Profile"
                      ? session?.user.user_metadata.full_name || ""
                      : workspace.name
                  }
                />
              </label>
              {tab === "Profile" && (
                <>
                  <label>
                    Email address
                    <input value={session?.user.email || ""} readOnly />
                  </label>
                  <p className="small-text">
                    Manage verified email and password changes in Security and
                    data. Password recovery uses your verified email.
                  </p>
                  <Link to="/reset-password" className="text-link">
                    Reset password →
                  </Link>
                </>
              )}
              {tab === "Workspace" && (
                <p className="small-text">
                  Manage invitations, roles and ownership from the Team page.
                </p>
              )}
              <button className="button" disabled={busy}>
                {busy ? "Saving…" : "Save changes"}
              </button>
            </form>
          )}
          {tab === "Memory" && (
            <>
              <Notice>
                Human review is required for every proposal in this build.
              </Notice>
              <div className="setting-row">
                <div>
                  <h3>Automatic approval</h3>
                  <p>Disabled. Proposed memories must be reviewed.</p>
                </div>
                <ShieldCheck size={20} />
              </div>
              <div className="setting-row">
                <div>
                  <h3>Sensitive information</h3>
                  <p>
                    Simple patterns flag possible secrets and personal
                    information. Detection is not exhaustive.
                  </p>
                </div>
              </div>
              <div className="setting-row">
                <div>
                  <h3>Retention</h3>
                  <p>
                    Imported records remain until you delete them. Scheduled
                    retention is not implemented.
                  </p>
                </div>
              </div>
            </>
          )}
          {tab === "Privacy" && (
            <>
              <h3>Export your workspace</h3>
              <p>
                Download conversations, messages, memories, sources, projects,
                versions, and activity as JSON. The export may contain sensitive
                information.
              </p>
              <button
                className="button secondary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await exportWorkspace(workspace.id);
                    setNotice(
                      "Export generated. Check your browser downloads.",
                    );
                  } catch (e) {
                    setError(errorMessage(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Download size={16} />
                {busy ? "Preparing export…" : "Export data"}
              </button>
              <hr />
              <h3>Delete individual records</h3>
              <p>
                Delete memories from their detail view. Deleting an imported
                conversation also removes its derived memories and their version
                history, even if another source references them.
              </p>
              <Link className="text-link" to="/app/conversations">
                Manage conversations →
              </Link>
              <hr />
              <h3>Account deletion</h3>
              <p>
                Account deletion requires password reauthentication and checks
                shared-workspace ownership and subscription dependencies.
              </p>
              <Link className="button danger" to="/app/security">
                Account security and deletion
              </Link>
            </>
          )}
          {tab === "Developer" && (
            <>
              <p>
                The website uses your Supabase session and database row-level
                security. Create scoped agent tokens in Connections. The local
                MCP server and CLI enforce independent permissions.
              </p>
              <ActionLink to="/developers" secondary>
                View developer documentation
              </ActionLink>
            </>
          )}
          {tab === "Billing" && (
            <>
              <p>
                View your workspace's actual plan, usage and verified
                subscription state on the Billing page. Payments require
                configured Stripe services.
              </p>
              <ActionLink to="/app/billing" secondary>
                Manage billing
              </ActionLink>
            </>
          )}
        </section>
      </div>
    </>
  );
}
