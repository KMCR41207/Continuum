import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Plus, RefreshCw, KeyRound } from "lucide-react";
import { useWorkspace } from "../../components/AppLayout";
import { useRecords } from "../../lib/useRecords";
import { db } from "../../lib/supabase";
import { errorMessage } from "../../lib/api";
import { Notice, Modal, Empty } from "../../components/ui";
import type { Project, Conversation } from "../../lib/types";

export const providers = [
  "chatgpt",
  "claude",
  "gemini",
  "grok",
  "cursor",
  "codex",
  "antigravity",
  "other",
];
const names: Record<string, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  gemini: "Google Gemini",
  grok: "Grok",
  cursor: "Cursor",
  codex: "Codex",
  antigravity: "Antigravity",
  other: "Other compatible client",
};
type Permissions = {
  capture: boolean;
  retrieval: boolean;
  writing: boolean;
  global_access: boolean;
  all_history: boolean;
  capture_paused: boolean;
  project_ids: string[];
  conversation_ids: string[];
};
type Connection = Permissions & {
  id: string;
  provider: string;
  name: string;
  state: string;
  created_at: string;
  verified_at: string | null;
  last_activity_at: string | null;
  last_sync_at: string | null;
  last_error: string | null;
  expires_at: string;
};
type Event = {
  id: string;
  connection_id: string;
  operation: string;
  success: boolean;
  error_code: string | null;
  created_at: string;
};
const defaults: Permissions = {
  capture: false,
  retrieval: false,
  writing: false,
  global_access: false,
  all_history: false,
  capture_paused: false,
  project_ids: [],
  conversation_ids: [],
};
const date = (value: string | null) =>
  value ? new Date(value).toLocaleString() : "None yet";

