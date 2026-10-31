import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Layers,
  LockKeyhole,
  GitBranch,
  FileText,
} from "lucide-react";
import { Link } from "react-router-dom";
import { ActionLink, Eyebrow, TextLink } from "../components/ui";
import { MemoryLoop } from "../components/MemoryLoop";
export function Home() {
  return (
    <>
      <section className="hero content">
        <div className="hero-copy">
          <Eyebrow>
            <span className="tiny-cross">+</span> YOUR CONTEXT. CARRIED FORWARD.
          </Eyebrow>
          <h1>
            Every AI
            <br />
            starts fresh.
            <br />
            <em>
              You shouldn’t
              <br className="desktop-break" /> have to.
            </em>
          </h1>
          <p className="hero-description">
            Keep your conversations, decisions, preferences, and project
            knowledge connected across the AI tools you use.
          </p>
          <div className="hero-actions">
            <ActionLink to="/signup">Build your memory layer</ActionLink>
            <Link className="quiet-link" to="/#how-it-works">
              Explore how it works <ArrowRight size={15} />
            </Link>
          </div>
          <p className="hero-footnote">
            <LockKeyhole size={13} /> Your memory. Your permissions. Your
            choice.
          </p>
        </div>
        <div className="hero-visual">
          <div className="visual-annotation">
            <span>CONTEXT HAS A LIFE BEYOND THE CHAT.</span>
            <span>FIG. 01 ↙</span>
          </div>
          <MemoryLoop />
          <div className="visual-caption">
            <span className="caption-line" />
            <span>
              One decision. A different agent.
              <br />
              No explanation needed twice.
            </span>
          </div>
        </div>
      </section>
      <section
        className="platform-strip content"
        aria-label="Tools in the integration roadmap"
      >
        <span className="eyebrow">
          DESIGNED FOR
          <br />
          THE TOOLS YOU USE
        </span>
        <div>
          <span>ChatGPT</span>
          <span className="serif-name">Claude</span>
          <span>Gemini</span>
          <span className="mono-name">Cursor</span>
          <span>Codex</span>
        </div>
        <Link to="/integrations">
          See capabilities <ArrowUpRight size={14} />
        </Link>
      </section>
      <section className="editorial-section content" id="how-it-works">
        <div className="section-heading">
          <Eyebrow>01 / THE CONTEXT PROBLEM</Eyebrow>
          <span className="section-index">
            Start somewhere.
            <br />
            Continue anywhere.
          </span>
        </div>
        <div className="split-section">
          <h2>
            Your best thinking
            <br />
            shouldn’t live
            <br />
            in separate tabs.
          </h2>
          <div>
            <p className="lead">
              A plan in ChatGPT. A decision in Claude.
              <br />
              An implementation in Cursor.
            </p>
            <p>
              Each conversation holds a piece of the picture. Switching tools
              shouldn’t mean rebuilding it from memory—or explaining yourself
              all over again.
            </p>
            <div className="context-comparison">
              <div>
                <span className="eyebrow">WITHOUT A SHARED MEMORY</span>
                <div className="fragmented">
                  <span>Explain</span>
                  <span>Explain again</span>
                  <span>Start over</span>
                </div>
              </div>
              <div>
                <span className="eyebrow accent">WITH YOUR MEMORY LAYER</span>
                <div className="continuous">
                  <span>Think</span>
                  <ArrowRight size={16} />
                  <span>Remember</span>
                  <ArrowRight size={16} />
                  <span>Continue</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
      <section className="lifecycle-section">
        <div className="content">
          <div className="section-heading">
            <Eyebrow>02 / FROM CONVERSATION TO CONTINUITY</Eyebrow>
            <span>Less repetition. More forward motion.</span>
          </div>
          <div className="lifecycle-title">
            <h2>
              Not every word.
              <br />
              <em>What matters.</em>
            </h2>
            <p>
              A useful memory is more than a saved transcript. It is a decision,
              a preference, or a piece of context—with the evidence behind it.
            </p>
          </div>
          <div className="lifecycle-grid">
            {[
              {
                n: "01",
                title: "Capture",
                text: "Bring in a conversation you choose. Keep the original messages and their source.",
                icon: FileText,
              },
              {
                n: "02",
                title: "Understand",
                text: "Identify durable context. Surface uncertainty and possible conflicts for review.",
                icon: Layers,
              },
              {
                n: "03",
                title: "Remember",
                text: "Organize approved memories by project, with a history you can inspect.",
                icon: GitBranch,
              },
              {
                n: "04",
                title: "Reuse",
                text: "Make the relevant context available to authorized agents as connections are added.",
                icon: ArrowUpRight,
              },
            ].map(({ n, title, text, icon: Icon }) => (
              <article key={n}>
                <div className="lifecycle-top">
                  <span>{n}</span>
                  <Icon size={21} />
                </div>
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section className="content editorial-section memory-section">
        <div>
          <Eyebrow>03 / A MEMORY YOU CAN INSPECT</Eyebrow>
          <h2>
            Nothing hidden.
            <br />
            Nothing set in stone.
          </h2>
          <p>
            See what was remembered and why. Follow a memory back to its source,
            correct the details, or let it go.
          </p>
          <ul className="check-list">
            <li>
              <Check size={16} /> Source references, not unexplained claims
            </li>
            <li>
              <Check size={16} /> Project context kept in its own scope
            </li>
            <li>
              <Check size={16} /> Review, edit, archive, and delete
            </li>
          </ul>
          <TextLink to="/product">Explore your memory workspace</TextLink>
        </div>
        <div className="memory-preview">
          <div className="preview-header">
            <span>MEMORY DETAIL</span>
            <span className="demo-label">SAMPLE</span>
          </div>
          <div className="preview-content">
            <span className="pill">Preference</span>
            <h3>
              “Keep explanations concise.
              <br />
              Include a practical example.”
            </h3>
            <dl>
              <div>
                <dt>Scope</dt>
                <dd>Personal · All projects</dd>
              </div>
              <div>
                <dt>Evidence</dt>
                <dd>Direct user statement</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>
                  Writing preferences <ArrowUpRight size={13} />
                </dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>
                  <span className="status-dot" /> Approved
                </dd>
              </div>
            </dl>
            <div className="version-line">
              <span />
              <div>
                <strong>Version 1</strong>
                <small>Original statement preserved</small>
              </div>
            </div>
          </div>
        </div>
      </section>
      <section className="content control-section">
        <LockKeyhole size={28} strokeWidth={1.3} />
        <div>
          <Eyebrow>04 / PRIVATE BY DESIGN</Eyebrow>
          <h2>
            Your intelligence.
            <br />
            Your boundaries.
          </h2>
        </div>
        <div>
          <p>
            Choose what you bring in, review what is kept, and control who can
            use it. Capture and agent access are separate permissions.
          </p>
          <TextLink to="/privacy">Read about your data</TextLink>
        </div>
      </section>
      <section className="content closing-cta">
        <Eyebrow>KEEP YOUR TRAIN OF THOUGHT.</Eyebrow>
        <h2>
          Change your tool.
          <br />
          <em>Keep your context.</em>
        </h2>
        <ActionLink to="/signup">Build your memory layer</ActionLink>
        <span className="closing-mark" aria-hidden="true">
          ↗
        </span>
      </section>
    </>
  );
}
