import { useEffect, useState } from "react";
import { db } from "../lib/supabase";
import { errorMessage } from "../lib/api";
import type { Memory, Source, Project } from "../lib/types";
import {
  RelationshipExplorer,
  type RelationshipNode,
  type RelationshipEdge,
} from "./RelationshipExplorer";
import { Notice } from "./ui";
export function MemoryRelationships({
  memories,
  projects,
  onOpen,
}: {
  memories: Memory[];
  projects: Project[];
  onOpen: (memory: Memory) => void;
}) {
  const [sources, setSources] = useState<Source[]>([]),
    [error, setError] = useState("");
  const ids = memories.map((m) => m.id).join(",");
  useEffect(() => {
    let current = true;
    setSources([]);
    setError("");
    if (ids)
      void db()
        .from("memory_sources")
        .select("*")
        .in("memory_id", ids.split(","))
        .then(({ data, error }) => {
          if (!current) return;
          if (error) setError(errorMessage(error));
          else setSources(data || []);
        });
    return () => {
      current = false;
    };
  }, [ids]);
  const nodes: RelationshipNode[] = memories
    .slice(0, 8)
    .map((m) => ({
      id: m.id,
      label: m.content,
      kind: m.category,
      detail: `${m.status} · Version ${m.version} · ${projects.find((p) => p.id === m.project_id)?.name || "Global context"}`,
      action: () => onOpen(m),
      actionLabel: "Inspect memory and sources",
    }));
  const edges: RelationshipEdge[] = [];
  sources
    .filter((s) => nodes.some((n) => n.id === s.memory_id))
    .slice(0, 8)
    .forEach((s) => {
      if (!nodes.some((n) => n.id === s.id))
        nodes.push({
          id: s.id,
          label: s.evidence,
          kind: "Source",
          detail: `Conversation ${s.conversation_id} · message ${s.message_id}`,
        });
      edges.push({
        from: s.id,
        to: s.memory_id,
        label: "Original supporting evidence",
      });
    });
  return (
    <>
      {error && <Notice error>{error}</Notice>}
      <RelationshipExplorer
        title="Memory relationship explorer"
        nodes={nodes}
        edges={edges}
        caption="Authorized records from the current search page. Change category or project above to explore another scope."
      />
    </>
  );
}
