import { useState } from "react";
import {
  ArrowUpRight,
  Check,
  Search,
  BookOpen,
  Code2,
  ShieldCheck,
} from "lucide-react";
import { Link } from "react-router-dom";
import { ActionLink, Eyebrow, Modal, Notice, TextLink } from "../components/ui";
import { integrations } from "../config/integrations";
import { plans } from "../config/brand";
import { WorkflowShowcase } from "../components/immersive/WorkflowShowcase";
import { MemorySpiral } from "../components/immersive/MemorySpiral";
import { IntegrationOrbit } from "../components/immersive/IntegrationOrbit";
import { ArchitectureExplorer } from "../components/immersive/ArchitectureExplorer";
export function Product() {
  return (
    <div className="content inner-page">
      <Eyebrow>THE PRODUCT / YOUR CONTEXT, CONNECTED</Eyebrow>
      <h1>
        A place for everything
        <br />
        <em>worth remembering.</em>
      </h1>
      <p className="page-intro">
        Conversations are where ideas begin. Your memory workspace is where the
        useful parts become something you can carry forward.
      </p>
      <ActionLink to="/docs#setup">Read the setup guide</ActionLink>
      <WorkflowShowcase />
      <MemorySpiral />
      <div className="product-feature-list">
        {[
          [
            "01",
            "A conversation is a source.",
            "Import the messages you choose. Preserve their original wording and keep a traceable path from every proposed memory back to its evidence.",
          ],
          [
            "02",
            "A memory is a useful detail.",
            "Separate decisions, preferences, goals, and instructions from the surrounding conversation. The initial conservative extractor proposes direct user statements for your approval.",
          ],
          [
            "03",
            "A project gives it context.",
            "Keep instructions and decisions attached to the work they belong to. A project-specific exception should not erase your global preference.",
          ],
          [
            "04",
            "You make the final call.",
            "Inspect proposed memories, correct their wording, approve them, or reject them. Editing keeps a version history. Archiving makes a memory inactive without deleting its history.",
          ],
          [
            "05",
            "Continuity needs permission.",
            "Capture and retrieval are independently controlled. Scoped agent access is implemented through a local MCP server; live provider sessions remain unverified.",
          ],
        ].map(([n, t, d]) => (
          <article key={n}>
            <span className="eyebrow">{n}</span>
            <h2>{t}</h2>
            <p>{d}</p>
          </article>
        ))}
      </div>
      <div className="inline-cta">
        <h2>Your work, with its backstory.</h2>
        <ActionLink to="/docs#setup">Connection setup</ActionLink>
      </div>
    </div>
  );
}
export function Integrations() {
  const [filter, setFilter] = useState("All");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<
    (typeof integrations)[number] | null
  >(null);
  const shown = integrations.filter(
    (i) =>
      (filter === "All" || i.capability === filter) &&
      i.name.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="content inner-page">
      <Eyebrow>INTEGRATIONS / TWO DIRECTIONS, ONE MEMORY</Eyebrow>
      <h1>
        Your tools.
        <br />
        <em>A common thread.</em>
      </h1>
      <p className="page-intro">
        Bring conversations in. Give authorized agents context out. Every
        connection tells you exactly which direction it supports.
      </p>
      <IntegrationOrbit />
      <div className="capability-note">
        <div>
          <span>01 / CAPTURE</span>
          <p>
            Imports, extensions, and supported hooks bring source information
            into your workspace.
          </p>
        </div>
        <div>
          <span>02 / RETRIEVAL</span>
          <p>
            MCP and API connections let agents request context. They do not
            automatically read your chats.
          </p>
        </div>
      </div>
      <div className="filter-bar">
        <div className="segmented">
          {["All", "Manual import", "Conversation capture", "Agent access"].map(
            (f) => (
              <button
                className={f === filter ? "selected" : ""}
                key={f}
                onClick={() => setFilter(f)}
              >
                {f}
              </button>
            ),
          )}
        </div>
        <label className="search-field">
          <Search size={16} />
          <input
            aria-label="Search integrations"
            placeholder="Find your tool"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      <div className="integration-grid">
        {shown.map((i) => (
          <button
            key={i.id}
            className="integration-item"
            onClick={() => setSelected(i)}
          >
            <div className="integration-top">
              <span className={`integration-mark mark-${i.id}`}>{i.mark}</span>
              <span className="pill">{i.status}</span>
            </div>
            <h2>{i.name}</h2>
            <p>{i.description}</p>
            <div className="integration-bottom">
              <span>{i.capability}</span>
              <ArrowUpRight size={17} />
            </div>
          </button>
        ))}
      </div>
      {shown.length === 0 && (
        <p className="empty">No integrations match your search.</p>
      )}
      <Notice>
        Availability is specific to this build. Planned connections are not
        active or tested against providers.
      </Notice>
      {selected && (
        <Modal title={selected.name} onClose={() => setSelected(null)}>
          <div className="modal-body">
            <span className="pill">{selected.status}</span>
            <h3>{selected.capability}</h3>
            <p>{selected.setup}</p>
            {selected.id !== "import" && (
              <>
                <table>
                  <tbody>
                    {[
                      ["Native OAuth", "Unavailable"],
                      ["Official provider API", "No capture adapter configured"],
                      [
                        "Explicit conversation import",
                        "Normalized JSON; locally tested",
                      ],
                      ["Browser-extension capture", "Unavailable"],
                      [
                        "Local MCP retrieval",
                        "Protocol tested; provider session unverified",
                      ],
                      [
                        "Remote MCP retrieval",
                        "HTTP protocol tested locally; HTTPS hosting required",
                      ],
                      [
                        "Memory writing",
                        "Scoped proposals with review; provider session unverified",
                      ],
                    ].map(([capability, state]) => (
                      <tr key={capability}>
                        <th scope="row">{capability}</th>
                        <td>{state}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {"mcpConfig" in selected && selected.mcpConfig && (
                  <>
                    <h4>MCP client config</h4>
                    <p>Add this to your client's MCP configuration. Replace the path and environment values with your own.</p>
                    <pre style={{ fontSize: "11px", overflowX: "auto", background: "#10141d", color: "#dae3f1", padding: "12px", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                      <code>{selected.mcpConfig}</code>
                    </pre>
                  </>
                )}
                {"captureMethod" in selected && selected.captureMethod && (
                  <>
                    <h4>Conversation capture</h4>
                    <p>{selected.captureMethod}</p>
                  </>
                )}
              </>
            )}
            <TextLink
              to={selected.id === "import" ? "/app/conversations" : "/docs"}
            >
              {selected.id === "import"
                ? "Open conversation imports"
                : "Read implementation status"}
            </TextLink>
          </div>
        </Modal>
      )}
    </div>
  );
}
export function Pricing() {
  return (
    <div className="content inner-page">
      <Eyebrow>PRICING / ROOM TO REMEMBER</Eyebrow>
      <h1>
        Start with your work.
        <br />
        <em>Grow with your context.</em>
      </h1>
      <p className="page-intro">
        A configurable plan structure for individual and shared memory. Prices
        and paid entitlements have not been finalized.
      </p>
      <Notice>
        Pre-launch pricing. Checkout is unavailable until Stripe credentials,
        product prices, and server-side billing are configured.
      </Notice>
      <div className="pricing-grid">
        {plans.map((p, i) => (
          <article key={p.id} className={i === 1 ? "plan featured" : "plan"}>
            <div className="plan-kicker">
              {i === 1 ? "EVERYDAY CONTINUITY" : "YOUR MEMORY LAYER"}
            </div>
            <h2>{p.name}</h2>
            <p>{p.description}</p>
            <div className="plan-price">To be announced</div>
            <span className="small-text">
              Capacity and entitlements require operator configuration.
            </span>
            <ul className="check-list">
              {p.features.map((f) => (
                <li key={f}>
                  <Check size={15} />
                  {f}
                </li>
              ))}
            </ul>
            <Link className="button secondary" to="/app/billing">
              View billing setup
            </Link>
          </article>
        ))}
      </div>
      <div className="faq">
        <h2>A few practical details.</h2>
        {[
          [
            "Can I create an account?",
            "Yes, once Supabase is configured. Paid plans activate only after configured Stripe checkout and verified subscription events.",
          ],
          [
            "Does a plan connect every AI automatically?",
            "No. Each integration requires a supported connection method and your authorization. Check the integrations directory for current capabilities.",
          ],
          [
            "Can I take my data with me?",
            "The authenticated settings page exports workspace records as JSON. You can also delete memories and imported conversations.",
          ],
          [
            "Are these final limits?",
            "No. Plan capacities are centrally configured proposals, not confirmed commercial promises.",
          ],
        ].map(([q, a]) => (
          <details key={q}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </div>
    </div>
  );
}
const importExample = JSON.stringify(
  {
    title: "Database decision",
    platform: "ChatGPT",
    messages: [
      {
        role: "user",
        content: "We decided to use PostgreSQL for the application database.",
      },
      {
        role: "assistant",
        content: "I will use PostgreSQL in the implementation plan.",
      },
    ],
  },
  null,
  2,
);
export function Developers() {
  return (
    <div className="content inner-page">
      <Eyebrow>DEVELOPERS / CONTEXT AS INFRASTRUCTURE</Eyebrow>
      <h1>
        Build on memory.
        <br />
        <em>Keep the evidence.</em>
      </h1>
      <p className="page-intro">
        The website uses Supabase Auth and PostgreSQL with tenant-scoped access.
        Scoped RPC access, a local MCP server, and a coding-agent CLI share
        database-enforced permissions. Remote MCP hosting is not included.
      </p>
      <ArchitectureExplorer />
      <WorkflowShowcase developer />
      <div className="developer-layout" data-aos="fade-up">
        <div>
          <Code2 size={26} />
          <h2>
            A clear boundary
            <br />
            between source and memory.
          </h2>
          <p>
            Conversation imports are validated before they are saved. Original
            messages remain separate from proposed memories. User-approved
            memories can be edited without erasing their previous versions.
          </p>
          <TextLink to="/docs">Read the setup guide</TextLink>
        </div>
        <div className="code-block">
          <div>
            SUPPORTED IMPORT FORMAT <span>JSON</span>
          </div>
          <pre>
            <code>{importExample}</code>
          </pre>
        </div>
      </div>
      <div className="implementation-table">
        <h2>What is implemented?</h2>
        <table>
          <thead>
            <tr>
              <th>Interface</th>
              <th>Current status</th>
              <th>Authorization</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Web application → database</td>
              <td>Supabase client and migrations</td>
              <td>Verified session + RLS</td>
            </tr>
            <tr>
              <td>Conversation JSON import</td>
              <td>Implemented, configuration required</td>
              <td>Workspace membership</td>
            </tr>
            <tr>
              <td>Memory review and history</td>
              <td>Implemented, configuration required</td>
              <td>Workspace membership</td>
            </tr>
            <tr>
              <td>Local MCP tools</td>
              <td>Tested with an SDK client; provider sessions unverified</td>
              <td>Revocable scoped tokens</td>
            </tr>
            <tr>
              <td>Supabase RPC and CLI</td>
              <td>Implemented; database setup required</td>
              <td>Revocable scoped tokens</td>
            </tr>
          </tbody>
        </table>
      </div>
      <Notice>
        Create agent credentials in Connections after database setup. Configure
        the local MCP server with your own Supabase endpoint. No hosted remote
        MCP endpoint or provider OAuth is supplied.
      </Notice>
    </div>
  );
}
export function Docs() {
  return (
    <div className="content inner-page docs-page">
      <Eyebrow>DOCUMENTATION / GETTING STARTED</Eyebrow>
      <h1>
        A little setup.
        <br />
        <em>A lasting foundation.</em>
      </h1>
      <div className="docs-layout">
        <aside>
          <a href="#setup">01 — Configure the service</a>
          <a href="#account">02 — Create your workspace</a>
          <a href="#import">03 — Import a conversation</a>
          <a href="#review">04 — Review your memory</a>
          <a href="#limits">05 — Current boundaries</a>
        </aside>
        <div>
          <section id="setup">
            <BookOpen size={23} />
            <h2>Configure the service</h2>
            <p>
              Create a Supabase project. Apply all SQL migrations in order from{" "}
              <code>supabase/migrations</code>, then set{" "}
              <code>VITE_SUPABASE_URL</code> and{" "}
              <code>VITE_SUPABASE_ANON_KEY</code> in your local{" "}
              <code>.env</code>. Use only the publishable or anon key in the
              browser.
            </p>
            <p>
              Configure your site URL and authentication redirect URLs in
              Supabase. Enable email confirmation and configure an email
              delivery provider for production. Restart the development server
              after changing environment variables.
            </p>
          </section>
          <section id="account">
            <h2>Create your workspace</h2>
            <p>
              Register with your email, follow the confirmation link, and sign
              in. Onboarding creates a private workspace and saves your review
              preferences. You can skip integrations and return to them later.
            </p>
            <ActionLink to="/integrations">Review connection options</ActionLink>
          </section>
          <section id="import">
            <h2>Import a conversation</h2>
            <p>
              Open Conversations → Import. Paste normalized JSON using this
              format. Only import conversations you have permission to store.
              Provider export archives need conversion into this format first.
            </p>
            <pre className="standalone-code">
              <code>{importExample}</code>
            </pre>
            <p>
              Each import uses a content hash to prevent exact duplicates. The
              initial extractor proposes direct user statements; it is
              deliberately conservative and does not provide LLM-level
              understanding.
            </p>
          </section>
          <section id="review">
            <h2>Review what matters</h2>
            <p>
              Open the review queue in Memories. Read each proposed memory
              alongside its source, edit it if needed, then approve or reject
              it. Sensitive candidates remain flagged. Archived and rejected
              memories are excluded from the active memory list.
            </p>
          </section>
          <section id="limits">
            <h2>Current boundaries</h2>
            <p>
              This website phase includes authentication wiring, workspace and
              project management, imports, conservative memory proposals,
              reviews, version history, activity, and JSON export. Live database
              verification requires a configured Supabase project.
            </p>
            <p>
              Browser capture, automatic provider feeds and provider OAuth
              remain unavailable. Semantic indexing requires an embedding
              provider and opt-in; durable jobs require a running worker. Team
              invitation links, billing and account deletion now have backend
              implementations; live delivery, transactions and deployment
              require external configuration.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
export function Policy({
  type,
}: {
  type: "privacy" | "terms" | "security" | "contact";
}) {
  const content = {
    privacy: {
      title: "Your data. Your decisions.",
      intro: "How this build handles information, in plain language.",
      sections: [
        [
          "What is stored",
          "Your account is managed by Supabase Auth. Workspaces contain the conversations you import, their messages, project information, memory proposals, approved memories, version history, and an activity log.",
        ],
        [
          "Where data goes",
          "With Supabase configured, application records are sent to your configured Supabase project. The conservative extractor runs locally in your browser; this build does not send your conversations to an external AI model.",
        ],
        [
          "Control and deletion",
          "You can export workspace data and delete sources and derived memories. Server-side account deletion requires password reauthentication, transfer of shared-workspace ownership and cancellation of subscriptions. Legal and operator policies remain drafts for review.",
        ],
        [
          "Production policy required",
          "This is a technical disclosure for a development build, not a final legal privacy policy. Before launch, the operator must supply its identity, contact details, hosting regions, retention schedule, and applicable legal disclosures.",
        ],
      ],
    },
    terms: {
      title: "Clear expectations.",
      intro: "Development terms and service boundaries.",
      sections: [
        [
          "Pre-launch software",
          "This project is a development build. No paid subscription can be purchased. Published plan capacities are proposed and configurable.",
        ],
        [
          "Your responsibilities",
          "Only import information you are authorized to store. Review extracted memories before relying on them: extraction can omit context or misunderstand meaning.",
        ],
        [
          "Before commercial launch",
          "A final service agreement must identify the operator and jurisdiction, acceptable use, liability, support, billing, and cancellation terms. Those details have not been supplied.",
        ],
      ],
    },
    security: {
      title: "Trust needs a foundation.",
      intro: "The security model, and what still needs verification.",
      sections: [
        [
          "Identity and tenant boundaries",
          "Supabase verifies identity. PostgreSQL row-level policies use workspace membership rather than trusting workspace identifiers supplied by the browser. Server secrets are never required by the website.",
        ],
        [
          "Treat content as data",
          "Conversation content is rendered as text and passed through a deterministic proposal extractor. It cannot instruct the application to execute code or bypass access controls.",
        ],
        [
          "Sensitive information",
          "Simple patterns flag possible secrets and personal contact information for review. Detection is not exhaustive. Do not import credentials or information you are not authorized to process.",
        ],
        [
          "Release verification",
          "Production release requires live RLS and multi-user tests, deployment security review, backup and recovery checks, and verification of provider connections. No security certification is claimed.",
        ],
      ],
    },
    contact: {
      title: "A useful conversation starts here.",
      intro: "Support and operator details have not yet been configured.",
      sections: [
        [
          "Need setup help?",
          "The documentation includes environment configuration, imports, and the current implementation boundaries. The project README contains local development and deployment instructions.",
        ],
        [
          "Contact availability",
          "No support email address or delivery service has been supplied. This page does not collect or pretend to send support messages. Add verified operator contact details before public launch.",
        ],
      ],
    },
  }[type];
  return (
    <div className="content inner-page policy-page">
      <Eyebrow>{type.toUpperCase()} / TRANSPARENCY FIRST</Eyebrow>
      <h1>{content.title}</h1>
      <p className="page-intro">{content.intro}</p>
      {content.sections.map(([h, p]) => (
        <section key={h}>
          <ShieldCheck size={20} />
          <div>
            <h2>{h}</h2>
            <p>{p}</p>
          </div>
        </section>
      ))}
      <TextLink to="/docs">Open documentation</TextLink>
    </div>
  );
}