export function Connections() {
  const { workspace } = useWorkspace();
  const records = useRecords<Connection>("agent_connections");
  const projects = useRecords<Project>("projects");
  const conversations = useRecords<Conversation>("conversations");
  const events = useRecords<Event>("connection_events");
  const [selected, setSelected] = useState<Connection | "new" | null>(null);
  const [permissions, setPermissions] = useState<Permissions>(defaults);
  const [provider, setProvider] = useState("other");
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [issued, setIssued] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [raw, setRaw] = useState("");
  const [project, setProject] = useState("");
  function open(c: Connection | "new") {
    setSelected(c);
    setPermissions(c === "new" ? { ...defaults } : c);
    setProvider(c === "new" ? "other" : c.provider);
    setName(c === "new" ? "" : c.name);
    setToken("");
    setIssued(false);
    setError("");
    setNotice("");
    setRaw("");
    setProject("");
  }
  async function refresh() {
    await Promise.all([records.reload(), events.reload()]);
  }
  async function save(e?: FormEvent, rotate = false, revoke = false) {
    e?.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const p = Object.fromEntries(
        Object.keys(defaults).map((k) => [
          k,
          permissions[k as keyof Permissions],
        ]),
      );
      const { data, error } = await db().rpc("configure_connection", {
        p_workspace: workspace.id,
        p_id: selected === "new" ? null : selected?.id,
        p_provider: provider,
        p_name: name,
        p_permissions: p,
        p_rotate: rotate,
        p_revoke: revoke,
      });
      if (error) throw error;
      if (data.token) {
        setToken(data.token);
        setIssued(true);
      }
      if (revoke) {
        setToken("");
        setIssued(false);
      }
      await refresh();
      const updated = await db()
        .from("agent_connections")
        .select("*")
        .eq("id", data.id)
        .single();
      if (updated.error) throw updated.error;
      setSelected(updated.data);
      setNotice(
        revoke
          ? "Access revoked. The previous credential can no longer be used."
          : data.token
            ? "Credential created. Copy it now; it cannot be displayed again. Validate it before use."
            : "Permissions saved. They apply to the next request, including connected clients.",
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function request(capture = false) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (!token)
        throw new Error(
          "Enter this connection's token. Use Reconnect to replace a lost token.",
        );
      const checked = await db().rpc("agent_request", {
        p_token: token,
        p_operation: "test_connection",
        p_args: {},
      });
      if (checked.error) throw checked.error;
      if (checked.data.error) throw new Error(checked.data.error);
      if (selected === "new" || checked.data.id !== selected?.id)
        throw new Error("That token belongs to a different connection.");
      if (capture) {
        const result = await db().rpc("agent_request", {
          p_token: token,
          p_operation: "capture_conversation",
          p_args: {
            project_id: project || null,
            conversation: JSON.parse(raw),
          },
        });
        if (result.error) throw result.error;
        if (result.data.error) throw new Error(result.data.error);
        setNotice(
          result.data.duplicate
            ? "Already imported. No duplicate records were created."
            : `Imported successfully. ${result.data.proposals} memory proposals await review in Memories.`,
        );
      } else
        setNotice(
          "Backend credential and permissions verified. This does not verify a provider session or enable automatic capture.",
        );
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
      await events.reload();
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-header">
        <div>
          <span className="eyebrow">INFORMATION IN. CONTEXT OUT.</span>
          <h1>Connections</h1>
          <p>
            Explicit imports and scoped agent access, with independent
            permissions.
          </p>
        </div>
        <button className="button" onClick={() => open("new")}>
          <Plus size={16} />
          New connection
        </button>
      </div>
      <Notice>
        Connection method: scoped token over the Continuum CLI or local MCP
        server. No provider OAuth or automatic chat capture is available.
        Provider names identify your intended source or client; live provider
        compatibility has not been verified.
      </Notice>
      <p>
        <Link className="text-link" to="/app/conversations">
          Import a conversation as a workspace member
        </Link>{" "}
        ·{" "}
        <Link className="text-link" to="/app/memories">
          Review extracted memories
        </Link>
      </p>
      {records.error && (
        <Notice error>
          {records.error} Apply migration 002 to enable connections.
        </Notice>
      )}
      <button
        className="button secondary"
        disabled={records.loading}
        onClick={() => void refresh()}
      >
        <RefreshCw size={14} />
        Refresh activity
      </button>
      {records.loading ? (
        <p role="status">Loading connections…</p>
      ) : records.data.length ? (
        <section className="app-section">
          {records.data.map((c) => (
            <div className="connection-row" key={c.id}>
              <span className="integration-mark" aria-label={names[c.provider]}>
                {names[c.provider].slice(0, 1)}
              </span>
              <div>
                <strong>
                  {c.name} · {names[c.provider]}
                </strong>
                <p>
                  Capture:{" "}
                  {c.capture
                    ? c.capture_paused
                      ? "paused"
                      : "explicit import"
                    : "off"}{" "}
                  · Retrieval: {c.retrieval ? "on" : "off"} · Writing:{" "}
                  {c.writing ? "on" : "off"}
                </p>
                <small>
                  Projects:{" "}
                  {c.project_ids
                    .map(
                      (id) =>
                        projects.data.find((p) => p.id === id)?.name || id,
                    )
                    .join(", ") || "none"}
                  {c.global_access ? " · Global context allowed" : ""}
                  <br />
                  Created {date(c.created_at)} · Last activity{" "}
                  {date(c.last_activity_at)} · Last import{" "}
                  {date(c.last_sync_at)}
                </small>
                {c.last_error && (
                  <p role="status">Action required: {c.last_error}</p>
                )}
              </div>
              <span className="pill">
                {c.state === "revoked"
                  ? "Revoked"
                  : new Date(c.expires_at) < new Date()
                    ? "Expired"
                    : c.state === "verified"
                      ? "Credential verified"
                      : "Awaiting validation"}
              </span>
              <button className="button secondary" onClick={() => open(c)}>
                Manage
              </button>
            </div>
          ))}
        </section>
      ) : (
        <Empty title="Connect context deliberately.">
          Create a scoped credential, select projects and permissions, then
          validate it from the CLI or an MCP client.
        </Empty>
      )}
      {selected && (
        <Modal
          title={
            selected === "new" ? "Create connection" : `Manage ${selected.name}`
          }
          onClose={() => {
            setSelected(null);
            setToken("");
            setRaw("");
          }}
        >
          <div className="modal-body">
            {error && <Notice error>{error}</Notice>}
            {notice && <Notice>{notice}</Notice>}
            <form onSubmit={(e) => void save(e)}>
              <label>
                Provider
                <select
                  value={provider}
                  disabled={selected !== "new"}
                  onChange={(e) => setProvider(e.target.value)}
                >
                  {providers.map((p) => (
                    <option key={p} value={p}>
                      {names[p]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Connection name
                <input
                  required
                  maxLength={100}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <fieldset>
                <legend>Independent permissions</legend>
                {(
                  [
                    [
                      "capture",
                      "Conversation capture — explicit authorized imports only",
                    ],
                    [
                      "retrieval",
                      "Memory retrieval — approved memories and permitted history",
                    ],
                    [
                      "writing",
                      "Memory writing — proposals and reviewed corrections",
                    ],
                    ["capture_paused", "Pause capture"],
                    ["global_access", "Allow global context outside projects"],
                    [
                      "all_history",
                      "Allow all conversations within the selected scope",
                    ],
                  ] as const
                ).map(([key, label]) => (
                  <label className="permission-check" key={key}>
                    <input
                      type="checkbox"
                      checked={permissions[key]}
                      onChange={(e) =>
                        setPermissions({
                          ...permissions,
                          [key]: e.target.checked,
                        })
                      }
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
              <fieldset>
                <legend>Project access</legend>
                {projects.data.map((p) => (
                  <label className="permission-check" key={p.id}>
                    <input
                      type="checkbox"
                      checked={permissions.project_ids.includes(p.id)}
                      onChange={(e) =>
                        setPermissions({
                          ...permissions,
                          project_ids: e.target.checked
                            ? [...permissions.project_ids, p.id]
                            : permissions.project_ids.filter(
                                (id) => id !== p.id,
                              ),
                        })
                      }
                    />
                    {p.name}
                  </label>
                ))}
                {!projects.data.length && (
                  <p>Create a project to grant project access.</p>
                )}
              </fieldset>
              {!permissions.all_history && (
                <fieldset>
                  <legend>Allowed conversation history</legend>
                  <p>
                    Source-linked memories also require access to their source
                    conversations.
                  </p>
                  {conversations.data.map((c) => (
                    <label className="permission-check" key={c.id}>
                      <input
                        type="checkbox"
                        checked={permissions.conversation_ids.includes(c.id)}
                        onChange={(e) =>
                          setPermissions({
                            ...permissions,
                            conversation_ids: e.target.checked
                              ? [...permissions.conversation_ids, c.id]
                              : permissions.conversation_ids.filter(
                                  (id) => id !== c.id,
                                ),
                          })
                        }
                      />
                      {c.title} · {c.platform}
                    </label>
                  ))}
                </fieldset>
              )}
              {selected === "new" && (
                <label className="permission-check">
                  <input type="checkbox" required />I authorize the selected
                  capabilities and scopes for this connection.
                </label>
              )}
              <button className="button" disabled={busy}>
                {selected === "new"
                  ? "Create scoped credential"
                  : "Save permissions"}
              </button>
            </form>
            {selected !== "new" && (
              <>
                <hr />
                <h3>
                  <KeyRound size={16} /> Credential and validation
                </h3>
                <p>
                  Expires {date(selected.expires_at)}. Tokens stay in this
                  dialog only; closing it clears the token. Use a secret manager
                  when configuring a client.
                </p>
                <label>
                  {issued ? "New token — copy now" : "Connection token"}
                  <input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={token}
                    onChange={(e) => {
                      setToken(e.target.value);
                      setIssued(false);
                    }}
                  />
                </label>
                {issued && (
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(token);
                        setNotice("Token copied. Keep it private.");
                      } catch {
                        setError(
                          "Clipboard unavailable. Select and copy the token field.",
                        );
                      }
                    }}
                  >
                    Copy token
                  </button>
                )}
                <div className="modal-actions">
                  <button
                    className="button secondary"
                    disabled={busy || !token}
                    onClick={() => void request()}
                  >
                    Test connection
                  </button>
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Replace this credential? All existing clients using it will lose access.",
                        )
                      )
                        void save(undefined, true);
                    }}
                  >
                    Reconnect / rotate token
                  </button>
                  <button
                    className="button danger"
                    disabled={busy || selected.state === "revoked"}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Disconnect and revoke this connection immediately?",
                        )
                      )
                        void save(undefined, false, true);
                    }}
                  >
                    Disconnect and revoke
                  </button>
                </div>
                {permissions.capture && (
                  <>
                    <hr />
                    <h3>Import through this connection</h3>
                    <p>
                      Paste an authorized conversation in normalized JSON:
                      title, platform, and messages with role and content.
                      Optional metadata objects retain timestamps, source IDs
                      and attachment descriptions. Save permission changes
                      before importing. Failed input stays here for retry.
                    </p>
                    <label>
                      Import project
                      <select
                        value={project}
                        onChange={(e) => setProject(e.target.value)}
                      >
                        <option value="">Global context</option>
                        {projects.data
                          .filter((p) => permissions.project_ids.includes(p.id))
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      Conversation JSON
                      <textarea
                        rows={7}
                        value={raw}
                        onChange={(e) => setRaw(e.target.value)}
                        maxLength={2000000}
                      />
                    </label>
                    <button
                      className="button"
                      disabled={
                        busy || !token || !raw || permissions.capture_paused
                      }
                      onClick={() => void request(true)}
                    >
                      Import / retry
                    </button>
                  </>
                )}
                <hr />
                <h3>Client setup</h3>
                <p>
                  From the repository, use Node 22.18+ and set
                  CONTINUUM_SUPABASE_URL, CONTINUUM_SUPABASE_KEY (publishable
                  key), and CONTINUUM_TOKEN in your client environment.
                </p>
                <pre>
                  node server/cli.ts diagnostics{"\n"}node server/mcp.ts
                </pre>
                <p>
                  Configure the MCP command as <code>node</code> with the
                  absolute path to <code>server/mcp.ts</code> as its argument.
                  The server validates its credential before starting. Capture
                  requires an explicit import call.
                </p>
                <h3>Recent connection activity</h3>
                {events.error && <Notice error>{events.error}</Notice>}
                <ul>
                  {events.data
                    .filter((e) => e.connection_id === selected.id)
                    .slice(0, 20)
                    .map((e) => (
                      <li key={e.id}>
                        {date(e.created_at)} · {e.operation} ·{" "}
                        {e.success ? "Succeeded" : `Failed: ${e.error_code}`}
                      </li>
                    ))}
                </ul>
              </>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
