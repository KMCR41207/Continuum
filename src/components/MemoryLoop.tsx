import { useState } from "react";
import {
  ArrowRight,
  Check,
  FileText,
  RotateCcw,
  Database,
  Search,
} from "lucide-react";
import { Modal } from "./ui";
const steps = ["Conversation", "Capture", "Extract", "Retrieve"];
export function MemoryLoop() {
  const [step, setStep] = useState(0);
  const [source, setSource] = useState(false);
  return (
    <div className="memory-loop">
      <div className="loop-header">
        <span>
          <span className="status-dot" /> THE MEMORY LOOP
        </span>
        <span className="demo-label">INTERACTIVE EXAMPLE</span>
      </div>
      <div className="loop-body">
        <div className="loop-origin">
          <span className="platform-symbol">C</span>
          <div>
            <strong>Development conversation</strong>
            <span>ChatGPT · Project Atlas</span>
          </div>
          <span className="loop-number">01</span>
        </div>
        <blockquote>
          “Let’s use PostgreSQL for the new project because we need relational
          data and transactional consistency.”
        </blockquote>
        <div className={`flow-connector ${step > 0 ? "complete" : ""}`}>
          <span />
          <small>
            {step > 0
              ? "Captured with source evidence"
              : "A decision worth remembering"}
          </small>
          <span />
        </div>
        <div className={`extracted-memory ${step >= 2 ? "revealed" : ""}`}>
          <div className="memory-type">
            <Database size={14} />
            <span>PROJECT DECISION</span>
            {step >= 2 && <Check size={15} />}
          </div>
          <p>
            {step >= 2
              ? "PostgreSQL is the selected database for Project Atlas."
              : "The useful context, separated from the conversation."}
          </p>
          <div className="memory-tags">
            <span>
              {step >= 2 ? "Confirmed decision" : "Awaiting extraction"}
            </span>
            <button onClick={() => setSource(true)}>
              <FileText size={12} /> View source
            </button>
          </div>
        </div>
        <div className={`retrieval-row ${step === 3 ? "retrieved" : ""}`}>
          <span className="platform-symbol code">&gt;_</span>
          <div>
            <strong>
              {step === 3
                ? "Context received. Work continues."
                : "Next stop: Claude Code"}
            </strong>
            <span>
              {step === 3
                ? "PostgreSQL · Project Atlas · Source included"
                : "The right memory, in a different tool."}
            </span>
          </div>
          {step === 3 ? <Check size={18} /> : <ArrowRight size={18} />}
        </div>
      </div>
      <div className="loop-footer">
        <div className="step-dots" aria-label={`Step ${step + 1} of 4`}>
          {steps.map((s, i) => (
            <button
              key={s}
              aria-label={`Show ${s} step`}
              aria-current={i === step ? "step" : undefined}
              className={i <= step ? "active" : ""}
              onClick={() => setStep(i)}
            />
          ))}
        </div>
        <button className="loop-action" onClick={() => setStep((step + 1) % 4)}>
          {
            [
              "Capture conversation",
              "Inspect extracted memory",
              "Ask another agent",
              "Replay the loop",
            ][step]
          }
          {step === 3 ? (
            <RotateCcw size={14} />
          ) : step === 2 ? (
            <Search size={14} />
          ) : (
            <ArrowRight size={14} />
          )}
        </button>
      </div>
      <p className="demo-note">
        Sample data only. Nothing is saved to your account.
      </p>
      {source && (
        <Modal title="Original source" onClose={() => setSource(false)}>
          <div className="modal-body">
            <p className="eyebrow">DEMO · CHATGPT · PROJECT ATLAS</p>
            <blockquote>
              Let’s use PostgreSQL for the new project because we need
              relational data and transactional consistency.
            </blockquote>
            <p>
              This sample memory points back to the exact statement that
              supports it. Your own records retain their conversation and
              message references.
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}
