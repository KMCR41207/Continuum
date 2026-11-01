# Architecture and implementation status

> This document records the original website delivery. Its "Next services" and missing-feature statements are historical. The current memory connection architecture, implementation evidence, setup and remaining gaps are in [MEMORY-CONNECTIONS.md](MEMORY-CONNECTIONS.md); that report supersedes this document for memory connections.

## This delivery

The original delivery was a modular React/Vite website with an authenticated Supabase-backed application. The official product name is Continuum. See the current product implementation status for subsequent SaaS services and verification.

`src/pages` contains public and account views; `src/components` owns layout and reusable interactions; `src/lib` owns authentication, database operations, runtime validation, and conservative proposal extraction; `src/config` owns brand, plan, and integration capability metadata; `src/styles` owns design tokens and responsive styling. `supabase/migrations` is the database source of truth. Tests live separately in `tests/unit` and `tests/browser`.

## Data boundaries

Browser → Supabase Auth for registration, password sign-in, password reset, and session refresh. Browser → Supabase Data API under the user's verified JWT for workspace data. The publishable/anon key is intentionally public; no service-role credential belongs in this website. PostgreSQL RLS verifies membership on every exposed table. Column grants restrict editable fields; source creation occurs only through a checked transaction function.

Conversation JSON → Zod validation → exact content hash → conservative proposal extraction → atomic database import. Candidates only quote user messages and are always pending review. Import RPC verifies every proposal has matching user-message evidence; clients cannot use it to insert active memories. Duplicate text links to the existing memory rather than creating another. The database preserves previous memory versions on every change and creates audit events without conversation contents.

Conflicts are not automatically resolved. Semantic deduplication, vectors, LLM extraction, entity relationships, and background retries are not implemented. Source text stays intact even when no rule identifies a durable statement. Database transaction failure rolls back the whole import and is reported to the user; the import form retains its input for retry.

## Ownership and deletion

Workspaces are created with their authenticated owner as a member. Editors may modify project and memory content; viewers can read only. Team invitation UI is not implemented. Existing owner identity and workspace IDs cannot be changed through browser column grants.

Deleting a memory deletes its versions and source references. Deleting a conversation deletes its messages and **all memories derived from it**, including their versions, even if those memories also have other sources. The confirmation and privacy disclosure state this conservative policy. Project deletion is restricted while linked conversations or memories exist; archiving is supported. Account deletion is not implemented.

## Next services

Move this web application into `apps/web` when implementing the remaining master phases. Add dedicated `apps/api`, `apps/worker`, `apps/mcp-server`, `apps/browser-extension`, and `apps/cli`, with shared validators, database, auth, embeddings, integration, and memory-engine packages. Use current split MCP SDK v2 packages and HTTP transport. Add server-side scoped token validation, revocation, permission checks, and real-client tests before claiming connectivity. Introduce Redis/BullMQ for durable jobs and a vector migration matching the chosen embedding dimensions. Capture and retrieval remain independent permission paths.

Dray is a functional reference, not an integration dependency. Chat linking, handoffs, history backfill, browser capture, and agent lifecycle hooks remain future work. Do not copy its claims of platform support into this build.

## Dependencies requiring external setup

- Supabase project URL, publishable key, applied migration, allowed redirects, email delivery configuration.
- Licensed Relona WOFF2 files. No asset was provided; Georgia is the explicit development fallback. No fake font-face exists.
- Stripe credentials and approved commercial plan configuration; billing is unavailable.
- Provider authorization and real sessions for capture/agent verification.
- Operator contact details and final legal policies before public release.

## Documentation reviewed

Official references reviewed during the session include React, Vite, TypeScript, React Router, Supabase Auth/RLS/pgvector, MCP SDK v2 and the 2026-07-28 specification, Chrome MV3 worker lifecycle, Stripe Billing, Claude Code hooks, pnpm, Vitest, Playwright, and Zod. Versions resolved from the npm registry are locked in `pnpm-lock.yaml`.

- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/reference/javascript/auth-signup
- https://ts.sdk.modelcontextprotocol.io/v2/serving/fastify.html
- https://modelcontextprotocol.io/specification/2026-07-28
- https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
- https://docs.stripe.com/billing
- https://code.claude.com/docs/en/hooks
- https://react.dev/learn
- https://vite.dev/guide/
- https://reactrouter.com/start/declarative/installation
- https://zod.dev/
- https://vitest.dev/guide/
- https://playwright.dev/docs/intro
- https://pglite.dev/docs/
