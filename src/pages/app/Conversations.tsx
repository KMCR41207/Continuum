import { useState, useEffect } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { Plus, Search } from "lucide-react";
import { useRecords } from "../../lib/useRecords";
import { useWorkspace } from "../../components/AppLayout";
import { Empty, Modal, Notice } from "../../components/ui";
import { db } from "../../lib/supabase";
import { importConversation, errorMessage, remove } from "../../lib/api";
import type { Conversation, Project } from "../../lib/types";
export function Conversations() {
  const records = useRecords<Conversation>("conversations");
  const projects = useRecords<Project>("projects");
  const { workspace } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [importing, setImporting] = useState(false);
  const [raw, setRaw] = useState("");
  const [project, setProject] = useState("");
  const [queued, setQueued] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const selected = records.data.find((c) => c.id === params.get("open"));
  const shown = records.data.filter((c) =>
    (c.title + " " + c.platform).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <div className="page-header">
        <div>
          <span className="eyebrow">THE ORIGINAL THINKING</span>
          <h1>Conversations</h1>
          <p>Your source archive. Every memory starts somewhere.</p>
        </div>
        <button
          className="button"
          onClick={() => {
            setImporting(true);
            setError("");
          }}
        >
          <Plus size={16} />
          Import conversation
        </button>
      </div>
      {notice && <Notice>{notice}</Notice>}
      {records.error && <Notice error>{records.error}</Notice>}
      <div className="filter-bar">
        <label className="search-field">
          <Search size={16} />
          <input
            aria-label="Search conversations"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search titles or platforms"
          />
        </label>
        <span className="small-text">{shown.length} conversations</span>
      </div>
      {records.loading ? (
        <p role="status">Loading conversations…</p>
      ) : shown.length ? (
        <div className="conversation-list">
          {shown.map((c) => (
            <button key={c.id} onClick={() => setParams({ open: c.id })}>
              <span className="conversation-platform">
                {c.platform.slice(0, 2)}
              </span>
              <div>
                <h2>{c.title}</h2>
                <p>
                  {c.platform} · {c.message_count} messages ·{" "}
                  {new Date(c.created_at).toLocaleDateString()}
                </p>
              </div>
              <span className="pill">
                {c.excluded
                  ? "Excluded"
                  : c.processing_status === "review"
                    ? "Proposals generated"
                    : c.processing_status}
              </span>
              <span>↗</span>
            </button>
          ))}
        </div>
      ) : (
        <Empty
          title="Give your context a source."
          action={
            <button
              className="button secondary"
              onClick={() => setImporting(true)}
            >
              Import your first conversation
            </button>
          }
        >
          Start with a conversation containing a useful decision, preference, or
          project detail.
        </Empty>
      )}
      {selected && (
        <ConversationDetail
          conversation={selected}
          onClose={() => setParams({})}
          reload={records.reload}
        />
      )}{" "}
      {importing && (
        <Modal
          title="Import a conversation"
          onClose={() => setImporting(false)}
        >
          <form
            className="modal-body"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                if (queued) {
                  const input = JSON.parse(raw);
                  const job = await db().rpc("enqueue_import", {
                    p_workspace: workspace.id,
                    p_project: project || null,
                    p_input: input,
                  });
                  if (job.error) throw job.error;
                  setNotice(
                    "Import queued. A running worker will process it; inspect Processing jobs for status and retry.",
                  );
                  setImporting(false);
                  setRaw("");
                  return;
                }
                const result = await importConversation(
                  workspace.id,
                  project || null,
                  raw,
                );
                setNotice(
                  result.duplicate
                    ? "This exact conversation is already in your workspace."
                    : `Conversation saved with ${result.proposals} new memory proposals. Review them in Memories.`,
                );
                setImporting(false);
                setRaw("");
                await records.reload();
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            <p>
              Paste a normalized conversation. Original messages are saved;
              direct durable statements become proposals for your review.
            </p>
            {error && <Notice error>{error}</Notice>}
            <label>
              Project
              <select
                value={project}
                onChange={(e) => setProject(e.target.value)}
              >
                <option value="">Workspace-wide</option>
                {projects.data.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Conversation JSON
              <textarea
                required
                rows={10}
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                maxLength={2000000}
                placeholder={
                  '{"title":"Database decision","platform":"ChatGPT","messages":[{"role":"user","content":"We decided to use PostgreSQL."}]}'
                }
              />
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={queued}
                onChange={(e) => setQueued(e.target.checked)}
              />
              Queue for background processing (requires a running worker)
            </label>
            <label className="checkbox">
              <input type="checkbox" required />I have permission to store and
              process this conversation.
            </label>
            <p className="small-text">
              Every candidate requires approval. This initial extractor uses
              conservative rules, not an external AI model.{" "}
              <Link to="/docs#import">See the format</Link>.
            </p>
            <button className="button" disabled={busy}>
              {busy ? "Importing…" : "Import and propose memories"}
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
function ConversationDetail({
  conversation: c,
  onClose,
  reload,
}: {
  conversation: Conversation;
  onClose: () => void;
  reload: () => Promise<void>;
}) {
  const [messages, setMessages] = useState<
    {
      id: string;
      role: string;
      content: string;
      source_metadata: Record<string, unknown>;
    }[]
  >([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [linked, setLinked] = useState<
    { memory_id: string; evidence: string }[]
  >([]);
  useEffect(() => {
    void db()
      .from("memory_sources")
      .select("memory_id,evidence")
      .eq("conversation_id", c.id)
      .then((r) => {
        if (r.error) setError(r.error.message);
        else setLinked(r.data);
      });
    db()
      .from("messages")
      .select("id,role,content,source_metadata")
      .eq("conversation_id", c.id)
      .order("position")
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setMessages(data);
        setLoading(false);
      });
  }, [c.id]);
  return (
    <Modal title={c.title} onClose={onClose}>
      <div className="modal-body">
        <p className="small-text">
          {c.platform} · {new Date(c.created_at).toLocaleString()}
        </p>
        {error && <Notice error>{error}</Notice>}
        {c.source_metadata && Object.keys(c.source_metadata).length > 0 && (
          <details>
            <summary>Original source metadata</summary>
            <pre>{JSON.stringify(c.source_metadata, null, 2)}</pre>
          </details>
        )}
        {loading ? (
          <p role="status">Loading source messages…</p>
        ) : (
          messages.map((m) => (
            <article className={`source-message ${m.role}`} key={m.id}>
              <span className="eyebrow">{m.role}</span>
              <p>{m.content}</p>
              {m.source_metadata &&
                Object.keys(m.source_metadata).length > 0 && (
                  <details>
                    <summary>Message and attachment metadata</summary>
                    <pre>{JSON.stringify(m.source_metadata, null, 2)}</pre>
                  </details>
                )}
            </article>
          ))
        )}
        <div className="modal-actions">
          {linked.length > 0 && (
            <section>
              <h3>Source-linked memories</h3>
              {linked.map((s) => (
                <p key={s.memory_id}>{s.evidence}</p>
              ))}
              <Link to="/app/memories?status=all">
                Review linked context in Memories
              </Link>
            </section>
          )}
          <button
            className="button secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const { error } = await db()
                .from("conversations")
                .update({ excluded: !c.excluded })
                .eq("id", c.id);
              if (error) setError(error.message);
              else {
                await reload();
                onClose();
              }
              setBusy(false);
            }}
          >
            {c.excluded ? "Allow agent access" : "Exclude from agent access"}
          </button>
          <button
            className="button danger"
            disabled={busy}
            onClick={async () => {
              if (
                !window.confirm(
                  "Delete this conversation and ALL memories derived from it, including their version histories? This cannot be undone.",
                )
              )
                return;
              setBusy(true);
              try {
                await remove("conversations", c.id);
                await reload();
                onClose();
              } catch (e) {
                setError(errorMessage(e));
                setBusy(false);
              }
            }}
          >
            Delete conversation
          </button>
        </div>
        <p className="small-text">
          Excluding a conversation blocks agent retrieval of its messages and
          derived memories. It does not delete your workspace records.
        </p>
      </div>
    </Modal>
  );
}
