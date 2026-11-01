import { useState, useEffect } from "react";
import "../styles/relationships.css";
export type RelationshipNode = {
  id: string;
  label: string;
  kind: string;
  detail: string;
  action?: () => void;
  actionLabel?: string;
};
export type RelationshipEdge = { from: string; to: string; label: string };
export function RelationshipExplorer({
  title,
  nodes,
  edges,
  caption,
}: {
  title: string;
  nodes: RelationshipNode[];
  edges: RelationshipEdge[];
  caption: string;
}) {
  const [selected, setSelected] = useState("");
  const shown = nodes.slice(0, 18);
  const current = shown.find((n) => n.id === selected) || shown[0];
  const groups = [...new Set(shown.map((n) => n.kind))];
  const positions = new Map(
    shown.map((node) => {
      const same = shown.filter((n) => n.kind === node.kind);
      return [
        node.id,
        {
          x:
            groups.length === 1
              ? 50
              : 12 + (groups.indexOf(node.kind) * 76) / (groups.length - 1),
          y: 12 + ((same.indexOf(node) + 0.5) * 76) / same.length,
        },
      ];
    }),
  );
  return (
    <section className="relationship-explorer" aria-label={title}>
      <div className="relationship-heading">
        <h2>{title}</h2>
        <p>
          {caption}
          {nodes.length > 18
            ? " Showing the first 18 nodes; use the record lists for the remaining entries."
            : ""}
        </p>
      </div>
      {shown.length ? (
        <>
          <div className="relationship-map">
            <svg
              viewBox="0 0 1000 420"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              {edges
                .filter((e) => positions.has(e.from) && positions.has(e.to))
                .map((e, i) => {
                  const a = positions.get(e.from)!,
                    b = positions.get(e.to)!;
                  return (
                    <path
                      key={i}
                      className={
                        e.from === current?.id || e.to === current?.id
                          ? "selected"
                          : ""
                      }
                      d={`M${a.x * 10},${a.y * 4.2} C500,${a.y * 4.2} 500,${b.y * 4.2} ${b.x * 10},${b.y * 4.2}`}
                    />
                  );
                })}
            </svg>
            {shown.map((n) => (
              <button
                key={n.id}
                style={{
                  left: `${positions.get(n.id)!.x}%`,
                  top: `${positions.get(n.id)!.y}%`,
                }}
                className="relationship-node"
                aria-pressed={current?.id === n.id}
                onClick={() => setSelected(n.id)}
              >
                <small>{n.kind}</small>
                <span>{n.label}</span>
              </button>
            ))}
          </div>
          {current && (
            <div className="relationship-detail" aria-live="polite">
              <h3>{current.label}</h3>
              <p>{current.detail}</p>
              <ul>
                {edges
                  .filter((e) => e.from === current.id || e.to === current.id)
                  .map((e, i) => (
                    <li key={i}>
                      {nodes.find((n) => n.id === e.from)?.label} →{" "}
                      {nodes.find((n) => n.id === e.to)?.label}: {e.label}
                    </li>
                  ))}
              </ul>
              {current.action && (
                <button
                  className="button secondary small"
                  onClick={current.action}
                >
                  {current.actionLabel || "Open record"}
                </button>
              )}
            </div>
          )}
        </>
      ) : (
        <p>No authorized records to visualize yet.</p>
      )}
    </section>
  );
}
