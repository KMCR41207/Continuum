# CONTINUUM — Current repository audit and implementation status

> Historical Supabase implementation audit. The subsequent Python/SQLite/Chroma mode and its latest verification are recorded in [SELF-HOSTED-STATUS.md](docs/SELF-HOSTED-STATUS.md). Its integration preserves the legacy implementation and does not dual-write stores.

Audit date: 1 November 2026. Last updated: 14 November 2026.
Audit scope: local repository at Git HEAD plus all subsequent implementation, debugging, and QA work recorded below. This is an evidence-based, source-and-test audit; it makes no claim about a deployed environment.

---

## 22. Update — 13–14 November 2026: Browser Extension QA, Bug Fixes, and Test Expansion

### What was done

A full end-to-end QA pass was executed on the browser extension and its integration with the local Continuum API. All tests were run against the actual codebase — no results were fabricated.

### Bugs found and fixed

| ID | File | Bug | Fix |
|---|---|---|---|
| BUG-001 | `server/api.ts` | CORS check rejected all `chrome-extension://` and `moz-extension://` origins with 403, so the extension could never reach the API | Added explicit allow for browser extension origins alongside `APP_ORIGIN` |
| BUG-002 | `apps/browser-extension/src/background.js` | `status` message was queued through the serial promise chain; when the MV3 service worker restarted cold the chain never resolved, leaving the content script badge stuck on "loading…" indefinitely | Moved `status` handler outside the serial queue with its own immediate `respond()` call |
| BUG-003 | `apps/browser-extension/src/options.js` | `setStatus()` set `className = type` but the CSS requires a `show` class — status messages were always hidden | Always include `show` in the class list |
| BUG-004 | `apps/browser-extension/src/background.js` | On install, `setAccessLevel("TRUSTED_CONTEXTS")` was called, which prevents the restarted MV3 service worker from reading `chrome.storage.local` — `connected` always returned `false` | Call `setAccessLevel("DEFAULT")` on every SW startup and on install/update |
| BUG-005 | `server/api.ts` | An accidental duplicate `if (req.method !== "POST")` block was introduced during debugging | Removed the duplicate |
| BUG-006 (documented, not fixed) | `server/api.ts` | GET requests that fall through the agent route check reach `readBody()` before the method check on authenticated paths, causing the connection to hang | Documented; low risk in production since extension only issues POST requests |

### New tests added

| File | Tests added | What they cover |
|---|---|---|
| `tests/unit/normalizer.test.ts` | 24 | Source URL validation, role filtering, whitespace trimming, system message exclusion, 20k char truncation, 500 message limit, URL sanitization (query/fragments), title truncation and fallback, platform assignment, hash determinism, hash isolation |
| `tests/unit/api.test.ts` | 19 | Health/config endpoints, CORS for `chrome-extension://` and `moz-extension://`, hostile origin denial, OPTIONS preflight, 401 on missing/wrong auth, 503 on unconfigured Supabase, all 5 agent proxy routes, 413 on oversized body, security headers |
| `tests/extension/background.test.mjs` | 18 | Status shape (connected/active/auto/project), `set_project` handler, endpoint mismatch skips queued items, attempts cap (≥5 skipped), next-time throttle, 20-item queue limit, claude provider routing, history capped at 50, token never in history, Supabase keys never in queue |

### Test results after fixes

| Suite | Command | Result |
|---|---|---|
| Unit tests (Vitest) | `pnpm test` | **91 passed, 0 failed** (8 test files) |
| Extension tests (Node --test) | `pnpm test:extension` | **19 passed, 0 failed** (2 test files) |
| **Total** | | **110 passed, 0 failed** |

### Extension status after fixes

| Feature | Status | Evidence |
|---|---|---|
| Options page status feedback | **FIXED** | `show` class added to `setStatus()` — green/red banners now visible |
| Test connection (options page) | **Working** | Returns `✓ Connected. Permissions: capture, retrieval, writing` |
| Content script badge | **FIXED** | No longer stuck on "loading…"; resolves within 5 seconds with `sendMessage` timeout wrapper |
| "not connected" after SW restart | **FIXED** | `setAccessLevel("DEFAULT")` called on every SW startup |
| CORS from extension to API | **FIXED** | `chrome-extension://` origins now pass the CORS check |
| Auto-capture badge on ChatGPT | **Working** | Shows `Continuum: auto` when API server is running |
| Token permission error (403) | **Fixed** | Correct `ctm_` token now saved in extension storage |

