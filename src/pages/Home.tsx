import { ArrowRight, ArrowUpRight, Check, LockKeyhole } from "lucide-react";
import { Link } from "react-router-dom";
import { ActionLink, Eyebrow, TextLink } from "../components/ui";
import { MemoryLoop } from "../components/MemoryLoop";
import { ContinuityStory } from "../components/ContinuityStory";
import { MemoryCore } from "../components/immersive/MemoryCore";
import { WorkflowShowcase } from "../components/immersive/WorkflowShowcase";
import { selfHosted } from "../lib/localBackend";
export function Home() {
  return (
    <div className="home-page">
      <div className="content home-masthead">
        <span>A PERSONAL MEMORY LAYER FOR AI</span>
        <span>
          YOUR THINKING, WITH A THROUGH LINE <ArrowUpRight size={13} />
        </span>
      </div>
      <section className="hero content">
        <div className="hero-copy">
          <Eyebrow>
            <span className="tiny-cross">+</span> EVERY AI STARTS FRESH. YOU
            SHOULDN’T HAVE TO.
          </Eyebrow>
          <h1>
            <span className="title-line">Good thinking</span>{" "}
            <span className="title-line">deserves</span>{" "}
            <em className="title-line">a longer life.</em>
          </h1>
          <p className="hero-description">
            Keep your conversations, decisions, preferences, and project
            knowledge connected across the AI tools you use.
          </p>
          <div className="hero-actions">
            <ActionLink to={selfHosted ? "/app" : "/docs#setup"}>
              {selfHosted ? "Open workspace" : "Connection setup"}
            </ActionLink>
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
            <span>THE LIVING ARCHIVE</span>
            <span>FIG. 01 ↘</span>
          </div>
          <div className="archive-path" aria-hidden="true">
            <span>
              01 <b>Source</b>
            </span>
            <i />
            <span>
              02 <b>Memory</b>
            </span>
            <i />
            <span>
              03 <b>Continuity</b>
            </span>
          </div>
          <MemoryCore compact />
          <div className="visual-caption">
            <span className="caption-line" />
            <span>
              Try the loop. One decision, a different agent.
              <br />
              See what gets carried forward.
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
      <div className="scroll-ticker" aria-hidden="true">
        <div className="ticker-track">
          A thought. <em>A thread.</em> A through line. <span>↗</span> A
          thought. <em>A thread.</em> A through line. <span>↗</span>
        </div>
      </div>
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
          <h2 className="scroll-ink">
            {"Your best thinking shouldn’t live in separate tabs."
              .split(" ")
              .map((word, index) => (
                <span key={index}>
                  <span className="ink-word">{word}</span>{" "}
                </span>
              ))}
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
      <ContinuityStory />
      <div className="content">
        <WorkflowShowcase />
      </div>
      <section className="content interactive-loop-section">
        <div data-aos="fade-right">
          <span className="eyebrow">TRY IT / SAMPLE WORKFLOW</span>
          <h2>
            Follow the evidence.
            <br />
            Make the next move.
          </h2>
          <p>
            Step through a conversation becoming reusable context. This
            interactive example uses sample data only.
          </p>
        </div>
        <MemoryLoop />
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
          <div className="archive-tab">
            A RECORD, NOT A BLACK BOX <span>↓</span>
          </div>
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
      <section className="closing-band">
        <div className="content closing-cta">
          <Eyebrow>KEEP YOUR TRAIN OF THOUGHT.</Eyebrow>
          <h2>
            Change your tool.
            <br />
            <em>Keep your context.</em>
          </h2>
          <ActionLink to="/docs#setup">Read the setup guide</ActionLink>
          <p className="closing-note">
            Start with one conversation.
            <br />
            Keep the parts that make the next one better.
          </p>
          <span className="closing-mark" aria-hidden="true">
            ↗
          </span>
        </div>
      </section>
    </div>
  );
}
