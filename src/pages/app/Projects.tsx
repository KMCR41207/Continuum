import { useState, type FormEvent } from "react";
import { Plus, ArrowUpRight, FolderKanban } from "lucide-react";
import { useWorkspace } from "../../components/AppLayout";
import { Empty, Notice, Modal } from "../../components/ui";
import { useRecords } from "../../lib/useRecords";
import { db } from "../../lib/supabase";
import { errorMessage, remove } from "../../lib/api";
import type { Project, Conversation } from "../../lib/types";
export function Projects() {
  const records = useRecords<Project>("projects");
  const conversations = useRecords<Conversation>("conversations");
  const handoffs = useRecords<{
    id: string;
    project_id: string;
    conversation_id: string;
    target_provider: string;
    note: string;
    created_at: string;
  }>("project_handoffs");
  const agents = useRecords<{
    id: string;
    name: string;
    provider: string;
    project_ids: string[];
    state: string;
  }>("agent_connections");
  const [handoffSource, setHandoffSource] = useState("");
  const [handoffTarget, setHandoffTarget] = useState("other");
  const [handoffNote, setHandoffNote] = useState("");
  const { workspace } = useWorkspace();
  const [selected, setSelected] = useState<Project | "new" | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    const values = {
      name: String(form.get("name")).trim(),
      description: String(form.get("description")).trim(),
      instructions: String(form.get("instructions")).trim(),
      status: String(form.get("status")),
    };
    try {
      if (!values.name) throw new Error("Project name is required.");
      const result =
        selected === "new"
          ? await db()
              .from("projects")
              .insert({ ...values, workspace_id: workspace.id })
          : await db()
              .from("projects")
              .update(values)
              .eq("id", (selected as Project).id);
      if (result.error) throw result.error;
      await records.reload();
      setSelected(null);
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
          <span className="eyebrow">CONTEXT WITH A PURPOSE</span>
          <h1>Projects</h1>
          <p>Give each piece of work its own instructions and memory.</p>
        </div>
        <button
          className="button"
          onClick={() => {
            setSelected("new");
            setError("");
          }}
        >
          <Plus size={16} />
          New project
        </button>
      </div>
      {records.error && <Notice error>{records.error}</Notice>}
      {records.loading ? (
        <p role="status">Loading projects…</p>
      ) : records.data.length ? (
        <div className="project-list">
          {records.data.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                setSelected(p);
                setError("");
              }}
            >
              <FolderKanban size={23} />
              <div>
                <h2>{p.name}</h2>
                <p>{p.description || "No description yet."}</p>
              </div>
              <span className="pill">{p.status}</span>
              <ArrowUpRight size={18} />
            </button>
          ))}
        </div>
      ) : (
        <Empty
          title="A separate space for each idea."
          action={
            <button
              className="button secondary"
              onClick={() => setSelected("new")}
            >
              Create your first project
            </button>
          }
        >
          Project instructions stay attached to the work they belong to,
          independently of global preferences.
        </Empty>
      )}
      {selected && (
        <Modal
          title={selected === "new" ? "Create a project" : selected.name}
          onClose={() => setSelected(null)}
        >
          <form className="modal-body" onSubmit={save}>
            {error && <Notice error>{error}</Notice>}
            <label>
              Project name
              <input
                name="name"
                required
                maxLength={100}
                defaultValue={selected === "new" ? "" : selected.name}
              />
            </label>
            <label>
              Description
              <textarea
                name="description"
                maxLength={2000}
                rows={3}
                defaultValue={selected === "new" ? "" : selected.description}
              />
            </label>
            <label>
              Project instructions
              <textarea
                name="instructions"
                maxLength={10000}
                rows={5}
                defaultValue={selected === "new" ? "" : selected.instructions}
                placeholder="Technical constraints, decisions, and preferences specific to this project."
              />
            </label>
            <label>
              Status
              <select
                name="status"
                defaultValue={selected === "new" ? "active" : selected.status}
              >
                <option value="active">Active</option>
                <option value="archived">Archived</option>
              </select>
            </label>
            <div className="modal-actions">
              <button className="button" disabled={busy}>
                {busy ? "Saving…" : "Save project"}
              </button>
              {selected !== "new" && (
                <button
                  type="button"
                  className="button danger"
                  disabled={busy}
                  onClick={async () => {
                    if (
                      !window.confirm(
                        "Delete this project? Projects with linked memories or conversations cannot be deleted; archive those projects instead.",
                      )
                    )
                      return;
                    setBusy(true);
                    try {
                      await remove("projects", selected.id);
                      await records.reload();
                      setSelected(null);
                    } catch (e) {
                      setError(errorMessage(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Delete project
                </button>
              )}
            </div>
            {selected !== "new" && (
              <>
                <h3>Connected agents</h3>
                <p>
                  {agents.data
                    .filter(
                      (a) =>
                        a.project_ids.includes(selected.id) &&
                        a.state !== "revoked",
                    )
                    .map((a) => `${a.name} (${a.provider}, ${a.state})`)
                    .join(", ") || "No agents granted access."}
                </p>
                <h3>Conversation handoffs</h3>
                <p>
                  Handoffs link existing project conversations. They do not
                  grant the recipient additional access.
                </p>
                {handoffs.error && <Notice error>{handoffs.error}</Notice>}
                {handoffs.data
                  .filter((h) => h.project_id === selected.id)
                  .map((h) => (
                    <article className="source-evidence" key={h.id}>
                      <strong>{h.target_provider}</strong>
                      <p>{h.note}</p>
                      <a href={`/app/conversations?open=${h.conversation_id}`}>
                        Open linked conversation
                      </a>
                      <small>
                        {" "}
                        · {new Date(h.created_at).toLocaleString()}
                      </small>
                    </article>
                  ))}
                <label>
                  Source conversation
                  <select
                    value={handoffSource}
                    onChange={(e) => setHandoffSource(e.target.value)}
                  >
                    <option value="">Select a project conversation</option>
                    {conversations.data
                      .filter(
                        (c) => c.project_id === selected.id && !c.excluded,
                      )
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Intended recipient
                  <input
                    maxLength={50}
                    value={handoffTarget}
                    onChange={(e) => setHandoffTarget(e.target.value)}
                  />
                </label>
                <label>
                  Handoff note
                  <textarea
                    maxLength={4000}
                    value={handoffNote}
                    onChange={(e) => setHandoffNote(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="button secondary"
                  disabled={
                    busy ||
                    !handoffSource ||
                    !handoffNote.trim() ||
                    !handoffTarget.trim()
                  }
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      const r = await db().rpc("create_handoff", {
                        p_project: selected.id,
                        p_conversation: handoffSource,
                        p_target: handoffTarget,
                        p_note: handoffNote,
                      });
                      if (r.error) throw r.error;
                      setHandoffNote("");
                      await handoffs.reload();
                    } catch (e) {
                      setError(errorMessage(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Save source-linked handoff
                </button>
              </>
            )}
          </form>
        </Modal>
      )}
    </>
  );
}
