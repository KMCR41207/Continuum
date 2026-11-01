import { useEffect, useRef, useState } from "react";
import { useMotionPreference } from "../../lib/useMotionPreference";
const stages = [
  [
    "Conversation",
    "The original words.",
    "“Let’s use PostgreSQL because we need relational data and transactional consistency.”",
    "Source · Atlas architecture · user message 3",
  ],
  [
    "Capture",
    "Keep the evidence.",
    "Conversation imported with original message order and source references.",
    "Authorized import · source retained",
  ],
  [
    "Extract",
    "Propose a useful memory.",
    "PostgreSQL is the selected database for Project Atlas.",
    "Decision · proposed · not yet available to agents",
  ],
  [
    "Review",
    "You make the call.",
    "Inspect the source, correct the statement, then approve or reject it.",
    "Sample outcome · approved by the workspace owner",
  ],
  [
    "Store",
    "Give it context.",
    "Project Atlas → Architecture → Database decision",
    "Version 1 · approved · project scope retained",
  ],
  [
    "Retrieve",
    "Continue with permission.",
    "An authorized agent receives the approved decision and its source.",
    "Scoped request → memory + evidence → work continues",
  ],
] as const;
export function WorkflowShowcase({
  developer = false,
}: {
  developer?: boolean;
}) {
  const root = useRef<HTMLElement>(null),
    track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const reduced = useMotionPreference();
  const jump = useRef<((index: number) => void) | null>(null);
  useEffect(() => {
    if (reduced || !root.current || !track.current) return;
    let cancelled = false,
      dispose: (() => void) | undefined;
    void import("../../lib/workflowScroll")
      .then(({ mountWorkflowScroll }) => {
        if (cancelled || !root.current || !track.current) return;
        const mounted = mountWorkflowScroll(
          root.current,
          track.current,
          setActive,
        );
        jump.current = mounted.jump;
        dispose = mounted.dispose;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      dispose?.();
      jump.current = null;
    };
  }, [reduced]);
  const go = (index: number) => {
    setActive(index);
    if (jump.current) jump.current(index);
    else {
      const panel = track.current?.children[index] as HTMLElement | undefined;
      track.current?.scrollTo({
        left: panel?.offsetLeft || 0,
        behavior: reduced ? "instant" : "smooth",
      });
    }
  };
  return (
    <section
      className="workflow-showcase"
      ref={root}
      aria-label={
        developer
          ? "MCP request workflow"
          : "Conversation to retrieval workflow"
      }
    >
      <div className="workflow-heading" data-aos="fade-up">
        <span className="eyebrow">
          {developer
            ? "FOLLOW A SCOPED REQUEST"
            : "FROM WORDS TO WORKING CONTEXT"}
        </span>
        <h2>
          {developer
            ? "Every request crosses a boundary."
            : "One conversation. A continuous thread."}
        </h2>
        <p>
          Sample interface sequence. Scroll or select a step; no account data is
          modified.
        </p>
      </div>
      <div className="workflow-pin">
        <div className="workflow-step-controls" aria-label="Workflow steps">
          {stages.map(([name], i) => (
            <button
              key={name}
              aria-pressed={active === i}
              onClick={() => go(i)}
            >
              {i + 1}. {name}
            </button>
          ))}
        </div>
        <div className="workflow-window">
          <div
            className="workflow-track"
            ref={track}
            onScroll={(e) => {
              if (root.current?.dataset.horizontal !== "true") {
                const node = e.currentTarget;
                const width =
                  (node.children[0] as HTMLElement)?.offsetWidth || 1;
                setActive(
                  Math.min(5, Math.round(node.scrollLeft / (width + 24))),
                );
              }
            }}
          >
            {stages.map(([name, title, text, detail], index) => (
              <article
                className="workflow-panel"
                key={name}
                tabIndex={0}
                onFocus={() => {
                  if (index !== active) go(index);
                }}
                aria-label={`${name} sample interface`}
              >
                <div className="workflow-panel-top">
                  <span>
                    0{index + 1} / {name}
                  </span>
                  <span>SAMPLE</span>
                </div>
                <h3>{title}</h3>
                {developer ? (
                  <pre>
                    <code>
                      {
                        [
                          "client → tools/call\nget_project_context({ project_id })",
                          "Authorization: Bearer <scoped-token>\nvalidate token + expiry + revocation",
                          "check: retrieval permission\ncheck: project allowlist",
                          "filter: approved + active\nexclude: sensitive + excluded sources",
                          "select: current version + evidence\nrecord: authorized request event",
                          "return { memories, sources, handoffs }\npermissions rechecked on next request",
                        ][index]
                      }
                    </code>
                  </pre>
                ) : (
                  <blockquote>{text}</blockquote>
                )}
                <div className="workflow-record">
                  <span>
                    {index < 3
                      ? "SOURCE-LINKED"
                      : index === 3
                        ? "REVIEWED"
                        : index === 4
                          ? "PROJECT-SCOPED"
                          : "AUTHORIZED"}
                  </span>
                  <p>{detail}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
        <p className="workflow-outcome" aria-live="polite">
          {stages[active][0]} ·{" "}
          {developer ? "Scoped MCP workflow illustration" : stages[active][1]}
        </p>
      </div>
    </section>
  );
}
