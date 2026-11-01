import { useState } from "react";
const nodes = [
  {
    name: "MCP client",
    detail:
      "The local or HTTP client sends an owner-issued scoped bearer token. No provider login or global memory access is implied.",
  },
  {
    name: "Authorization",
    detail:
      "Every request checks token expiry, revocation, independent retrieval/writing/capture permissions, and project scope.",
  },
  {
    name: "Workspace",
    detail:
      "Approved, active memories are selected under current workspace and source permissions. Sensitive and excluded sources are filtered.",
  },
  {
    name: "Evidence",
    detail:
      "The response includes current memory versions, source references and authorized handoffs. Permissions are checked again on the next request.",
  },
];
export function ArchitectureExplorer() {
  const [selected, setSelected] = useState(0);
  return (
    <section
      className="architecture-explorer"
      aria-label="MCP architecture explorer"
    >
      <div className="architecture-path">
        {nodes.map((n, i) => (
          <button
            key={n.name}
            aria-pressed={selected === i}
            onClick={() => setSelected(i)}
          >
            <span>0{i + 1}</span>
            {n.name}
            <b aria-hidden="true">→</b>
          </button>
        ))}
      </div>
      <p aria-live="polite">{nodes[selected].detail}</p>
    </section>
  );
}