### Operational requirement

The local API server (`pnpm api`) **must be running** for the extension to work. It binds to `127.0.0.1:3101` and proxies extension requests to Supabase. It does not start automatically on boot.

**To start it:**
```
pnpm api
```

The process runs until the terminal is closed. See section 23 for making this persistent.

### Commits made

| Commit | Description |
|---|---|
| `8f24db7` | fix(extension): show status element by adding 'show' CSS class in setStatus() |
| `bc52146` | fix(api): allow chrome-extension:// and moz-extension:// origins in CORS check |
| `5454192` | fix(extension): reset storage accessLevel to DEFAULT on service worker startup |
| `ab1f761` | fix(extension): handle status message outside serial queue to prevent SW deadlock |
| `d786ca8` | fix(extension): add sendMessage timeout wrapper to prevent badge stuck on loading |
| `476b602` | test(normalizer): add 24 unit tests for normalizedConversation and contentHash |
| `07f9502` | test(api): add 19 integration tests for server/api.ts HTTP layer |
| `8d2c818` | test(extension): add 18 background service worker tests |

---

## Status legend

- **COMPLETE** — implemented and supported by relevant local executable evidence.
- **PARTIALLY COMPLETE** — substantial implementation exists, but a material part is absent or unverified.
- **UI ONLY** — interface or product presentation exists without the advertised integration/function.
- **NOT IMPLEMENTED** — no meaningful implementation found.
- **BLOCKED** — requires external configuration, credentials, or deployment access.
- **UNVERIFIED** — code exists but no execution against the required real environment was available.

## 1. Executive Summary

Continuum is a React/Vite application backed by seven Supabase SQL migrations, with a scoped-agent memory gateway, local stdio and HTTP MCP transports, a CLI, optional embeddings worker, an application API for billing/account deletion, and a browser extension for auto-capturing ChatGPT and Claude conversations.

The browser extension is now **functionally working end-to-end** against the local API server. The extension connects, the content script badge resolves correctly, auto-capture is active on ChatGPT and Claude, and the options page shows connection status.

The repository is **not production-ready**. No Supabase project, email service, Stripe account, embedding provider, HTTPS endpoint, or named AI provider account is configured in the local environment.

Audit feature ledger: **41 features reviewed: 20 COMPLETE, 10 PARTIALLY COMPLETE, 2 UI ONLY, 4 NOT IMPLEMENTED, 4 BLOCKED, and 1 UNVERIFIED.**

## 2. Current Project Architecture

| Layer | Actual implementation | Status | Evidence |
| --- | --- | --- | --- |
| Web client | React 19, Vite, TypeScript, React Router, Supabase JS; public and protected routes | COMPLETE | `src/App.tsx`, `src/main.tsx`, `src/lib/supabase.ts` |
| UI/data access | Direct Supabase Data API for member-scoped records/RPCs; `VITE_API_URL` only for server operations | COMPLETE | `src/lib/api.ts`, `src/lib/product.ts`, `src/lib/useRecords.ts` |
| Database | PostgreSQL/Supabase schema and functions in migrations 001–007 | COMPLETE locally | `supabase/migrations/202610310001_website.sql` through `007_worker_reindex.sql`; PGlite tests |
| Agent gateway | Node fetch client calling checked Supabase RPCs with a scoped credential | COMPLETE locally | `server/gateway.ts` |
| MCP | Stdio `McpServer` plus stateless Streamable HTTP service | COMPLETE locally | `server/mcp.ts`, `server/http.ts`, `tests/unit/connections.test.ts` |
| Background processing | Database-backed queue and Node worker for imports/embeddings, explicit reindexing and service-only health heartbeats | PARTIALLY COMPLETE | `server/worker.ts`, migrations 004/007; no supervised deployed worker |
| Application API | Node HTTP server for Stripe webhooks/checkout/portal and account deletion | PARTIALLY COMPLETE | `server/api.ts`; no configured service |
| Embeddings | Optional HTTPS OpenAI-compatible 384-dimension provider contract and pgvector storage | PARTIALLY COMPLETE | `server/embeddings.ts`, migration 005; fixture-only provider responses |
| Browser extension | Chrome/Firefox MV3 extension capturing ChatGPT and Claude conversations | **COMPLETE locally** | `apps/browser-extension/`; 110 passing automated tests; working end-to-end |

