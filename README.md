# Continuum

## Run the self-hosted platform

The new FastAPI/SQLite/Chroma mode runs locally without Supabase. After installing Python 3.12 and uv, run `uv sync --locked --extra test --extra local-model` from `services/memory-api`, then `uv run --no-sync python -m app.admin prepare-model`. Return to the repository root and run `pnpm selfhosted`. Choose **Open workspace**, create your local administrator, and use the existing Projects, Conversations, Memories and Connections pages. Run `uv run --no-sync python -m app.worker` from the service directory for background processing.

See the [self-hosted quick start, API, MCP, deployment and privacy guide](services/memory-api/README.md), [integration/migration decisions](docs/SELF-HOSTED-INTEGRATION.md), and [browser-extension instructions](apps/browser-extension/README.md). The Supabase setup below remains a separate supported deployment mode. There are no dual writes between these modes.

Project folder: `C:\Users\ksair\continuum mani`.

Continuum is a user-controlled memory layer for AI assistants and coding agents. This repository includes the React application, Supabase schema/RPCs, local and HTTP MCP transports, CLI, durable worker, optional semantic retrieval, team management and billing/account API. See the [product audit](PRODUCT-IMPLEMENTATION-AUDIT.md), [current implementation status](PRODUCT-IMPLEMENTATION-STATUS.md) and [operations guide](docs/OPERATIONS.md). Live Supabase/provider accounts, payments and embedding models have not been connected.

## Run locally

```powershell
cd 'C:\Users\ksair\continuum mani'
pnpm install
pnpm dev
```

Open the address printed by Vite (normally http://localhost:5173). The public site works without credentials. Accounts and persisted workspace operations require the configuration below. The only sample data is the clearly labeled public Memory Loop and product examples.

## Enable real accounts and data

1. Create a Supabase project and apply migrations **001–006** in filename order. Existing installations through 003 need 004–006. Migration 005 requires pgvector in the `extensions` schema. Back up first; see the operations guide for migration/recovery instructions.
2. Copy `.env.example` to `.env`. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to the project's URL and publishable/anon key. Never use the service-role key in `VITE_*` variables.
3. Set your local or production URL in Supabase Auth. Allow `/app` and `/auth/password` redirects for your site. Keep email confirmation enabled; configure production email delivery before launch.
4. Optionally configure the Google provider and set `VITE_GOOGLE_AUTH_ENABLED=true`.
5. Restart Vite, register, confirm your email, sign in, and create a workspace.
6. Complete or skip/resume onboarding, create a project, import authorized normalized JSON, and review memories. Connections never enable capture or broad access automatically.
7. For application services, create a private `.env.server` using the server-only names in `.env.example`; run `pnpm api` and `pnpm worker`. Set public `VITE_API_URL` to the API origin. Configure Stripe and embeddings only when their credentials and approved terms are available.
8. For HTTP MCP, run `node server/http.ts` with a separate environment containing the public Supabase URL/key and host/origin settings, then expose it behind HTTPS. Clients supply an owner-issued token as `Authorization: Bearer ...`. The bridge does not implement an OAuth authorization server.

## Implemented website

Public: homepage, interactive Memory Loop, product, integration directory with search/filter/details, pricing, developers, documentation, privacy disclosure, draft terms, security, contact configuration state.

Account: sign-up/sign-in/reset flows wired to Supabase; protected workspace shell; workspace creation; overview database counts; memory search/category/project/status filters and pagination; review/edit/approve/archive/restore/delete; source evidence and previous versions; conversation JSON import/archive/detail/delete/exclusion; project create/edit/archive/delete; real audit events; profile/workspace settings; JSON export.

Connections and Agents manage owner-issued scoped credentials, independent permissions, project/history allowlists, validation, rotation, revocation and import activity. Projects support reviewed destination-specific handoffs. Usage, Billing, Team, Processing jobs, Security and data, and resumable onboarding are implemented. Stripe can create real checkout/portal sessions **only when configured**; no transaction has been run here. Public policies remain drafts. Licensed Relona font assets are still required; Georgia remains the explicit fallback.

## Verification

```powershell
pnpm build
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
pnpm test:connections-ui
```

Public browser tests expect no Supabase environment variables. Product browser tests start their own explicitly configured fixture server. Database tests execute the migrations in PGlite/pgvector with a test-only identity shim; real SDK clients exercise stdio and HTTP MCP. Current results: **44 database/unit/protocol tests, 40 browser tests, and production build pass**. Hosted signup, email delivery, Stripe transactions and live model/provider sessions remain unverified.

The [immersive architecture guide](docs/IMMERSIVE-ARCHITECTURE.md) documents AOS, GSAP/ScrollTrigger, Three.js, all ten adapted scroll techniques, real-record relationship explorers, mobile alternatives, and remaining limits. The [original design guide](docs/DESIGN-IMPLEMENTATION.md) records the living-archive art direction and local textures. The public suite includes 32 checks for routes, demo interactions, 3D controls, motion reversal, anchors, download failure, and responsive behavior; the authenticated UI suite includes 8 checks. Screenshots are saved locally in `artifacts/design/`.

## Deploy the website

Run `pnpm build` and publish `dist` with an HTTPS static hosting service. Set public Supabase variables **at build time**. Configure SPA fallback to `/index.html` for all application paths, and update Supabase site/redirect URLs. `public/_redirects` provides a Netlify-compatible fallback. Do not deploy `node_modules`, `.env`, or development test data. Do not advertise production readiness before the remaining checks and backend phases are complete.

## Remaining scope

Public deployment, OAuth-only MCP client support, automatic provider feeds/browser capture, native export adapters, actual embedding/model evaluation, SMTP invitation delivery, approved commercial/legal configuration and external acceptance testing remain. The relevant underlying HTTP, semantic, queue, billing, team, quota and deletion architecture is implemented locally. No named provider integration is presented as live-tested. See the final status matrix for exact limitations.
