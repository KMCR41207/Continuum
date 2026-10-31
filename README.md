# Universal AI memory — website phase

Project folder: `C:\Users\ksair\continuum mani`.

This repository includes the website, Supabase-backed account application, scoped memory RPC, local MCP server and CLI. The cross-platform memory workflow is tested with PostgreSQL and an actual MCP SDK client. Live provider sessions and hosted Supabase deployment are not verified. See [memory connection report and setup](docs/MEMORY-CONNECTIONS.md).

## Run locally

```powershell
cd 'C:\Users\ksair\continuum mani'
pnpm install
pnpm dev
```

Open the address printed by Vite (normally http://localhost:5173). The public site works without credentials. Accounts and persisted workspace operations require the configuration below. The only sample data is the clearly labeled public Memory Loop and product examples.

## Enable real accounts and data

1. Create a Supabase project and apply every SQL file in `supabase/migrations` in filename order. Existing installations with migration 001 need migrations 002 and 003.
2. Copy `.env.example` to `.env`. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to the project's URL and publishable/anon key. Never use the service-role key in `VITE_*` variables.
3. Set your local or production URL in Supabase Auth. Allow `/app` and `/auth/password` redirects for your site. Keep email confirmation enabled; configure production email delivery before launch.
4. Optionally configure the Google provider and set `VITE_GOOGLE_AUTH_ENABLED=true`.
5. Restart Vite, register, confirm your email, sign in, and create a workspace.
6. Create a project, import normalized conversation JSON, and review proposed memories. See `/docs` for the format.

## Implemented website

Public: homepage, interactive Memory Loop, product, integration directory with search/filter/details, pricing, developers, documentation, privacy disclosure, draft terms, security, contact configuration state.

Account: sign-up/sign-in/reset flows wired to Supabase; protected workspace shell; workspace creation; overview database counts; memory search/category/project/status filters and pagination; review/edit/approve/archive/restore/delete; source evidence and previous versions; conversation JSON import/archive/detail/delete/exclusion; project create/edit/archive/delete; real audit events; profile/workspace settings; JSON export.

Connections and Agents manage owner-issued scoped credentials, independent permissions, project/history allowlists, validation, rotation, revocation and import activity. Projects support source-linked handoffs. Billing does not issue charges. Public policy pages are development disclosures, not final legal documents. Fonts use the designated Relona token with a disclosed Georgia fallback until licensed assets are supplied in `public/fonts`.

## Verification

```powershell
pnpm build
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
pnpm test:connections-ui
```

Browser tests expect no Supabase environment variables so they can verify configuration-required behavior. Database unit tests use isolated PostgreSQL through PGlite with a test-only `auth.uid()` shim. This verifies SQL semantics and permissions, not live Supabase Auth or delivery. Live signup, mail verification, and full authenticated browser acceptance remain unverified until credentials are supplied.

## Deploy the website

Run `pnpm build` and publish `dist` with an HTTPS static hosting service. Set public Supabase variables **at build time**. Configure SPA fallback to `/index.html` for all application paths, and update Supabase site/redirect URLs. `public/_redirects` provides a Netlify-compatible fallback. Do not deploy `node_modules`, `.env`, or development test data. Do not advertise production readiness before the remaining checks and backend phases are complete.

## Remaining scope

Remote MCP hosting/OAuth, semantic model embeddings, general conflict reasoning, automatic browser/provider capture, native provider export adapters, durable background sync, team management, retention jobs, account deletion, usage-based quotas, and Stripe billing remain outside the implemented path. No named provider integration is presented as live-tested. See `docs/MEMORY-CONNECTIONS.md` for evidence, limits and exact setup.