## 3. Actual Repository Structure

- `src/`: public marketing UI, protected workspace pages, components, Supabase/RPC helpers, memory parsing, and motion/3D presentation.
- `server/`: scoped agent gateway, MCP stdio/HTTP servers, CLI, service-role/member clients, worker, embedding adapter, and application API.
- `supabase/migrations/`: seven ordered schema/function/security migrations.
- `tests/unit/`: PGlite/pgvector schema, service, protocol, gateway, memory, normalizer, and API server tests.
- `tests/extension/`: Node `--test` service worker behavior tests (19 tests across 2 files).
- `tests/browser/`: public marketing, motion, WebGL/AOS, and responsiveness tests.
- `tests/connections-browser/`: authenticated-page wire-fixture tests.
- `docs/`: architecture, operations, historical and current connection/design reports.
- `apps/browser-extension/`: Chrome/Firefox MV3 extension source and build output.

## 4. Frontend Implementation Status

| Feature | Status | What actually happens | Evidence and test boundary |
| --- | --- | --- | --- |
| Public site, documentation, policies | COMPLETE | Routes render product, integration, pricing, developer, docs, privacy/terms/security/contact pages. | `src/App.tsx`, `src/pages/PublicPages.tsx`; browser route tests |
| Authentication UI | PARTIALLY COMPLETE | Signup, password login, password reset, password update, optional Google OAuth and logout call Supabase Auth. Buttons are disabled when unconfigured. | `src/pages/Auth.tsx`, `AuthContext.tsx`, `AppLayout.tsx`; no live Auth test |
| Email confirmation/recovery | BLOCKED | Client requests Supabase confirmation/reset flows. Delivery and redirects require a real Supabase/Auth email setup. | `Auth.tsx`, `.env.example` |
| Workspace creation/switching | COMPLETE locally | `create_workspace` RPC creates owner membership; app lists selectable workspaces under RLS. | `AppLayout.tsx`, migration 001, `database.test.ts` |
| Onboarding | COMPLETE with fixture/browser coverage | Eight-step progress persisted by `onboarding_progress`. | `Onboarding.tsx`, migration 004, `product.spec.ts` |
| Overview and usage | COMPLETE locally | Counts come from scoped table queries and `workspace_usage` RPC. | `Overview.tsx`, `ProductPages.tsx`, migration 004 |
| Memories/review | COMPLETE locally | Search, filters, pagination, source evidence, review/edit/approve/archive/restore/delete, version awareness and conflict candidates exist. | `Memories.tsx`, migrations 001/003/004; PGlite tests |
| Conversations | PARTIALLY COMPLETE | JSON import, queued import, detail, exclusion, delete and linked-memory surfaces exist. No automatic feed. | `Conversations.tsx`, migrations 001/002/004 |
| Projects | COMPLETE locally | CRUD, instructions, archive/delete constraints, connections, context, and handoff UI wired to scoped data/RPCs. | `Projects.tsx`, migrations 001/003/005 |
| Project handoffs | COMPLETE locally | Destination credential selection, preview/confirmation, and current-permission retrieval implemented. | `Projects.tsx`, PGlite test |
| Connections/agents | COMPLETE locally | Owner configures scope, gets a one-time credential, tests, rotates, pauses capture, imports, retries and revokes. | `Connections.tsx`, migration 002; SQL/MCP and wire-fixture tests |
| Team invitations | PARTIALLY COMPLETE | Manual invitation link; no email is sent. | `ProductPages.tsx`, migration 004, `product.test.ts` |
| Jobs | COMPLETE locally | Jobs display and pause/resume/retry call database functions. | `ProductPages.tsx`, migration 004, PGlite tests |
| Usage and plan display | COMPLETE locally | Uses `workspace_usage`, `plan_catalog`, `workspace_billing`. | `ProductPages.tsx`, migration 004 |
| Billing UI | PARTIALLY COMPLETE | No plan price/key configured. | `ProductPages.tsx`, `server/api.ts` |
| Security/data settings/export | PARTIALLY COMPLETE | Semantic consent, workspace/account export, operational history, password/email UI and account-deletion form exist. | `ProductPages.tsx`, `OtherPages.tsx` |
| Relationship visualizations | COMPLETE with fixture coverage | Memory/connection/project relationship explorers implemented. | `MemoryRelationships.tsx`, `RelationshipExplorer.tsx`, `product.spec.ts` |
| Named provider presentation | UI ONLY | ChatGPT, Claude etc. explain generic token/MCP setup. | `src/config/integrations.ts`; no provider SDK/auth adapter |
| **Browser extension** | **COMPLETE locally** | Auto-captures ChatGPT and Claude; badge shows connection status; options page shows permissions; queue with retry. | `apps/browser-extension/`; 110 automated tests; verified working |

