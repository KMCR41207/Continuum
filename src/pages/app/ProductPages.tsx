import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useWorkspace } from "../../components/AppLayout";
import { useAuth } from "../../lib/AuthContext";
import { Notice, Empty } from "../../components/ui";
import { db } from "../../lib/supabase";
import { errorMessage, exportWorkspace, exportAccount } from "../../lib/api";
import { useRpc, productApi, type Usage } from "../../lib/product";
import { selfHosted, localRequest } from "../../lib/localBackend";
function Heading({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <span className="eyebrow">CONTINUUM / YOUR WORKSPACE</span>
        <h1>{title}</h1>
        <p>{children}</p>
      </div>
    </div>
  );
}
export function UsagePage() {
  const { workspace } = useWorkspace();
  const r = useRpc<Usage>("workspace_usage", { p_workspace: workspace.id });
  return (
    <>
      <Heading title="Usage">
        Actual records and operational limits for this workspace.
      </Heading>
      {r.error && <Notice error>{r.error}</Notice>}
      {r.loading ? (
        <p role="status">Loading usage…</p>
      ) : (
        r.data && (
          <>
            <p>
              Plan: {r.data.plan} · Billing: {r.data.billing_status}
            </p>
            <div className="stats-row">
              {(
                [
                  "memories",
                  "conversations",
                  "projects",
                  "connections",
                ] as const
              ).map((k) => (
                <div className="app-section" key={k}>
                  <h2>{k}</h2>
                  <strong>{r.data![k].toLocaleString()}</strong>
                  <p>
                    {r.data!.limits[k] === undefined
                      ? "Limit not configured"
                      : `Operational limit: ${r.data!.limits[k].toLocaleString()}`}
                  </p>
                </div>
              ))}
            </div>
            <section className="app-section">
              <p>
                Stored message and memory text:{" "}
                {r.data.stored_text_bytes.toLocaleString()} UTF-8 bytes
                (excludes database/index overhead and metadata).
              </p>
              <p>
                Agent RPC requests in the last 30 days: {r.data.requests_30d}.
                This includes MCP calls and credential checks; it is not a
                billable-usage claim.
              </p>
              <p>
                Background jobs: {r.data.jobs}. Last successful queued import:{" "}
                {r.data.last_successful_sync
                  ? new Date(r.data.last_successful_sync).toLocaleString()
                  : "None yet"}
                .
              </p>
              <Link to="/app/jobs">Inspect jobs</Link> ·{" "}
              <Link to="/app/billing">Manage billing</Link>
            </section>
          </>
        )
      )}
      <button className="button secondary" onClick={() => void r.reload()}>
        Refresh usage
      </button>
    </>
  );
}
export function BillingPage() {
  const { workspace } = useWorkspace();
  const { session } = useAuth();
  const r = useRpc<Usage>("workspace_usage", { p_workspace: workspace.id });
  const [plans, setPlans] = useState<
    {
      id: string;
      name: string;
      enabled: boolean;
      stripe_price_id: string | null;
    }[]
  >([]);
  const [subscription, setSubscription] = useState<any>(null);
  const [available, setAvailable] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void db()
      .from("plan_catalog")
      .select("id,name,enabled,stripe_price_id")
      .then((x) => {
        if (x.error) setError(x.error.message);
        else setPlans(x.data);
      });
    void db()
      .from("workspace_billing")
      .select("*")
      .eq("workspace_id", workspace.id)
      .maybeSingle()
      .then((x) => {
        if (x.error) setError(x.error.message);
        else setSubscription(x.data);
      });
    void productApi("/api/config")
      .then((x) => setAvailable(x.billing))
      .catch((e) => setError(errorMessage(e)));
  }, [workspace.id]);
  async function launch(path: string, plan?: string) {
    setBusy(true);
    setError("");
    try {
      const x = await productApi(path, {
        workspace_id: workspace.id,
        plan_id: plan,
      });
      const u = new URL(x.url);
      if (
        u.protocol !== "https:" ||
        !["checkout.stripe.com", "billing.stripe.com"].includes(u.hostname)
      )
        throw new Error("Unexpected billing URL");
      window.location.assign(u.href);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }
  return (
    <>
      <Heading title="Billing">
        Subscription changes take effect after verified Stripe events.
      </Heading>
      {error && <Notice error>{error}</Notice>}
      {r.error && <Notice error>{r.error}</Notice>}
      {!available && (
        <Notice>
          Billing needs server configuration, approved Stripe prices, and a
          verified webhook endpoint. No payment or subscription is simulated.
        </Notice>
      )}
      <section className="app-section">
        <h2>{r.data?.plan || "Loading plan…"}</h2>
        <p>Status: {r.data?.billing_status || "Loading…"}</p>
        {subscription?.cancel_at_period_end && (
          <p>
            Cancellation is scheduled at the end of the current billing period.
          </p>
        )}
        {subscription?.current_period_end && (
          <p>
            Current period ends{" "}
            {new Date(subscription.current_period_end).toLocaleString()}.
          </p>
        )}
        <p>
          Returning from checkout is not proof of payment. Refresh to load
          verified billing state.
        </p>
        <button className="button secondary" onClick={() => void r.reload()}>
          Refresh subscription
        </button>
        {available && subscription?.customer_id && (
          <button
            className="button"
            disabled={busy || workspace.owner_id !== session?.user.id}
            onClick={() => void launch("/api/billing/portal")}
          >
            Payment methods, invoices, change plan or cancel
          </button>
        )}
      </section>
      <div className="pricing-grid">
        {plans.map((p) => (
          <section className="app-section" key={p.id}>
            <h2>{p.name}</h2>
            <p>
              {p.stripe_price_id && p.enabled
                ? "Configured price shown securely at Stripe checkout."
                : "Commercial price and entitlements not configured."}
            </p>
            {p.enabled && p.stripe_price_id && available ? (
              <button
                className="button"
                disabled={busy || workspace.owner_id !== session?.user.id}
                onClick={() => void launch("/api/billing/checkout", p.id)}
              >
                Continue to {p.name} checkout
              </button>
            ) : (
              <Link to="/app/usage">View current usage</Link>
            )}
          </section>
        ))}
      </div>
    </>
  );
}
export function TeamPage() {
  const { workspace } = useWorkspace();
  const { session } = useAuth();
  const owner = workspace.owner_id === session?.user.id;
  const r = useRpc<{ user_id: string; email: string; role: string }[]>(
    "list_members",
    { p_workspace: workspace.id },
  );
  const [invites, setInvites] = useState<any[]>([]),
    [error, setError] = useState(""),
    [link, setLink] = useState(""),
    [busy, setBusy] = useState(false);
  async function refresh() {
    await r.reload();
    if (owner) {
      const q = await db()
        .from("workspace_invitations")
        .select("id,email,role,expires_at,accepted_at,revoked_at")
        .eq("workspace_id", workspace.id);
      if (q.error) setError(q.error.message);
      else setInvites(q.data);
    }
  }
  useEffect(() => {
    void refresh();
  }, [workspace.id, owner]);
  async function act(action: string, id: string, role: string | null = null) {
    if (
      (action === "remove" || action === "transfer") &&
      !window.confirm(
        action === "transfer"
          ? "Transfer ownership? Existing agent credentials will be revoked and you will become an editor."
          : "Remove this workspace member?",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      const q = await db().rpc("manage_member", {
        p_workspace: workspace.id,
        p_action: action,
        p_id: id,
        p_role: role,
      });
      if (q.error) throw q.error;
      await refresh();
      if (action === "transfer") window.location.reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading title="Workspace team">
        Members, verified-email invitations and explicit roles.
      </Heading>
      {(error || r.error) && <Notice error>{error || r.error}</Notice>}
      {r.loading ? (
        <p>Loading members…</p>
      ) : (
        <section className="app-section">
          {r.data?.map((m) => (
            <div className="connection-row" key={m.user_id}>
              <div>
                <strong>{m.email}</strong>
                <p>{m.role}</p>
              </div>
              {owner && m.role !== "owner" && (
                <>
                  <select
                    aria-label={`Role for ${m.email}`}
                    disabled={busy}
                    value={m.role}
                    onChange={(e) =>
                      void act("role", m.user_id, e.target.value)
                    }
                  >
                    <option value="editor">Editor</option>
                    <option value="viewer">Viewer</option>
                  </select>
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => void act("transfer", m.user_id)}
                  >
                    Transfer ownership
                  </button>
                  <button
                    className="button danger"
                    disabled={busy}
                    onClick={() => void act("remove", m.user_id)}
                  >
                    Remove
                  </button>
                </>
              )}
            </div>
          ))}
        </section>
      )}
      {owner && (
        <section className="app-section">
          <h2>Invite a teammate</h2>
          <p>
            Invitations expire after seven days and can only be accepted by the
            matching verified email. Copy the link and share it yourself;
            Continuum does not claim an email was sent.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              const f = new FormData(e.currentTarget);
              try {
                const q = await db().rpc("invite_member", {
                  p_workspace: workspace.id,
                  p_email: f.get("email"),
                  p_role: f.get("role"),
                });
                if (q.error) throw q.error;
                setLink(`${location.origin}/invite#token=${q.data.token}`);
                await refresh();
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Email
              <input name="email" type="email" required />
            </label>
            <label>
              Role
              <select name="role">
                <option value="viewer">Viewer — read only</option>
                <option value="editor">
                  Editor — manage workspace content
                </option>
              </select>
            </label>
            <button className="button" disabled={busy}>
              Create invitation link
            </button>
          </form>
          {link && (
            <label>
              Invitation link — copy now
              <input readOnly value={link} onFocus={(e) => e.target.select()} />
            </label>
          )}
          <h3>Invitations</h3>
          {invites.map((i) => (
            <div className="connection-row" key={i.id}>
              <p>
                {i.email} · {i.role} ·{" "}
                {i.accepted_at
                  ? "Accepted"
                  : i.revoked_at
                    ? "Revoked"
                    : new Date(i.expires_at) < new Date()
                      ? "Expired"
                      : `Expires ${new Date(i.expires_at).toLocaleString()}`}
              </p>
              {!i.accepted_at && !i.revoked_at && (
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void act("revoke_invite", i.id)}
                >
                  Revoke invitation
                </button>
              )}
            </div>
          ))}
        </section>
      )}
    </>
  );
}
export function InvitePage() {
  const { session, loading } = useAuth();
  const [token] = useState(
    () => new URLSearchParams(location.hash.slice(1)).get("token") || "",
  );
  const [error, setError] = useState(""),
    [done, setDone] = useState(false),
    [busy, setBusy] = useState(false);
  return (
    <div className="content inner-page">
      <h1>Join a Continuum workspace</h1>
      {error && <Notice error>{error}</Notice>}
      {done ? (
        <>
          <p>Invitation accepted.</p>
          <Link className="button" to="/app">
            Open workspace
          </Link>
        </>
      ) : loading ? (
        <p>Restoring session…</p>
      ) : !session ? (
        <>
          <p>
            Sign in with the invited email, then reopen this invitation link.
          </p>
          <Link className="button" to="/signin">
            Sign in
          </Link>
        </>
      ) : (
        <>
          <p>Accept using {session.user.email}. Your email must be verified.</p>
          <button
            className="button"
            disabled={!token || busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              const r = await db().rpc("accept_invitation", { p_token: token });
              if (r.error) setError(r.error.message);
              else {
                history.replaceState(null, "", "/invite");
                setDone(true);
              }
              setBusy(false);
            }}
          >
            Accept invitation
          </button>
        </>
      )}
    </div>
  );
}
export function JobsPage() {
  const { workspace } = useWorkspace();
  const [jobs, setJobs] = useState<any[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function reload() {
    const r = await db()
      .from("sync_jobs")
      .select(
        "id,kind,status,attempts,max_attempts,available_at,last_error,updated_at",
      )
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (r.error) setError(r.error.message);
    else setJobs(r.data);
  }
  useEffect(() => {
    void reload();
  }, [workspace.id]);
  async function control(id: string, action: string) {
    setBusy(true);
    setError("");
    const r = await db().rpc("control_job", { p_id: id, p_action: action });
    if (r.error) setError(r.error.message);
    await reload();
    setBusy(false);
  }
  return (
    <>
      <Heading title="Processing jobs">
        Durable imports and opted-in embeddings, with retries and visible
        failures.
      </Heading>
      {error && <Notice error>{error}</Notice>}
      <Notice>
        A configured worker must be running to process queued jobs. No automatic
        provider feed is implied.
      </Notice>
      <button className="button secondary" onClick={() => void reload()}>
        Refresh jobs
      </button>
      {jobs.length ? (
        jobs.map((j) => (
          <section className="app-section" key={j.id}>
            <h2>
              {j.kind} · {j.status}
            </h2>
            <p>
              Attempt {j.attempts}/{j.max_attempts} · Next eligible run{" "}
              {new Date(j.available_at).toLocaleString()}
            </p>
            {j.last_error && <Notice error>{j.last_error}</Notice>}
            {["queued", "running"].includes(j.status) && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void control(j.id, "pause")}
              >
                Pause
              </button>
            )}
            {["paused", "failed"].includes(j.status) && (
              <button
                className="button"
                disabled={busy}
                onClick={() =>
                  void control(j.id, j.status === "failed" ? "retry" : "resume")
                }
              >
                {j.status === "failed" ? "Retry" : "Resume"}
              </button>
            )}
          </section>
        ))
      ) : (
        <Empty title="No processing jobs yet.">
          Queue an authorized import from Conversations or opt into semantic
          indexing in Security and data.
        </Empty>
      )}
    </>
  );
}
export function SecurityPage() {
  const [semantic, setSemantic] = useState<{
    available: boolean;
    model: string;
    endpoint: string;
  }>({ available: false, model: "", endpoint: "" });
  const { workspace, reload } = useWorkspace();
  const { session } = useAuth();
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [available, setAvailable] = useState(false);
  const workers = useRpc<
    {
      worker_id: string;
      state: "healthy" | "degraded" | "stopped" | "stale";
      last_seen_at: string;
      last_success_at: string | null;
      last_error: string | null;
    }[]
  >("worker_health", {});
  useEffect(() => {
    void productApi("/api/config")
      .then((x) => {
        setAvailable(x.accountDeletion);
        setSemantic({
          available: x.semantic,
          model: x.embeddingModel || "",
          endpoint: x.embeddingEndpoint || "",
        });
      })
      .catch(() => setAvailable(false));
  }, []);
  async function change(
    e: React.FormEvent<HTMLFormElement>,
    kind: "email" | "password",
  ) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    const f = new FormData(e.currentTarget);
    try {
      if (selfHosted) {
        await localRequest(
          "/api/v1/auth/user",
          {
            current_password: String(f.get("current")),
            [kind]: String(f.get("value")),
          },
          "PATCH",
        );
        setNotice(`${kind} updated locally.`);
        return;
      }
      const auth = await db().auth.signInWithPassword({
        email: session!.user.email!,
        password: String(f.get("current")),
      });
      if (auth.error) throw auth.error;
      const r = await db().auth.updateUser(
        kind === "email"
          ? { email: String(f.get("value")) }
          : { password: String(f.get("value")) },
      );
      if (r.error) throw r.error;
      setNotice(
        kind === "email"
          ? "Check the confirmation email(s). Your address changes only after verification."
          : "Password updated.",
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading title="Security and data">
        Your account, processing consent and deletion controls.
      </Heading>
      {error && <Notice error>{error}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      <section className="app-section">
        <p>
          Signed in as {session?.user.email}. Current access token expires{" "}
          {session?.expires_at
            ? new Date(session.expires_at * 1000).toLocaleString()
            : "unknown"}
          ; Supabase refreshes it while your session is valid.
        </p>
        <Link to="/app/connections">Manage scoped agent credentials</Link>
        <button
          className="button secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const r = await db().auth.signOut({ scope: "global" });
            if (r.error) setError(r.error.message);
            setBusy(false);
          }}
        >
          Sign out all sessions
        </button>
      </section>
      {(["email", "password"] as const).map((kind) => (
        <section className="app-section" key={kind}>
          <h2>Change {kind}</h2>
          <form onSubmit={(e) => void change(e, kind)}>
            <label>
              Current password
              <input
                name="current"
                type="password"
                required
                autoComplete="current-password"
              />
            </label>
            <label>
              New {kind}
              <input
                name="value"
                type={kind === "email" ? "email" : "password"}
                minLength={kind === "password" ? 12 : 3}
                maxLength={kind === "password" ? 128 : 254}
                required
                autoComplete={kind === "email" ? "email" : "new-password"}
              />
            </label>
            <button className="button" disabled={busy}>
              Verify and update {kind}
            </button>
          </form>
        </section>
      ))}
      <section className="app-section">
        <h2>Semantic processing consent</h2>
        {semantic.available ? (
          <p>
            Configured provider endpoint: {semantic.endpoint} · Model:{" "}
            {semantic.model}
          </p>
        ) : (
          <Notice>
            Semantic processing requires a configured embedding provider and
            application server. Full-text search remains available.
          </Notice>
        )}
        <p>
          Opting in permits approved, non-sensitive memory text to be sent to
          the operator-configured embedding provider. Review that provider and
          its retention terms with your workspace owner first. Full-text search
          works without this.
        </p>
        <button
          className="button secondary"
          disabled={
            busy ||
            workspace.owner_id !== session?.user.id ||
            (!semantic.available && !workspace.preferences.semantic_enabled)
          }
          onClick={async () => {
            if (
              !workspace.preferences.semantic_enabled &&
              !window.confirm(
                "Authorize sending approved non-sensitive memory text to the configured embedding provider?",
              )
            )
              return;
            setBusy(true);
            const r = await db().rpc("configure_semantic", {
              p_workspace: workspace.id,
              p_enabled: !workspace.preferences.semantic_enabled,
            });
            if (r.error) setError(r.error.message);
            else {
              await reload();
              setNotice(
                "Processing consent updated. Inspect Jobs for indexing progress.",
              );
            }
            setBusy(false);
          }}
        >
          {workspace.preferences.semantic_enabled
            ? "Disable semantic processing and delete embeddings"
            : "Authorize semantic processing"}
        </button>
        <button
          className="button secondary"
          disabled={
            busy ||
            !semantic.available ||
            !workspace.preferences.semantic_enabled ||
            workspace.owner_id !== session?.user.id
          }
          onClick={async () => {
            if (
              !window.confirm(
                "Delete existing semantic vectors and queue eligible approved memories for reindexing?",
              )
            )
              return;
            setBusy(true);
            setError("");
            const r = await db().rpc("reindex_semantic", {
              p_workspace: workspace.id,
            });
            if (r.error) setError(r.error.message);
            else
              setNotice(
                `${r.data} eligible memory embeddings queued for reindexing.`,
              );
            setBusy(false);
          }}
        >
          Reindex approved memories
        </button>
      </section>
      {selfHosted && (
        <section className="app-section">
          <h2>Conversation compaction</h2>
          <p>
            Conversations older than the configured 14-day threshold can be
            summarized by your configured model. Summaries remain review
            candidates. Raw messages are retained unless you explicitly select
            redaction and enable it on the server. Provider processing follows
            the server configuration; remote models require operator opt-in.
          </p>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setError("");
              const data = new FormData(event.currentTarget);
              try {
                const response = await db()
                  .from("workspaces")
                  .update({
                    preferences: {
                      ...workspace.preferences,
                      compaction_enabled: data.get("enabled") === "on",
                      raw_retention_policy: data.get("policy"),
                    },
                  })
                  .eq("id", workspace.id);
                if (response.error) throw response.error;
                await reload();
                setNotice(
                  "Compaction policy saved. Existing raw messages have not been deleted.",
                );
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={Boolean(
                  (workspace.preferences as Record<string, unknown>)
                    .compaction_enabled,
                )}
              />
              Authorize conversation compaction
            </label>
            <label>
              Raw message policy
              <select
                name="policy"
                defaultValue={String(
                  (workspace.preferences as Record<string, unknown>)
                    .raw_retention_policy || "retain",
                )}
              >
                <option value="retain">Retain original messages</option>
                <option value="redact_after_verified_compaction">
                  Redact only after verified summary persistence
                </option>
              </select>
            </label>
            <button
              className="button secondary"
              disabled={busy || workspace.owner_id !== session?.user.id}
            >
              Save compaction policy
            </button>
          </form>
        </section>
      )}
      <section className="app-section">
        <h2>Worker health</h2>
        {workers.loading ? (
          <p role="status">Checking worker health…</p>
        ) : workers.data?.length ? (
          workers.data.map((worker) => (
            <p key={worker.worker_id}>
              {worker.worker_id}: {worker.state} · last seen{" "}
              {new Date(worker.last_seen_at).toLocaleString()}
              {worker.last_error ? ` · ${worker.last_error}` : ""}
            </p>
          ))
        ) : (
          <p>
            No worker heartbeat has been recorded. Run the worker after
            configuring server-only Supabase credentials.
          </p>
        )}
        <button
          className="button secondary"
          onClick={() => void workers.reload()}
        >
          Refresh worker health
        </button>
      </section>
      <section className="app-section">
        <h2>Export workspace data</h2>
        <button
          className="button secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await exportWorkspace(workspace.id);
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Download complete workspace snapshot
        </button>
        <button
          className="button secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await exportAccount();
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Export account and accessible workspaces
        </button>
      </section>
      <section className="app-section">
        <h2>Operational history retention</h2>
        <p>
          Remove completed or failed jobs and connection events older than 90
          days. Captured conversations and memories remain under their
          individual deletion controls. Audit records are retained.
        </p>
        <button
          className="button secondary"
          disabled={busy || workspace.owner_id !== session?.user.id}
          onClick={async () => {
            if (
              !window.confirm("Delete operational history older than 90 days?")
            )
              return;
            setBusy(true);
            setError("");
            const r = await db().rpc("prune_operational_history", {
              p_workspace: workspace.id,
              p_before: new Date(Date.now() - 90 * 86400000).toISOString(),
            });
            if (r.error) setError(r.error.message);
            else setNotice("Old operational history removed.");
            setBusy(false);
          }}
        >
          Prune old operational history
        </button>
      </section>
      <section className="app-section">
        <h2>Delete account</h2>
        <p>
          This permanently deletes your account and solely-owned workspaces,
          sources, derived memories, versions and credentials. Transfer shared
          workspace ownership and cancel subscriptions first. Memberships in
          other workspaces are removed; their shared content remains. Password
          reauthentication is required. OAuth-only users must first establish a
          password through recovery.
        </p>
        {!available ? (
          <Notice>
            Account deletion requires the configured application server. No
            deletion has been performed.
          </Notice>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                !window.confirm(
                  "Permanently delete this account and all solely-owned workspace data?",
                )
              )
                return;
              setBusy(true);
              setError("");
              const f = new FormData(e.currentTarget);
              try {
                await productApi("/api/account/delete", {
                  password: f.get("password"),
                  confirmation: f.get("confirmation"),
                });
                await db().auth.signOut({ scope: "local" });
                location.assign("/");
              } catch (e) {
                setError(errorMessage(e));
                setBusy(false);
              }
            }}
          >
            <label>
              Current password
              <input
                name="password"
                type="password"
                required
                autoComplete="current-password"
              />
            </label>
            <label>
              Type DELETE CONTINUUM ACCOUNT
              <input
                name="confirmation"
                required
                pattern="DELETE CONTINUUM ACCOUNT"
              />
            </label>
            <button className="button danger" disabled={busy}>
              Permanently delete account
            </button>
          </form>
        )}
      </section>
    </>
  );
}
