import { useEffect, useState } from "react";
import { useWorkspace } from "../../components/AppLayout";
import { db } from "../../lib/supabase";
import { useRecords } from "../../lib/useRecords";
import { localApiUrl, localRequest } from "../../lib/localBackend";
import { Notice } from "../../components/ui";
import type { Project } from "../../lib/types";
export function LocalFiles() {
  const { workspace } = useWorkspace();
  const projects = useRecords<Project>("projects");
  const [files, setFiles] = useState<
    { id: string; name: string; size: number }[]
  >([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const reload = async () => {
    try {
      setFiles(
        await localRequest(`/api/v1/files?workspace_id=${workspace.id}`),
      );
    } catch (e) {
      setError(String(e));
    }
  };
  useEffect(() => {
    void reload();
  }, [workspace.id]);
  return (
    <>
      <div className="page-header">
        <div>
          <span className="eyebrow">PROJECT KNOWLEDGE</span>
          <h1>Project files</h1>
          <p>
            Import documents as source-linked memory candidates. Review them
            before granting agents access.
          </p>
        </div>
      </div>
      {error && <Notice error>{error}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      <form
        className="app-section"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          setNotice("");
          const body = new FormData(event.currentTarget);
          body.set("workspace_id", workspace.id);
          try {
            const { data } = await db().auth.getSession();
            const response = await fetch(localApiUrl + "/api/v1/files/upload", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${data.session?.access_token}`,
              },
              body,
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.detail || "Upload failed");
            await reload();
            setNotice(
              "File imported. Its memory candidates await review in Memories.",
            );
          } catch (e) {
            setError(String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Project
          <select name="project_id" required>
            <option value="">Select a project</option>
            {projects.data.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Document (maximum 10 MB)
          <input
            name="file"
            type="file"
            required
            accept=".txt,.md,.pdf,.docx,.json,.csv,.py,.ts,.tsx,.js,.jsx,.css,.sql,.yaml,.yml,.toml,.rs,.go,.java,.c,.cpp"
          />
        </label>
        <button className="button" disabled={busy}>
          {busy ? "Importing…" : "Import project file"}
        </button>
      </form>
      {!files.length && <p>No project files imported yet.</p>}
      {files.map((file) => (
        <section className="app-section" key={file.id}>
          <h2>{file.name}</h2>
          <p>{file.size.toLocaleString()} bytes</p>
          <button
            className="button secondary"
            onClick={async () => {
              if (
                !confirm("Delete this file and its derived memory candidates?")
              )
                return;
              try {
                await localRequest(
                  `/api/v1/files/${file.id}`,
                  undefined,
                  "DELETE",
                );
                await reload();
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            Delete file
          </button>
        </section>
      ))}
    </>
  );
}