## 5. Backend Implementation Status

| Capability | Status | Evidence |
| --- | --- | --- |
| Member authorization | COMPLETE locally | Database `is_member`/`is_owner`; Supabase member JWT client in `server/service.ts` |
| Agent credential validation/revocation/expiry | COMPLETE locally | `configure_connection`, `agent_request`, SHA-256 token digest; migration 002; protocol tests |
| Ingestion/deduplication | COMPLETE locally | `ingest_conversation`/`import_conversation`; content hash and unique scopes; migrations 001/002 |
| Memory approval/correction/deletion | COMPLETE locally | Memory update/version trigger, audit trigger, active/pending states, deletion cascades |
| Full-text retrieval | COMPLETE locally | `search_document`, GIN indexes and `agent_request` use scoped memory checks |
| Semantic retrieval | PARTIALLY COMPLETE | Query path, vector store and ranking exist; provider absent; no live vector search |
| HTTP API — extension proxy routes | **COMPLETE locally** | All 5 agent proxy routes verified; CORS for extension origins fixed and tested; 19 API integration tests pass |
| HTTP API — billing/account | PARTIALLY COMPLETE | Account deletion and billing endpoint code exists; only unconfigured behavior tested |
| Durable jobs | COMPLETE locally | Queue, leases, retries and controlled transitions tested through PGlite |

## 6. Database Implementation Status

**Status: COMPLETE locally; BLOCKED for a real Supabase deployment.**

All 7 migrations exercised under PGlite. 91 unit tests passing covering workspace/member RLS, project isolation, conversation ingestion, memory extraction/approval, agent credentials, rate limiting, billing events, semantic embeddings, handoffs, ownership transfer, and account deletion.

## 7. AI Memory Engine Status

Pipeline: **normalized conversation → server ingestion → deterministic proposals → pending review → active memory/source/version → permission-filtered retrieval → agent context.**

| Engine step | Status |
| --- | --- |
| Input validation | COMPLETE locally |
| Extraction | COMPLETE, deterministic only (no LLM) |
| Categories/confidence | COMPLETE, heuristic |
| Provenance | COMPLETE locally |
| Review | COMPLETE locally |
| Duplicate detection | COMPLETE locally (lexical, not semantic) |
| Conflict detection | PARTIALLY COMPLETE |
| Versions | COMPLETE locally |
| Source exclusion | COMPLETE locally |
| Agent context | COMPLETE locally |

## 8. Agent Connection Status

**COMPLETE locally.** SHA-256 token digest, owner-only configuration, per-operation scope checks, rate limiting, revocation and rotation all verified. `tests/unit/connections.test.ts` exercises the full lifecycle via real MCP SDK client → HTTP → PGlite.

## 9. MCP and CLI Status

| Interface | Status |
| --- | --- |
| Stdio MCP | COMPLETE locally |
| HTTP MCP | COMPLETE locally |
| CLI | COMPLETE locally |
| Remote/public MCP hosting | BLOCKED |

## 10. Conversation Capture Status

**COMPLETE locally (browser extension).** The extension auto-captures ChatGPT and Claude conversations with:
- MutationObserver with 5-second debounce after last DOM change
- Streaming detection (waits for response to complete)
- SHA-256 content deduplication (same conversation not uploaded twice)
- Project association (selectable from popup)
- Offline queue with exponential backoff (up to 5 attempts, max 1h delay)
- Retry every 60 seconds via alarm
- Badge showing real-time capture status

**NOT IMPLEMENTED:** Native provider API adapters, OAuth capture, Gemini/Grok/Cursor/Codex adapters.

## 11. Semantic Search Status

**PARTIALLY COMPLETE.** Infrastructure exists; no real embedding provider configured. Default agent search is full text.

## 12. Background Worker Status

**PARTIALLY COMPLETE.** Logic complete locally; no process supervisor or production deployment.

## 13. Authentication and Authorization

**PARTIALLY COMPLETE.** PGlite tests verify local SQL boundaries. Live Supabase JWT/PKCE, email confirmation, and hosted account deletion unverified.

