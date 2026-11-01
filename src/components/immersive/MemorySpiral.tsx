import { useEffect, useRef, useState, type CSSProperties } from "react";
import { sampleMemories } from "./demoData";
import { useMotionPreference } from "../../lib/useMotionPreference";
export function MemorySpiral() {
  const root = useRef<HTMLElement>(null);
  const reduced = useMotionPreference();
  const [selected, setSelected] = useState<string>(sampleMemories[0].id);
  const memory = sampleMemories.find((m) => m.id === selected)!;
  useEffect(() => {
    if (reduced || !root.current) return;
    let cancel = false,
      dispose: (() => void) | undefined;
    void import("../../lib/spiralScroll")
      .then(({ mountSpiralScroll }) => {
        if (!cancel && root.current) dispose = mountSpiralScroll(root.current);
      })
      .catch(() => {});
    return () => {
      cancel = true;
      dispose?.();
    };
  }, [reduced]);
  return (
    <section
      className="memory-spiral"
      ref={root}
      aria-labelledby="spiral-title"
    >
      <div className="spiral-copy" data-aos="fade-up">
        <span className="eyebrow">ORGANIZATION / SAMPLE MEMORIES</span>
        <h2 id="spiral-title">Different kinds of knowing.</h2>
        <p>Select a memory to inspect its statement and original source.</p>
      </div>
      <div className="spiral-layout">
        <div className="spiral-stage">
          <div className="spiral-arms">
            {sampleMemories.map((m, i) => (
              <button
                key={m.id}
                className="spiral-card"
                style={
                  {
                    "--arm": i,
                    "--x": `${Math.cos((i * Math.PI) / 3) * 29}%`,
                    "--y": `${Math.sin((i * Math.PI) / 3) * 34}%`,
                    "--depth": `${((i % 3) - 1) * 55}px`,
                    "--turn": `${(i - 2.5) * 4}deg`,
                  } as CSSProperties
                }
                aria-pressed={m.id === selected}
                onClick={() => setSelected(m.id)}
              >
                <span>
                  0{i + 1} / {m.category}
                </span>
                <strong>{m.content}</strong>
                <small>{m.project} · SAMPLE ↗</small>
              </button>
            ))}
          </div>
        </div>
        <aside className="spiral-inspector" aria-live="polite">
          <span className="eyebrow">
            {memory.category} / {memory.project}
          </span>
          <h3>{memory.content}</h3>
          <h4>Original source</h4>
          <blockquote>{memory.evidence}</blockquote>
          <p>{memory.source}</p>
          <span className="small-text">
            Sample content only. Nothing is saved.
          </span>
        </aside>
      </div>
    </section>
  );
}
