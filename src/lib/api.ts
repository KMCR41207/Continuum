import { db } from "./supabase";
import { contentHash, conversationSchema } from "./memory";
import type { Memory } from "./types";
export async function list<T>(table: string, workspace: string) {
  const { data, error } = await db()
    .from(table)
    .select("*")
    .eq("workspace_id", workspace)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw error;
  return data as T[];
}
export async function importConversation(
  workspace: string,
  project: string | null,
  raw: string,
) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Paste a valid JSON conversation.");
  }
  const input = conversationSchema.parse(parsed);
  const hash = await contentHash(input);
  const { data, error } = await db().rpc("import_conversation", {
    p_workspace: workspace,
    p_project: project,
    p_input: input,
    p_hash: hash,
    p_proposals: null,
  });
  if (error) throw error;
  return data as { id: string; duplicate: boolean; proposals: number };
}
export async function updateMemory(
  memory: Memory,
  changes: Partial<
    Pick<
      Memory,
      "content" | "category" | "status" | "sensitivity" | "importance"
    >
  >,
) {
  const { data, error } = await db()
    .from("memories")
    .update(changes)
    .eq("id", memory.id)
    .eq("version", memory.version)
    .select()
    .single();
  if (error)
    throw new Error(
      error.code === "PGRST116"
        ? "This memory changed elsewhere. Close it and refresh before saving."
        : error.message,
    );
  return data as Memory;
}
export async function remove(
  table: "memories" | "conversations" | "projects",
  id: string,
) {
  const { error } = await db().from(table).delete().eq("id", id);
  if (error) throw error;
}
export async function exportWorkspace(workspace: string) {
  const { data, error } = await db().rpc("export_workspace", {
    p_workspace: workspace,
  });
  if (error) throw error;
  downloadJson(data,'memory-export');
}
export async function exportAccount() {
  const {data,error}=await db().rpc('export_account');
  if(error)throw error;
  downloadJson(data,'continuum-account-export');
}
function downloadJson(data: unknown, prefix: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `${prefix}-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function errorMessage(e: unknown) {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e) return String(e.message);
  return "Something went wrong. Please try again.";
}
