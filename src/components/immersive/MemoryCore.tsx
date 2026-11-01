import { useEffect, useRef, useState } from "react";
import {
  agentNodes,
  sampleMemories,
  type CoreNode,
  type CoreMode,
  type SceneState,
} from "./demoData";
import { useMotionPreference } from "../../lib/useMotionPreference";

const nodes: CoreNode[] = [
  ...agentNodes,
  {
    id: "source",
    label: "Conversation",
    kind: "source",
    detail: "Authorized source · original wording retained.",
  },
  {
    id: "project",
    label: "Project",
    kind: "project",
    detail: "Project boundaries restrict retrieval.",
  },
  ...sampleMemories.slice(0, 3).map((m) => ({
    id: m.id,
    label: m.category,
    kind: "memory" as const,
    detail: `${m.project} · ${m.content} Source: ${m.source}. Evidence: ${m.evidence}`,
  })),
];
export function MemoryCore({
  compact = false,
  narrative = false,
}: {
  compact?: boolean;
  narrative?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLDivElement>(null);
  const controller = useRef<Awaited<
    ReturnType<
      (typeof import("../../lib/threeMemoryScene"))["createMemoryScene"]
    >
  > | null>(null);
  const reduced = useMotionPreference();
  const [enabled, setEnabled] = useState(
    () => window.matchMedia("(min-width: 901px) and (pointer: fine)").matches,
  );
  const [visible, setVisible] = useState(false),
    [failed, setFailed] = useState(false),
    [hovered, setHovered] = useState("");
  const [state, setState] = useState<SceneState>({
    mode: "capture",
    selected: "source",
    project: "Atlas",
    zoom: 0,
    reset: 0,
  });
  const latest = useRef(state);
  const lastProgress = useRef(0);
  const narrativeMode = useRef<CoreMode>("capture");
  latest.current = state;
  useEffect(() => {
    const media = window.matchMedia("(min-width: 901px) and (pointer: fine)");
    const change = () => {
      if (!media.matches) setEnabled(false);
    };
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { rootMargin: "150px" },
    );
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  // Once mounted, the renderer itself pauses when offscreen. Only load when first near view.
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (visible) setLoaded(true);
  }, [visible]);
  useEffect(() => {
    if (!loaded || !enabled || reduced || !canvas.current || failed) return;
    let cancelled = false;
    void import("../../lib/threeMemoryScene")
      .then(({ createMemoryScene }) => {
        if (cancelled || !canvas.current) return;
        try {
          controller.current = createMemoryScene(
            canvas.current,
            nodes,
            latest.current,
            (id) => setState((s) => ({ ...s, selected: id })),
            setHovered,
            () => setFailed(true),
          );
          controller.current.progress(lastProgress.current);
        } catch {
          setFailed(true);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      controller.current?.dispose();
      controller.current = null;
    };
  }, [loaded, enabled, reduced, failed]);
  useEffect(() => {
    controller.current?.update(state);
  }, [state]);
  useEffect(() => {
    if (reduced || !root.current) return;
    let cancelled = false,
      cleanup: (() => void) | undefined;
    void import("../../lib/coreScroll")
      .then(({ mountCoreScroll }) => {
        if (!cancelled && root.current)
          cleanup = mountCoreScroll(root.current, (p) => {
            lastProgress.current = p;
            controller.current?.progress(p);
            const mode: CoreMode =
              p < 0.33 ? "capture" : p < 0.75 ? "store" : "retrieve";
            if (narrative && narrativeMode.current !== mode) {
              narrativeMode.current = mode;
              setState((s) => ({
                ...s,
                mode,
                selected:
                  mode === "capture"
                    ? "source"
                    : mode === "store"
                      ? "decision"
                      : "claude",
              }));
            }
          });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [reduced, loaded, narrative]);
  const selected = nodes.find((n) => n.id === state.selected);
  const show3d = enabled && !reduced && !failed;
  return (
    <div className={`memory-core ${compact ? "compact" : ""}`} ref={root}>
      <div className="core-topline">
        <span>CONTINUUM / MEMORY CORE</span>
        <span>
          {narrative
            ? `SAMPLE / ${state.mode.toUpperCase()}`
            : "SAMPLE EXPLORER"}
        </span>
      </div>
      <div
        className="core-viewport"
        ref={canvas}
        aria-label="Memory core visualization"
      >
        {!show3d && (
          <div className="core-static" aria-hidden="true">
            <span>CONVERSATION</span>
            <i>↓</i>
            <b>Continuum</b>
            <i>↓</i>
            <span>
              {state.project} / {state.mode.toUpperCase()}
            </span>
          </div>
        )}
        <div className="core-hover" aria-hidden="true">
          {hovered ||
            (show3d ? "Drag to orbit · select a node" : "Simplified view")}
        </div>
      </div>
      {!narrative && (
        <>
          <div className="core-toolbar" aria-label="Memory core controls">
            {(["capture", "store", "retrieve"] as CoreMode[]).map((mode) => (
              <button
                key={mode}
                aria-pressed={state.mode === mode}
                onClick={() => setState((s) => ({ ...s, mode }))}
              >
                {mode}
              </button>
            ))}
            <button
              aria-label="Zoom into memory core"
              disabled={!show3d || state.zoom >= 2}
              onClick={() =>
                setState((s) => ({ ...s, zoom: Math.min(2, s.zoom + 0.5) }))
              }
            >
              +
            </button>
            <button
              aria-label="Zoom out of memory core"
              disabled={!show3d || state.zoom <= -1}
              onClick={() =>
                setState((s) => ({ ...s, zoom: Math.max(-1, s.zoom - 0.5) }))
              }
            >
              −
            </button>
            <button
              disabled={!show3d}
              onClick={() =>
                setState((s) => ({ ...s, zoom: 0, reset: s.reset + 1 }))
              }
            >
              Reset camera
            </button>
          </div>
          <div className="core-selectors">
            <label>
              Sample project
              <select
                value={state.project}
                onChange={(e) =>
                  setState((s) => ({
                    ...s,
                    project: e.target.value,
                    selected: "project",
                  }))
                }
              >
                <option>Atlas</option>
                <option>Studio</option>
              </select>
            </label>
            <label>
              Inspect node
              <select
                value={state.selected}
                onChange={(e) =>
                  setState((s) => ({ ...s, selected: e.target.value }))
                }
              >
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="core-detail" aria-live="polite">
            <strong>{selected?.label}: </strong>
            {state.selected === "project"
              ? `${state.project} scope selected. Only this project's and global memories are shown.`
              : selected?.detail}
          </p>
          <p className="core-disclosure">
            Sample data. Capture, store and retrieve controls demonstrate the
            model; they do not change account permissions or connect providers.
          </p>
          {!reduced && !failed && (
            <button
              className="core-view-toggle"
              onClick={() => setEnabled(!enabled)}
            >
              {enabled ? "Use simplified view" : "Enable interactive 3D"}
            </button>
          )}
          {failed && (
            <p role="status">
              3D is unavailable on this device. All sample details remain
              available through the controls.
            </p>
          )}
        </>
      )}
    </div>
  );
}
