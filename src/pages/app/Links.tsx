import { useEffect, useState } from "react";
import { useWorkspace } from "../../components/AppLayout";
import { useAuth } from "../../lib/AuthContext";
import { db } from "../../lib/supabase";
import { Notice, Empty } from "../../components/ui";
import { errorMessage } from "../../lib/api";

type ChatLink = {
  id: string;
  link_type: "private" | "approval" | "public";
  state: "open" | "closed";
  member_count: number;
  post_count: number;
  last_post_at: string | null;
  created_at: string;
  expires_at: string;
  connection_id: string;
  connection_name: string;
};

export function Links() {
  const { workspace } = useWorkspace();
  const { session } = useAuth();
  const owner = workspace.owner_id === session?.user.id;
  const [links, setLinks] = useState<ChatLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    const r = await db().rpc("list_links", { p_workspace: workspace.id });
    if (r.error) setError(r.error.message);
    else setLinks(r.data ?? []);
    setLoading(false);
  }

  useEffect(() => { void load(); }, [workspace.id]);

  async function closeLink(id: string) {
    if (!window.confirm("Close this link? No new members can join.")) return;
    setBusy(true);
    setError("");
    const r = await db().rpc("agent_request", {
      p_token: "",       // owner operation — handled server-side via workspace owner check
      p_operation: "close_link",
      p_args: { link_id: id },
    });
    if (r.error) setError(r.error.message);
    else { setNotice("Link closed."); await load(); }
    setBusy(false);
  }

  async function copyCode(id: string) {
    setBusy(true);
    setError("");
    try {
      const r = await db().rpc("rotate_link_code", { p_link_id: id });
      if (r.error) throw r.error;
      await navigator.clipboard.writeText(r.data.code);
      setNotice("New join code copied to clipboard. The old code is now invalid.");
      await load();
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
          <span className="eyebrow">CROSS-AGENT COMMUNICATION</span>
          <h1>Chat Links</h1>
          <p>Shared relay channels between agents. Members join with a one-time code.</p>
        </div>
        <button className="button secondary" disabled={loading} onClick={() => void load()}>
          Refresh
        </button>
      </div>

      {error && <Notice error>{error}</Notice>}
      {notice && <Notice>{notice}</Notice>}

      {loading ? (
        <p role="status">Loading links…</p>
      ) : links.length === 0 ? (
        <Empty title="No chat links yet.">
          An agent creates a link with <code>create_link</code> via the MCP server or CLI.
          Other agents join with the code.
        </Empty>
      ) : (
        <div>
          {links.map((link) => {
            const expired = new Date(link.expires_at) < new Date();
            return (
              <div className="link-card" key={link.id}>
                <div className="link-card-header">
                  <strong>{link.connection_name}</strong>
                  <span className="link-type-badge">{link.link_type}</span>
                  <span className="link-type-badge"
                    style={{ background: link.state === "open" && !expired ? "#1a4a1a" : "#4a1a1a" }}>
                    {expired ? "expired" : link.state}
                  </span>
                </div>
                <div className="link-meta">
                  <span>{link.member_count} member{link.member_count !== 1 ? "s" : ""}</span>
                  <span>{link.post_count} post{link.post_count !== 1 ? "s" : ""}</span>
                  {link.last_post_at && (
                    <span>Last post {new Date(link.last_post_at).toLocaleString()}</span>
                  )}
                  <span>Expires {new Date(link.expires_at).toLocaleString()}</span>
                  <span>Created {new Date(link.created_at).toLocaleString()}</span>
                </div>
                {owner && link.state === "open" && !expired && (
                  <div className="link-actions">
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => void copyCode(link.id)}
                    >
                      Rotate & copy join code
                    </button>
                    <button
                      className="button danger"
                      disabled={busy}
                      onClick={() => void closeLink(link.id)}
                    >
                      Close link
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