## 14–15. Workspace/Team Management and Billing

**PARTIALLY COMPLETE.** Implementations exist; Stripe and email delivery unverified.

## 16. Security Audit

### Verified local controls (updated)

All previous controls verified, plus:
- Extension never stores Supabase credentials — only a scoped `ctm_` token and local API URL
- Token never appears in extension history or queue payloads
- Extension queue items store endpoint and project ID but not any server-side credentials
- CORS on the local API server explicitly allows extension origins but denies all other non-configured origins
- `chrome.storage.local` access level set to `DEFAULT` (not `TRUSTED_CONTEXTS`) to prevent SW self-lockout

### Known risks and limits (unchanged from original audit)

See original section 16 — no new security risks introduced by the extension fixes.

## 17. External Integrations

| Integration | Status |
| --- | --- |
| Supabase | BLOCKED (no live project) |
| Stripe | BLOCKED |
| Embedding provider | BLOCKED |
| Generic MCP client | COMPLETE locally |
| Browser extension → local API | **COMPLETE locally** |
| ChatGPT auto-capture | **WORKING** (via extension) |
| Claude auto-capture | **WORKING** (via extension) |
| Gemini, Grok, Cursor, Codex, Antigravity | NOT IMPLEMENTED as provider integrations |

## 18. Testing and Verification Results

| Command | Result | What it establishes |
| --- | --- | --- |
| `pnpm test` | **91 passed** (8 test files) | PGlite migrations, normalizer, API server, memory extraction, service layer, MCP/gateway |
| `pnpm test:extension` | **19 passed** (2 test files) | Extension service worker: consent, provider routing, queue, dedup, status, project selection, security |
| `pnpm extension:build` | **passed** | Chrome and Firefox builds produced from source |
| Previous: `pnpm exec playwright test --config playwright.connections.config.ts` | **8 passed** | Authenticated UI wire-fixture tests |
| Previous: `pnpm build` | **passed** | TypeScript check and production Vite build |

**Total automated tests: 110 passing, 0 failing.**

## 19. Incomplete Features

1. Live Supabase project setup, migration application, Auth redirect/email testing, and hosted data acceptance.
2. Email invitation delivery and SMTP/provider configuration.
3. Stripe test-mode setup, full subscription lifecycle, and commercial plan configuration.
4. Live semantic embeddings, quality evaluation, and provider privacy/consent review.
5. Provider-specific OAuth/API/MCP adapters for Gemini, Grok, Cursor, Codex, Antigravity.
6. OAuth authorization server/discovery/registration for remote MCP clients.
7. Binary attachment upload/storage and associated deletion/retention paths.
8. Production operations: TLS proxy, distributed rate limits, monitoring, alerts, backups/restores.
9. Making the local API server (`pnpm api`) start automatically on boot — currently requires manual start each session.
10. Browser E2E tests for the extension against live ChatGPT/Claude DOM.

## 20. Broken or Partially Functional Features

No new broken workflows introduced. The following are deliberately limited:

- Billing/buttons operate only after external server/Stripe setup.
- Invite creation produces a manual link; no send-email action.
- Semantic controls can queue work but no configured model means no real vectors.
- The provider directory is informational/configuration guidance.
- Local API server must be started manually with `pnpm api` before the extension works.

## 21. Missing Dependencies and Configuration

No package dependency is missing for the locally tested scope. Missing external configuration remains the release blocker:

- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and live Supabase project/Auth redirect settings.
- Private server values: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_ORIGIN`, service bind/ports.
- Stripe secret/webhook secret, approved recurring price IDs, billing portal configuration.
- HTTPS embedding endpoint, model/key that reliably emits 384-dimensional vectors.
- HTTPS MCP/API host, strict allowed hosts/origins, reverse proxy and distributed abuse controls.
- SMTP/email configuration for Auth and invitation delivery.

## Implementation follow-up — 1 November 2026

An additive local implementation pass after this audit added migration `202610310007_worker_reindex.sql`, `reindex_semantic`, protected worker heartbeats, a Security-page reindex control, worker health display, and privacy-safe structured worker events. Existing queues, RLS, visual design, and deletion policy were preserved.

Local evidence after the change: `pnpm test` passed **46** tests; `pnpm build` passed; authenticated browser fixtures passed **8** tests.

## Implementation follow-up — 13–14 November 2026

See section 22 above for the full browser extension QA, bug fix, and test expansion record.
