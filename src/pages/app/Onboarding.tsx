import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useWorkspace } from "../../components/AppLayout";
import { useAuth } from "../../lib/AuthContext";
import { db } from "../../lib/supabase";
import { Notice } from "../../components/ui";
const steps = [
  [
    "Welcome to Continuum",
    "Your workspace is ready. Keep useful context while choosing exactly what each agent can access.",
  ],
  [
    "Your first project",
    "Give related conversations and memories a shared scope. You may skip this step and use global context.",
  ],
  [
    "How memories work",
    "Imports preserve source messages. Conservative extraction proposes memories; only reviewed, non-sensitive active memories are served to agents.",
  ],
  [
    "Bring an authorized source",
    "Import a conversation you have permission to store. Optional metadata preserves source IDs, timestamps and attachment descriptions.",
  ],
  [
    "Connect an agent",
    "Create an owner-issued scoped credential, configure the local MCP server or the CLI, then validate it. Remote HTTP clients require the configured MCP service.",
  ],
  [
    "Choose permissions",
    "Capture, retrieval and writing are independent. Grant only selected projects and source history. This guide never enables access automatically.",
  ],
  [
    "Review and continue",
    "Approve useful memories and reject temporary or sensitive content. You can revisit this guide whenever you need it.",
  ],
  [
    "Ready to continue",
    "Your choices remain under your control. Build your context one useful source at a time.",
  ],
];
export function OnboardingPage() {
  const { workspace } = useWorkspace();
  const { session } = useAuth();
  const [step, setStep] = useState(0),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    void db()
      .from("onboarding_progress")
      .select("step")
      .eq("user_id", session!.user.id)
      .eq("workspace_id", workspace.id)
      .maybeSingle()
      .then((r) => {
        if (r.error) setError(r.error.message);
        else setStep(r.data?.step || 0);
        setLoading(false);
      });
  }, [workspace.id, session?.user.id]);
  async function save(next: number, completed = false) {
    setBusy(true);
    setError("");
    const r = await db()
      .from("onboarding_progress")
      .upsert({
        user_id: session!.user.id,
        workspace_id: workspace.id,
        step: next,
        completed,
        updated_at: new Date().toISOString(),
      });
    if (r.error) setError(r.error.message);
    else {
      setStep(next);
      if (completed)
        setNotice(
          "Onboarding completed. Your permissions have not been changed.",
        );
    }
    setBusy(false);
  }
  if (loading) return <p role="status">Loading your onboarding progress…</p>;
  return (
    <>
      <div className="page-header">
        <div>
          <span className="eyebrow">GETTING STARTED / {step + 1} OF 8</span>
          <h1>{steps[step][0]}</h1>
          <p>{steps[step][1]}</p>
        </div>
      </div>
      {error && <Notice error>{error}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      <section className="app-section">
        <p>
          Workspace: <strong>{workspace.name}</strong>
        </p>
        {step === 1 && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              const f = new FormData(e.currentTarget);
              const r = await db()
                .from("projects")
                .insert({
                  workspace_id: workspace.id,
                  name: String(f.get("name")),
                  description: "",
                  instructions: "",
                });
              if (r.error) setError(r.error.message);
              else {
                setNotice("Project created.");
                await save(2);
              }
              setBusy(false);
            }}
          >
            <label>
              Project name
              <input name="name" required maxLength={100} />
            </label>
            <button className="button" disabled={busy}>
              Create project and continue
            </button>
          </form>
        )}
        {step === 3 && (
          <Link className="button" to="/app/conversations">
            Import an authorized conversation
          </Link>
        )}
        {[4, 5].includes(step) && (
          <Link className="button" to="/app/connections">
            Configure scoped connections
          </Link>
        )}
        {step === 6 && (
          <Link className="button" to="/app/memories?status=pending">
            Open review queue
          </Link>
        )}
        <div className="modal-actions">
          <button
            className="button secondary"
            disabled={busy || step === 0}
            onClick={() => void save(step - 1)}
          >
            Back
          </button>
          {step < 7 ? (
            <button
              className="button"
              disabled={busy}
              onClick={() => void save(step + 1)}
            >
              {[1, 3, 4, 5].includes(step)
                ? "Continue / skip optional step"
                : "Continue"}
            </button>
          ) : (
            <button
              className="button"
              disabled={busy}
              onClick={() => void save(7, true)}
            >
              Complete onboarding
            </button>
          )}
          <Link to="/app">Resume later from Overview</Link>
        </div>
        {notice && step === 7 && (
          <Link className="button" to="/app">
            Open dashboard
          </Link>
        )}
      </section>
    </>
  );
}
