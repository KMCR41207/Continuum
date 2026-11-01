import { useEffect, useRef, useState, type CSSProperties } from "react";
import { integrations } from "../../config/integrations";
import { useMotionPreference } from "../../lib/useMotionPreference";
export function IntegrationOrbit() {
  const root = useRef<HTMLElement>(null),
    reduced = useMotionPreference();
  const items = integrations
    .filter((i) => i.capability === "Agent access")
    .slice(0, 6);
  const [id, setId] = useState(items[0].id);
  const selected = items.find((i) => i.id === id)!;
  useEffect(() => {
    if (reduced || !root.current) return;
    let cancel = false,
      dispose: (() => void) | undefined;
    void import("../../lib/orbitScroll")
      .then(({ mountOrbitScroll }) => {
        if (!cancel && root.current) dispose = mountOrbitScroll(root.current);
      })
      .catch(() => {});
    return () => {
      cancel = true;
      dispose?.();
    };
  }, [reduced]);
  return (
    <section
      className="integration-orbit"
      ref={root}
      aria-label="Agent capability explorer"
    >
      <div className="agent-ticker" aria-label="Integration capabilities">
        <div className="agent-ticker-track">
          {items.map((i) => (
            <span key={i.id}>
              {i.name}
              <small>{i.status}</small>
            </span>
          ))}
        </div>
      </div>
      <div className="orbit-layout">
        <div className="agent-orbit">
          <div className="orbit-core">
            Continuum<small>Scoped memory</small>
          </div>
          <div className="agent-ring">
            {items.map((i, n) => (
              <button
                key={i.id}
                style={{ "--angle": `${n * 60}deg` } as CSSProperties}
                aria-pressed={id === i.id}
                onClick={() => setId(i.id)}
              >
                <span>{i.name}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="orbit-detail" aria-live="polite">
          <span className="eyebrow">CAPABILITY / {selected.status}</span>
          <h2>{selected.name}</h2>
          <p>{selected.description}</p>
          <p>
            No live provider session is claimed. Explore the capability details
            below before configuring access.
          </p>
        </div>
      </div>
    </section>
  );
}
