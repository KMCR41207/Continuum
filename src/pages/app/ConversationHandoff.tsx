import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useWorkspace } from "../../components/AppLayout";
import { db } from "../../lib/supabase";
import { Notice, Modal } from "../../components/ui";
import type { Conversation } from "../../lib/types";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

/** An agent connection row from the agent_connections table. */
export type HandoffConnection = {
  id: string;
  workspace_id: string;
  name: string;
  provider: string;
  endpoint?: string | null;
  token?: string | null;
  created_at: string;
};

// ---------------------------------------------------------------------------
// HandoffMenu — "Ask in…" dropdown shown next to each conversation row
// ---------------------------------------------------------------------------

export function HandoffMenu({
  conversation,
  connections,
  onPick,
}: {
  conversation: Conversation;
  connections: HandoffConnection[];
  onPick: (connection: HandoffConnection) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  if (connections.length === 0) return null;

  return (
    <div ref={ref} className="handoff-menu">
      <button
        className="button secondary"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={`Ask in… (${conversation.title})`}
      >
        Ask in…
      </button>
      {open && (
        <ul
          role="menu"
          style={{
            position: "absolute",
            right: 0,
            zIndex: 100,
            background: "var(--color-surface, #1a1a1a)",
            border: "1px solid var(--color-border, #333)",
            borderRadius: 6,
            padding: "4px 0",
            minWidth: 160,
            listStyle: "none",
            margin: 0,
          }}
        >
          {connections.map((conn) => (
            <li key={conn.id} role="none">
              <button
                role="menuitem"
                style={{
                  display: "block",
                  width: "100%",
                  padding: "8px 16px",
                  textAlign: "left",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "inherit",
                }}
                onClick={() => {
                  setOpen(false);
                  onPick(conn);
                }}
              >
                {conn.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ConversationHandoff — modal that sends the conversation context to an agent
// ---------------------------------------------------------------------------

export function ConversationHandoff({
  conversation,
  connection,
  onClose,
  onShared,
}: {
  conversation: Conversation;
  connection: HandoffConnection;
  onClose: () => void;
  onShared: (message: string) => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { error: rpcError } = await db().rpc("confirm_handoff", {
        p_conversation_id: conversation.id,
        p_connection_id: connection.id,
        p_note: note || null,
      });
      if (rpcError) throw rpcError;
      onShared(`Conversation sent to ${connection.name}.`);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Ask in ${connection.name}`} onClose={onClose}>
      <form className="modal-body" onSubmit={handleSubmit}>
        <p>
          Send <strong>{conversation.title}</strong> to{" "}
          <strong>{connection.name}</strong> ({connection.provider}).
        </p>
        {error && <Notice error>{error}</Notice>}
        <label>
          Note (optional)
          <textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Any context to pass along…"
            maxLength={1000}
            disabled={busy}
          />
        </label>
        <div className="modal-actions">
          <button className="button" disabled={busy}>
            {busy ? "Sending…" : "Send"}
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

type Handoff = {
  id: string;
  destination_provider: string;
  note: string | null;
  created_at: string;
};

export function ConversationHandoffsPage() {
  const { id } = useParams<{ id: string }>();
  const { workspace } = useWorkspace();
  const [handoffs, setHandoffs] = useState<Handoff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      const r = await db()
        .from("handoffs")
        .select("id,destination_provider,note,created_at")
        .eq("conversation_id", id)
        .order("created_at", { ascending: false });
      if (r.error) setError(r.error.message);
      else setHandoffs(r.data ?? []);
      setLoading(false);
    }
    void load();
  }, [id, workspace.id]);

  return (
    <>
      <div className="page-header">
        <div>
          <span className="eyebrow">CONVERSATION</span>
          <h1>Hand-off history</h1>
          <p>Every "Ask in…" action recorded for this conversation.</p>
        </div>
        <Link className="button secondary" to={`/app/conversations`}>
          ← Back to conversations
        </Link>
      </div>

      {error && <Notice error>{error}</Notice>}
      {loading && <p role="status">Loading hand-offs…</p>}

      {!loading && handoffs.length === 0 && (
        <p>No hand-offs recorded for this conversation.</p>
      )}

      {handoffs.map((h) => (
        <section className="app-section" key={h.id}>
          <h2>{h.destination_provider}</h2>
          <p style={{ fontSize: "0.85rem", color: "var(--color-muted,#888)" }}>
            {new Date(h.created_at).toLocaleString()}
          </p>
          {h.note && <p>{h.note}</p>}
        </section>
      ))}
    </>
  );
}
