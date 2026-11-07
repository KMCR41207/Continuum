import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUpRight,
  Check,
  FileText,
  GitBranch,
  Layers,
} from "lucide-react";
import { Eyebrow } from "./ui";

const chapters = [
  {
    id: "capture",
    title: "Capture",
    subtitle: "Start with the original.",
    text: "Bring in a conversation you choose. Keep the original messages and their source. Your memory begins with evidence, not a guess.",
    icon: FileText,
    label: "01 / ORIGINAL STATEMENT",
    example:
      "“Let’s use PostgreSQL. We need relational data and transactional consistency.”",
    detail: "Project Atlas · Authorized conversation import",
  },
  {
    id: "understand",
    title: "Understand",
    subtitle: "Find the part worth keeping.",
    text: "Identify durable context. Surface uncertainty and possible conflicts for review. You decide what becomes a memory.",
    icon: Layers,
    label: "02 / PROPOSED MEMORY",
    example: "PostgreSQL is the selected database for Project Atlas.",
    detail: "Decision · Source attached · Awaiting your review",
  },
  {
    id: "remember",
    title: "Remember",
    subtitle: "Give the decision a home.",
    text: "Organize approved memories by project, with a history you can inspect. Correct a detail without losing the story behind it.",
    icon: GitBranch,
    label: "03 / REVIEWED CONTEXT",
    example: "Project Atlas / Architecture / Database decision",
    detail: "Approved by you · Version 1 · Project-scoped",
  },
  {
    id: "reuse",
    title: "Reuse",
    subtitle: "Pick up the thread.",
    text: "Make the relevant context available to an authorized agent. Each request respects the permissions and project boundaries you set.",
    icon: ArrowUpRight,
    label: "04 / AUTHORIZED RETRIEVAL",
    example:
      "“We’re using PostgreSQL for Atlas. I have the decision and its source.”",
    detail: "Scoped agent access · Original evidence included",
  },
] as const;

/** Native viewport observation changes the reading index, never the scroll position. */
export function ContinuityStory() {
  const root = useRef<HTMLElement>(null);
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (!root.current || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting)
            setActive(Number((entry.target as HTMLElement).dataset.chapter));
        }
      },
      { rootMargin: "-25% 0px -45% 0px", threshold: 0 },
    );
    root.current
      .querySelectorAll("[data-chapter]")
      .forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);

  return (
    <section
      className="continuity-story"
      aria-labelledby="story-heading"
      ref={root}
      data-core-story
    >
      <div className="content story-layout">
        <div className="story-intro">
          <Eyebrow>02 / FROM CONVERSATION TO CONTINUITY</Eyebrow>
          <h2 id="story-heading">
            Not every word.
            <br />
            <em>What matters.</em>
          </h2>
          <p>
            A useful memory is more than a saved transcript. It is a decision, a
            preference, or a piece of context—with the evidence behind it.
          </p>
          <nav className="story-index" aria-label="Memory lifecycle">
            {chapters.map((chapter, index) => (
              <a
                key={chapter.id}
                href={`#${chapter.id}`}
                aria-current={active === index ? "step" : undefined}
              >
                <span>0{index + 1}</span>
                {chapter.title}
                <ArrowUpRight size={16} />
              </a>
            ))}
          </nav>
          <span className="story-note">
            <ArrowDown size={14} /> Follow one decision through the loop.
          </span>
        </div>
        <div className="story-chapters">
          {chapters.map(
            (
              { id, title, subtitle, text, icon: Icon, label, example, detail },
              index,
            ) => (
              <article
                className="story-chapter"
                id={id}
                key={id}
                data-chapter={index}
                data-active={index === active}
                tabIndex={-1}
              >
                <div className="chapter-heading">
                  <span className="chapter-number">0{index + 1}</span>
                  <div>
                    <span className="eyebrow">{title}</span>
                    <h3>{subtitle}</h3>
                  </div>
                  <Icon size={24} strokeWidth={1.3} />
                </div>
                <p>{text}</p>
                <div className="chapter-example">
                  <div>
                    <span>{label}</span>
                    <span>EXAMPLE</span>
                  </div>
                  <blockquote>{example}</blockquote>
                  <small>
                    {index === 2 && <Check size={13} />}
                    {detail}
                  </small>
                </div>
              </article>
            ),
          )}
        </div>
      </div>
    </section>
  );
}
