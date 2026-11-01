import { useState, useEffect } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { Search, ArrowUpRight } from "lucide-react";
import { useRecords } from "../../lib/useRecords";
import { db } from "../../lib/supabase";
import { errorMessage, updateMemory, remove } from "../../lib/api";
import { categories as originalCategories } from "../../lib/memory";
import { selfHosted } from "../../lib/localBackend";
import type { Memory, Project, Source, Version } from "../../lib/types";
import { Empty, Notice, Modal } from "../../components/ui";
import { useWorkspace } from "../../components/AppLayout";
import { useRpc } from "../../lib/product";
import { MemoryRelationships } from "../../components/MemoryRelationships";
const categories: readonly string[] = selfHosted ? [...originalCategories, "Technical architecture", "Coding conventions"] : originalCategories;
export function Memories() {
  const { workspace } = useWorkspace();
  const projects = useRecords<Project>("projects");
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [project, setProject] = useState("all");
  const [platform, setPlatform] = useState("all");
  const platforms = useRpc<string[]>("memory_platforms", {
    p_workspace: workspace.id,
  });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Memory | null>(null);
  const status = params.get("status") || "active";
  const search = useRpc<{ items: Memory[]; total: number }>("search_memories", {
    p_workspace: workspace.id,
    p_query: query,
    p_status: status,
    p_category: category === "all" ? null : category,
    p_project: project === "all" ? null : project,
    p_platform: platform === "all" ? null : platform,
    p_offset: (page - 1) * 15,
  });
  const records = { ...search, data: search.data?.items || [] };
  const filtered = records.data;
  const total = search.data?.total || 0;
  useEffect(() => setPage(1), [query, category, project, status, platform]);
  return (
    <>
      <div className="page-header">
        <div>
          <span className="eyebrow">WHAT YOU KNOW, WITH THE EVIDENCE</span>
          <h1>Memories</h1>
          <p>Inspect, refine, and organize the context worth keeping.</p>
        </div>
        <Link className="button secondary" to="/app/conversations">
          Import a source
          <ArrowUpRight size={16} />
        </Link>
      </div>
      <div className="memory-tabs">
        {["active", "pending", "archived", "rejected", "all"].map((s) => (
          <button
            className={status === s ? "selected" : ""}
            key={s}
            onClick={() => setParams({ status: s })}
          >
            {s === "pending" ? "Review queue" : s[0].toUpperCase() + s.slice(1)}
            {s === "pending" && status === "pending" && <span>{total}</span>}
          </button>
        ))}
      </div>
      <div className="filter-bar">
        <label className="search-field">
          <Search size={16} />
          <input
            aria-label="Search memories"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your memories"
          />
        </label>
        <select
          aria-label="Memory category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <select
          aria-label="Memory project"
          value={project}
          onChange={(e) => setProject(e.target.value)}
        >
          <option value="all">All projects</option>
          <option value="global">Global context</option>
          {projects.data.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <span className="small-text">Full-text search · {total} results</span>
      </div>
      {records.error && <Notice error>{records.error}</Notice>}
      {platforms.error && <Notice error>{platforms.error}</Notice>}
      <label>
        Source platform
        <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
          <option value="all">All source platforms</option>
          {(platforms.data || []).map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>
      {records.loading ? (
        <p role="status">Loading memories…</p>
      ) : filtered.length ? (
        <>
          <div className="table-scroll">
            <table className="memory-table">
              <thead>
                <tr>
                  <th>Memory</th>
                  <th>Category / Scope</th>
                  <th>Confidence</th>
                  <th>Updated</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <button
                        className="row-link"
                        onClick={() => setSelected(m)}
                      >
                        {m.content}
                        <ArrowUpRight size={14} />
                      </button>
                      {m.sensitivity === "sensitive" && (
                        <span className="sensitive-label">
                          Sensitive · Review carefully
                        </span>
                      )}
                    </td>
                    <td>
                      {m.category}
                      <small>
                        {projects.data.find((p) => p.id === m.project_id)
                          ?.name || "Workspace"}
                      </small>
                    </td>
                    <td>
                      {Math.round(m.confidence * 100)}%<small>Heuristic</small>
                    </td>
                    <td>{new Date(m.updated_at).toLocaleDateString()}</td>
                    <td>
                      <span
                        className={`pill ${m.status === "active" ? "success" : ""}`}
                      >
                        {m.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pagination">
            <button
              className="button secondary small"
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </button>
            <span>
              Page {page} of {Math.max(1, Math.ceil(total / 15))}
            </span>
            <button
              className="button secondary small"
              disabled={page * 15 >= total}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </div>
        </>
      ) : (
        <Empty
          title={
            status === "pending"
              ? "Nothing waiting for your judgment."
              : "Your useful context belongs here."
          }
        >
          {query
            ? "No memories match these filters."
            : "Import a conversation to create source-linked memory proposals."}
        </Empty>
      )}
      {selected && (
        <MemoryDetail
          memory={selected}
          onClose={() => setSelected(null)}
          onChange={async () => {
            await records.reload();
            setSelected(null);
          }}
        />
      )}
      {!records.loading && records.data.length > 0 && (
        <MemoryRelationships
          memories={records.data}
          projects={projects.data}
          onOpen={setSelected}
        />
      )}
    </>
  );
}
function MemoryDetail({
  memory,
  onClose,
  onChange,
}: {
  memory: Memory;
  onClose: () => void;
  onChange: () => Promise<void>;
}) {
  const [content, setContent] = useState(memory.content);
  const [category, setCategory] = useState(memory.category);
  const [sources, setSources] = useState<Source[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [conflicts, setConflicts] = useState<
    { id: string; content: string; status: string }[]
  >([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    Promise.all([
      db().rpc("memory_conflict_candidates", { p_id: memory.id }),
      db().from("memory_sources").select("*").eq("memory_id", memory.id),
      db()
        .from("memory_versions")
        .select("*")
        .eq("memory_id", memory.id)
        .order("version", { ascending: false }),
    ])
      .then(([c, s, v]) => {
        if (c.error) throw c.error;
        setConflicts(c.data);
        if (s.error) throw s.error;
        if (v.error) throw v.error;
        setSources(s.data);
        setVersions(v.data);
      })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [memory.id]);
  async function act(status?: string, sensitive = false) {
    if (!content.trim()) {
      setError("Memory content is required.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await updateMemory(memory, {
        content: content.trim(),
        category,
        ...(status ? { status } : {}),
        ...(sensitive ? { sensitivity: "sensitive" } : {}),
      });
      await onChange();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Memory detail" onClose={onClose}>
      <div className="modal-body">
        {error && <Notice error>{error}</Notice>}
        <div className="detail-meta">
          <span className="pill">{memory.status}</span>
          <span>Version {memory.version}</span>
          <span>
            {Math.round(memory.confidence * 100)}% heuristic confidence
          </span>
        </div>
        <label>
          Memory content
          <textarea
            rows={4}
            value={content}
            maxLength={4000}
            onChange={(e) => setContent(e.target.value)}
          />
        </label>
        <label>
          Category
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <p className="small-text">{memory.reason}</p>
        {conflicts.length > 0 && (
          <Notice>
            Possible conflicting or outdated context shares this statement's
            subject. Compare these candidates before approving; this rule cannot
            determine which is true. Archive or correct outdated memories in the
            memory list.
            <ul>
              {conflicts.map((c) => (
                <li key={c.id}>
                  {c.content} ({c.status})
                </li>
              ))}
            </ul>
          </Notice>
        )}
        <h3>Source evidence</h3>
        {loading ? (
          <p>Loading evidence…</p>
        ) : sources.length ? (
          sources.map((s) => (
            <div className="source-evidence" key={s.id}>
              <blockquote>{s.evidence}</blockquote>
              <Link to={`/app/conversations?open=${s.conversation_id}`}>
                Open source conversation →
              </Link>
            </div>
          ))
        ) : (
          <p>No source reference found.</p>
        )}
        <h3>Version history</h3>
        <p className="small-text">
          Current version {memory.version} · Updated{" "}
          {new Date(memory.updated_at).toLocaleString()}
        </p>
        {versions.map((v) => (
          <details key={v.id}>
            <summary>
              Version {v.version} · {v.status}
            </summary>
            <p>{v.content}</p>
          </details>
        ))}
        <div className="modal-actions">
          <button
            className="button"
            disabled={busy}
            onClick={() =>
              act(memory.status === "pending" ? "active" : undefined)
            }
          >
            {busy
              ? "Saving…"
              : memory.status === "pending"
                ? "Save and approve"
                : "Save changes"}
          </button>
          {memory.status === "pending" && (
            <>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => act("rejected")}
              >
                Reject
              </button>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => act(undefined, true)}
              >
                Mark sensitive
              </button>
            </>
          )}
          <button
            className="button secondary"
            disabled={busy}
            onClick={() =>
              act(memory.status === "archived" ? "active" : "archived")
            }
          >
            {memory.status === "archived" ? "Restore" : "Archive"}
          </button>
          <button
            className="button danger"
            disabled={busy}
            onClick={async () => {
              if (
                !window.confirm(
                  "Permanently delete this memory, source references, and version history?",
                )
              )
                return;
              setBusy(true);
              try {
                await remove("memories", memory.id);
                await onChange();
              } catch (e) {
                setError(errorMessage(e));
                setBusy(false);
              }
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </Modal>
  );
}
