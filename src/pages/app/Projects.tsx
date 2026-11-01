import { useState, type FormEvent } from "react";
import { Plus, ArrowUpRight, FolderKanban } from "lucide-react";
import { useWorkspace } from "../../components/AppLayout";
import { Empty, Notice, Modal } from "../../components/ui";
import { useRecords } from "../../lib/useRecords";
import { db } from "../../lib/supabase";
import { errorMessage, remove } from "../../lib/api";
import type { Project, Conversation } from "../../lib/types";
import {
  RelationshipExplorer,
  type RelationshipNode,
  type RelationshipEdge,
} from "../../components/RelationshipExplorer";
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
    destination_connection_id?: string;
  }>("project_handoffs");
  const agents = useRecords<{
    id: string;
    name: string;
    provider: string;
    project_ids: string[];
    state: string;
  }>("agent_connections");
  const [handoffSource, setHandoffSource] = useState("");
  const [handoffTarget, setHandoffTarget] = useState("");
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const projectMemories = useRecords<{
    id: string;
    project_id: string;
    content: string;
    status: string;
    updated_at: string;
  }>("memories");
  const [handoffNote, setHandoffNote] = useState("");
  const { workspace } = useWorkspace();
  const [selected, setSelected] = useState<Project | "new" | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [graphProject, setGraphProject] = useState("");
  const focusedProject =
    records.data.find((p) => p.id === graphProject) || records.data[0];
  const graphNodes: RelationshipNode[] = focusedProject
    ? [
        {
          id: focusedProject.id,
          label: focusedProject.name,
          kind: "Project",
          detail:
            focusedProject.instructions ||
            focusedProject.description ||
            "Project context",
          action: () => setSelected(focusedProject),
          actionLabel: "Open project and handoffs",
        },
        ...projectMemories.data
          .filter((m) => m.project_id === focusedProject.id)
          .slice(0, 4)
          .map((m) => ({
            id: m.id,
            label: m.content,
            kind: "Memory",
            detail: `${m.status} · ${m.updated_at}`,
          })),
        ...conversations.data
          .filter((c) => c.project_id === focusedProject.id)
          .slice(0, 4)
          .map((c) => ({
            id: c.id,
            label: c.title,
            kind: "Conversation",
            detail: `${c.platform} · ${c.processing_status}${c.excluded ? " · excluded" : ""}`,
          })),
        ...agents.data
          .filter((a) => a.project_ids?.includes(focusedProject.id))
          .slice(0, 4)
          .map((a) => ({
            id: a.id,
            label: a.name,
            kind: "Credential",
            detail: `${a.provider} · ${a.state} · explicit project grant`,
          })),
        ...handoffs.data
          .filter((h) => h.project_id === focusedProject.id)
          .slice(0, 3)
          .map((h) => ({
            id: h.id,
            label: h.note || "Handoff",
            kind: "Handoff",
            detail: `Destination: ${h.target_provider} · ${h.created_at}`,
          })),
      ]
    : [];
  const graphEdges: RelationshipEdge[] = focusedProject
    ? graphNodes
        .filter((n) => n.id !== focusedProject.id)
        .map((n) => ({
          from: focusedProject.id,
          to: n.id,
          label:
            n.kind === "Credential"
              ? "Explicit project grant"
              : "Project association",
        }))
    : [];
  handoffs.data
    .filter((h) => graphNodes.some((n) => n.id === h.id))
    .forEach((h) => {
      if (graphNodes.some((n) => n.id === h.conversation_id))
        graphEdges.push({
          from: h.conversation_id,
          to: h.id,
          label: "Handoff source",
        });
      if (
        h.destination_connection_id &&
        graphNodes.some((n) => n.id === h.destination_connection_id)
      )
        graphEdges.push({
          from: h.id,
          to: h.destination_connection_id,
          label: "Reviewed destination; current permissions still apply",
        });
    });
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
      {focusedProject && (
        <>
          <label className="relationship-project-select">
            Visualize project
            <select
              value={focusedProject.id}
              onChange={(e) => setGraphProject(e.target.value)}
            >
              {records.data.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <RelationshipExplorer
            title="Project context map"
            nodes={graphNodes}
            edges={graphEdges}
            caption="Authorized loaded records. Up to four memories, sources, credentials and three handoffs are shown for this project; use project details for all loaded records."
          />
        </>
      )}
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
                <h3>Recent project context</h3>
                {projectMemories.data
                  .filter((m) => m.project_id === selected.id)
                  .slice(0, 10)
                  .map((m) => (
                    <p key={m.id}>
                      {m.content} · {m.status} ·{" "}
                      {new Date(m.updated_at).toLocaleString()}
                    </p>
                  ))}
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
                  <select
                    value={handoffTarget}
                    onChange={(e) => {
                      setHandoffTarget(e.target.value);
                      setPreview(null);
                    }}
                  >
                    <option value="">
                      Select an authorized destination agent
                    </option>
                    {agents.data
                      .filter(
                        (a) =>
                          a.project_ids.includes(selected.id) &&
                          a.state !== "revoked",
                      )
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} ({a.provider})
                        </option>
                      ))}
                  </select>
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
                      const r = await db().rpc("prepare_handoff", {
                        p_project: selected.id,
                        p_conversation: handoffSource,
                        p_destination: handoffTarget,
                        p_note: handoffNote,
                      });
                      if (r.error) throw r.error;
                      setPreview(r.data);
                    } catch (e) {
                      setError(errorMessage(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Preview context to share
                </button>
                {preview && (
                  <section className="source-evidence">
                    <h3>Review the exact context package</h3>
                    <pre>{JSON.stringify(preview, null, 2)}</pre>
                    <p>
                      The destination must still have permission when it
                      retrieves this handoff. Corrections and source exclusions
                      apply at retrieval.
                    </p>
                    <button
                      type="button"
                      className="button"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        setError("");
                        try {
                          const r = await db().rpc("confirm_handoff", {
                            p_project: selected.id,
                            p_conversation: handoffSource,
                            p_destination: handoffTarget,
                            p_note: handoffNote,
                            p_reviewed: preview,
                          });
                          if (r.error) throw r.error;
                          setPreview(null);
                          setHandoffNote("");
                          await handoffs.reload();
                        } catch (e) {
                          setError(errorMessage(e));
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Confirm and share with this agent
                    </button>
                  </section>
                )}
              </>
            )}
          </form>
        </Modal>
      )}
    </>
  );
}
