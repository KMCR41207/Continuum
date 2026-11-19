import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useWorkspace } from "../../components/AppLayout";
import { db } from "../../lib/supabase";
import { Notice } from "../../components/ui";

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
