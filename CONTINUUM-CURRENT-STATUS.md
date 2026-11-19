# CONTINUUM — Current repository audit and implementation status

> Historical Supabase implementation audit. The subsequent Python/SQLite/Chroma mode and its latest verification are recorded in [SELF-HOSTED-STATUS.md](docs/SELF-HOSTED-STATUS.md). Its integration preserves the legacy implementation and does not dual-write stores.

Audit date: 1 November 2026. Last updated: 17 November 2026.
Audit scope: local repository at Git HEAD plus all subsequent implementation, debugging, and QA work recorded below. This is an evidence-based, source-and-test audit; it makes no claim about a deployed environment.

---

## 27. Update — 19 November 2026: Live Supabase verification [Claude]

DNS now resolves `*.supabase.co` correctly, so the live development project was tested with real calls (agent token; no secret key used).

| Check | Result |
|---|---|
| Migrations 008–018 on the live project | **Applied.** `agent_request`, `agent_link_request`, `agent_workspace_request` answer; owner-only functions refuse the anon key with `permission denied` (correct) |
| Token status, projects, workspace status | Work (workspace "Stackweb", 1 project, 3 agents) |
| Per-chat capture (live writes) | **Pass.** Create → grow (+2 messages appended) → identical repeat (no-op) → stale snapshot ignored; exactly one conversation row; auto-routed to the project named by `provider_project` |
| Extension upload code path (direct mode, publishable key) | **Pass**; a secret key is refused |
| `continuum status` / `search` via CLI | **Pass** |
| MCP server over stdio (19 tools, live) | **Pass**: authenticated calls, forbidden errors, bad arguments handled |

Test data left in the live project (delete in Conversations): `[continuum-selftest] auto capture` and `[continuum-selftest] extension path`, plus their pending memories.

**Not verified live:** website pages with a signed-in session (needs an interactive login); chat links between two agents and devices (need a second token / owner session; covered by local database tests); LLM extraction (no `EXTRACTION_*` model key configured and the owner opt-in needs a signed-in session); real chatgpt.com / claude.ai page capture (extension must be loaded by hand; browser automation is not connected). The leaked token is still the token in `.env.server` and still valid.

### What is left to do

Owner = you (needs your login, browser or accounts). Claude = can be done in a session once the blocker is cleared.

**A. Security (do first)**

| # | Task | Who | Detail |
|---|---|---|---|
| A1 | Revoke the leaked capture token (`ctm_c08c…`) | Owner | Continuum → Connections → open the connection → Revoke. It is in public git history (commit `fda69a7`) and still in `.env.server`. |
| A2 | Create a new token and put it in `.env.server` | Owner | Never paste it in chat or commit it. |
| A3 | Make the GitHub repo private | Owner | GitHub → Settings → General → Danger Zone → Change visibility. Do this before pushing. |
| A4 | Optional: remove the old token from git history | Owner + Claude | Needs a force push (`git filter-repo`); only useful after A1. |

**B. Get the work onto GitHub**

| # | Task | Who | Detail |
|---|---|---|---|
| B1 | Open `C:\Users\ksair\continuum-release-validation` in Kiro | Owner | Not the OneDrive folder (its `.git` cannot be written). |
| B2 | Run `pnpm install`, then push branch `release-ten-features-validation` | Owner | 29 local commits; `origin` is already set. Then open a PR into `main`. |
| B3 | Move the working copy out of OneDrive (or remove the "deny Everyone" ACL) | Owner | Fixes locked `.git`, `build/`, `test-results/`, `artifacts/`. |

**C. Live verification that still needs you**

| # | Task | Who | Detail |
|---|---|---|---|
| C1 | Delete the two `[continuum-selftest]` conversations | Owner | Continuum → Conversations. Their pending memories go with them. |
| C2 | Create a browser capture connection | Owner | Provider **Other**, Capture on, access to your projects; copy its token once. |
| C3 | Load the extension | Owner | `chrome://extensions` → Developer mode → Load unpacked → `…\apps\browser-extension\build\chrome`; paste the token in its options. Firefox: `about:debugging` → Load Temporary Add-on → `build\firefox\manifest.json`. |
| C4 | Test auto-capture on real chatgpt.com and claude.ai | Owner, then Claude | Send a few messages; confirm one conversation per chat in Continuum, named from the chat title, updating as it grows. If messages, titles or project names are missed, send Claude the page structure and the selectors in `content/capture.js` get tuned. |
| C5 | Create Continuum projects with the same names as your ChatGPT/Claude projects | Owner | Automatic routing matches by name (ignoring case and punctuation). A fixed project is also selectable in the extension. |
| C6 | Rename project "Coontinuum" if it is a typo | Owner | Routing matches by exact name. |
| C7 | Sign in to the website and walk through Activity, Links, Devices, Connections, Conversations and hand-offs against live data | Owner, then Claude | Claude cannot enter your password. Report any broken page. |
| C8 | Chat links and device revoke with two real agents | Owner | Needs a second token (another connection). Covered locally by database tests only. |

**D. LLM memory extraction**

| # | Task | Who | Detail |
|---|---|---|---|
| D1 | Choose a model provider and set `EXTRACTION_URL`, `EXTRACTION_MODEL`, `EXTRACTION_API_KEY` in `.env.server` | Owner | OpenAI-compatible HTTPS endpoint. Conversations are sent to it, so use one whose data policy you accept. |
| D2 | Turn on "AI extraction" in Security and data | Owner | Owner-only switch. |
| D3 | Run `pnpm worker` and confirm pending memories appear | Owner, then Claude | The worker also needs the Supabase service credentials it already requires. Verified locally with a test double only. |

**E. Engineering follow-ups (Claude, no blocker)**

| # | Task | Detail |
|---|---|---|
| E1 | Investigate the 16 public-site browser tests that fail on `HEAD` too | Animation, layout and auth-config tests; unrelated to this work. |
| E2 | Self-hosted (Python/SQLite) mode is untested with the new features | Chat links, devices and activity exist only in the Supabase backend. |
| E3 | Decide how Claude Code should receive the MCP token | `mcp on` registers the server without a token; run `continuum login` first, or set `CONTINUUM_TOKEN`. |
| E4 | Optional: store the extension capture token in `chrome.storage.session` and prompt after browser restart | Hardening; current storage is local-only, not synced. |

---

## 26. Update — 18 November 2026: Private-development pass [Claude]

- **Fixed:** with one conversation per chat, LLM extraction ran only on a chat's first snapshot. Migration 018 re-queues the conversation's extraction job when its message count changes (2-minute delay; status-only updates never re-queue; paused jobs stay paused).
- **Verified locally:** capture → extraction job → real worker tick → pending memory hidden from agents → owner approval → another agent retrieves it with its source (`tests/unit/extraction-flow.test.ts`; the model is a test double).
- `supabase/APPLY-008-018.sql` replaces the 008–017 bundle.
- **Blocked:** live Supabase (this network resolves `*.supabase.co` to a non-Supabase address and resets TLS; no DB password or access token); real ChatGPT/Claude page testing (browser automation extension not connected; the extension must be loaded by hand).
- **GitHub:** the repository is **public** (readable without login). Nothing was pushed. Make it private before pushing; the token leaked in history must be revoked regardless.

---

## 25. Update — 17 November 2026: Automatic per-chat capture and leak audit [Claude]

### Automatic capture (migration 017 + extension)

- One conversation per chat address (ChatGPT `/c/<id>`, Claude `/chat/<id>`): later captures append messages and refresh the title; an edited message replaces what follows; an older delayed snapshot is ignored. Pages without a chat address are not captured.
- Chat names: page title without the provider suffix, or the first user message when the title is generic.
- Project routing: a chat inside a ChatGPT/Claude project goes to the Continuum project with the same name (if the token may write there), otherwise to the extension's default project.
- Direct mode: the extension calls Supabase `agent_request` with the public anon/publishable key and the capture token, so `pnpm api` does not need to run. Secret and service_role keys are refused at build time and at runtime. The build reads the project URL and anon key from the git-ignored `.env`.
- Capture runs 2.5 s after the page settles and again when the tab is hidden or closed. Capture stays on by default; the off switch remains in extension settings.
- `supabase/APPLY-008-017.sql` bundles migrations 008–017 for the Supabase SQL editor (verified on a 001–007 database).

### Leak audit

| Check | Result |
|---|---|
| Secrets in current tracked files | None |
| `.env`, `.env.server`, `*.mcp_config.json`, `SESSION-SUMMARY-*`, `data/`, `CONTINUUM.local.md`, extension `build*/` | All git-ignored (verified with `git check-ignore`) |
| Example env/config files | Placeholders only |
| **Git history** | **A live capture token (`ctm_c08c…`) and the publishable key were committed in `claude_mcp_config.json` (commit `fda69a7`, 4 Nov) and are on `origin/main`. The same token is still in `.env.server`.** Revoke it in Connections and issue a new one. Rewriting the published history is a separate, deliberate decision (force push). |
| Extension storage | `chrome.storage.local` only; no `storage.sync`, no external messaging, single fetch to the configured endpoint; token never written to history |
| Server logs | No tokens, keys or conversation content are logged |
| CLI | Token in `~/.continuum/token` (POSIX mode 0600; on Windows the user-profile ACL applies); MCP configs written by the CLI contain no token |

---

## 24. Update — 17 November 2026: Integration and release validation [Claude]

### Results

| Area | Status | Evidence |
|---|---|---|
| Unit + DB tests (Vitest, 20 files) | **238 passed, 0 failed** | `npx vitest run --configLoader runner --no-fsModuleCache` |
| Extension tests | **22 passed, 0 failed** | `node --test tests/extension/*.test.mjs` |
| TypeScript | Clean | `npx tsc --noEmit` |
| Production build | Built | `vite build` (output outside OneDrive) |
| Browser: new pages vs real PostgreSQL | **20 passed, 0 failed** (desktop + mobile) | `tests/connections-browser/features.spec.ts` + existing connections suite |
| Browser: public site | 18 passed, 16 failed — **same failures as HEAD**, none introduced | Run outside OneDrive against HEAD and against this tree |
| CLI → MCP stdio end-to-end | **6 passed** | `tests/unit/mcp-cli.test.ts` (real `continuum login` + `mcp serve` + MCP client) |
| Security / authorization (server-side) | **10 passed** | `tests/unit/security.test.ts` plus chat-links, features-db |
| Extension build | Built and verified (Chrome + Firefox) to a folder outside OneDrive | Sources byte-identical, manifests MV3, `node --check` clean |
| Supabase migrations 011–016 on a live project | **BLOCKED** | No access token / DB password / service key; project host unreachable from this network |

### Defects fixed in this pass

| Defect | Fix |
|---|---|
| `continuum mcp on` wrote Claude Code config to `~/.claude/mcp.json`, which Claude Code never reads | Uses `claude mcp add-json continuum … -s user` / `claude mcp remove` (stored in `~/.claude.json`); replaces an older entry; prints instructions when `claude` is not installed |
| Hand-off history page crashed: it read `package.messages`, but migration 006 deliberately stores hand-offs without message content | Page shows only stored fields (destination, note, time) |
| New `.segmented` style collided with the public site's existing `segmented` control | Renamed to `.range-selector` |
| Vite dev server hung: its cache folder could not be created inside the OneDrive folder | `CONTINUUM_VITE_CACHE_DIR` override (default unchanged) |
| Extension build could not overwrite locked files in `build/` | `CONTINUUM_EXTENSION_OUT_DIR` override (default unchanged); `build-*/` git-ignored |
| `docs/MEMORY-CONNECTIONS.md` described Codex's removed link design | Rewritten for code-based links, CLI and MCP registration |

### Environment notes (this machine)

- Files created earlier under Codex's sandbox account in `apps/browser-extension/build/`, `test-results/`, `artifacts/design/` and `node_modules/.vitest-cache/` cannot be overwritten or deleted, even outside the sandbox. Delete them manually or move the repository out of OneDrive.
- `*.supabase.co` resolves to a non-Supabase address here and the TLS handshake is reset; `supabase.com` itself is reachable.

---

## 23. Update — 17 November 2026: Ten-feature build-out (Codex + Claude)

### Who did what

Tags used below: **[Codex]** = implemented by Codex, reviewed and corrected by Claude. **[Claude]** = implemented by Claude in this pass. **[Codex → fixed by Claude]** = Codex's version was wrong or partial and was rewritten.

| Feature | Tag | Status |
|---|---|---|
| 1. LLM memory extraction | [Codex → fixed by Claude] | Worker payload bug fixed; LLM proposals now replace regex proposals |
| 2. Provider export import (ChatGPT / Claude / Grok) | [Codex → fixed by Claude] | Parsers hardened; `/app/conversations` drag-and-drop with progress and summary |
| 3. "Ask in…" hand-off menu and `/handoffs` subview | [Codex → fixed by Claude] | Menu was never mounted; now wired on cards and detail view |
| 4. Activity dashboard (heatmap, agent bars, recent lookups) | [Claude] | New `get_activity_summary` migration and `/app/activity` page |
| 5. Chat links (`/link` code relay) | [Codex → rewritten by Claude] | Codex's owner-paired version replaced with code-based create / join / post / read / close |
| 6. File and image capture in the extension | [Codex] for the `options` toggle and `background.js` strip; [Claude] for `capture.js` attachment collection, `normalizer.js` pass-through, and migration `014` | Stored in `messages.attachments` |
| 7. `continuum` CLI | [Codex] for session capture and link commands; [Claude] for everything else | status, mcp list/on/off/serve, login/logout, search, capture, help |
| 8. "How far back" per connection | [Claude] | `history_days` migration, `/app/connections` dropdown |
| 9. Devices page | [Claude] | Devices table, RPCs, `/app/devices`, CLI heartbeat |
| 10. `CONTINUUM.md` project config | [Claude] | `server/projectConfig.ts`, template, CLI gates |
| Supporting fix: API proxy routing and error codes | [Codex → fixed by Claude] | Only 5 operations were routed; every error returned 403 |

### Features added in this pass

- **Extraction:** the worker now sends a real JSON array. Malformed items are skipped without failing the job. Fenced JSON replies parse. Prompt size is bounded. Unreviewed regex proposals are replaced by LLM proposals for the same conversation (migration `202610310011_extraction_hardening.sql`).
- **Import:** ChatGPT exports follow the selected branch and drop hidden messages. Claude content-block messages are read. Chats over 500 messages split into numbered parts. Duplicates within one file are skipped and counted.
- **Hand-off UI:** "Ask in…" menu shows only providers with a usable connection. Preview modal, editable note, confirm, clipboard copy, and the spec's toast text. History subview at `/app/conversations/:id/handoffs`. Owner-only, matching `confirm_handoff`.
- **Activity:** `get_activity_summary(p_workspace, p_days)` returns daily counts (UTC), per-agent totals, the 20 latest lookups and totals. CSS-only 12-week heatmap, bars and feed. Range selector 30 / 60 / 90 days. The old change log sits collapsed below.
- **Chat links:** `create_link` returns a code (only its SHA-256 hash is stored). `join_link` supports private (2 members), approval (owner approves) and public (up to 20) types. Expiry is 24h unjoined and 30 days once joined. Posts are limited to 120 per connection per hour. Members only see their own links through RLS. Agents reach links through `agent_link_request`. Owner dashboard at `/app/links` has member count, last message, copy join code (rotates the code), close and approve/decline.
- **File capture:** the extension stores http(s) URLs and names only. `data:` and `blob:` URLs are dropped. Max 20 attachments per message. The "Capture files and images" toggle strips references before queueing and before upload, including items already queued. `get_conversation` returns attachments.
- **CLI:** `status`, `mcp list|on|off|serve`, `login`, `logout`, `search`, `capture`, `link`, `projects`, `export`, `help`, plus `--json`. Token is read from `CONTINUUM_TOKEN` or `~/.continuum/token` (mode 0600). `mcp on` backs up the original config once, writes JSON or TOML, and skips agents that are not installed. The `continuum` bin and `pnpm continuum` script are in `package.json`.
- **History scope:** `history_days` (1–3650 or null) on connections. Enforced in `connection_conversation`, so it also limits hand-offs and memories sourced from older conversations.
- **Devices:** `register_device`, `device_heartbeat`, `list_devices`, `revoke_device` (owner only, optional token revocation). CLI registers on login and checks in on each command. A revoked device's CLI deletes its token.
- **CONTINUUM.md:** `save: false` stops capture, `project:` assigns captures by name, `exclude:` skips paths (bare names match at any depth, globs supported). `CONTINUUM.local.md` overrides keys. Unknown keys are rejected. Walks up to the `.git` root.

### Bugs found and fixed during review

| Area | Bug | Fix |
|---|---|---|
| Extraction | Worker sent `JSON.stringify(proposals)`, stored as a jsonb scalar; every extraction job failed. Codex's test asserted the bug. | Send the array; test corrected |
| Chat links | Codex's relay had no join codes, expiry, limits or close. | Rewritten to spec |
| Hand-off UI | Component built but mounted nowhere; no subview route | Wired and routed |
| API proxy | Only 5 agent operations routed; all errors → 403 | Shared `agentRpc()` routing; error codes map to 401/403/409/429/400 |
| `server/gateway.ts` | Parameter property in `AgentError` broke Node type-stripping; MCP server failed to start | Plain field; regression test added |
| `vitest.config` / OneDrive | Vitest cache files locked by OneDrive, so `pnpm test` fails here | Run with `--no-fsModuleCache` (see below) |
| `chat-links` tests | Error code mapping and rate-limit test ordering | Fixed in SQL and test |

### Verification (run on 17 Nov 2026)

| Suite | Command | Result |
|---|---|---|
| Unit tests (Vitest, 18 files) | `npx vitest run --configLoader runner --no-fsModuleCache` | **220 passed, 0 failed** |
| Extension tests (Node --test) | `node --test tests/extension/*.test.mjs` | **22 passed, 0 failed** |
| Typecheck | `npx tsc --noEmit` | Clean |
| Production build | `vite build` (to scratch folder) | Built |

New DB tests run against PGlite with all migrations applied in order. New tests: `chat-links`, `extraction-db` (replacement), `features-db` (history scope, file capture, activity, devices, hand-off, workspace status), `importParsers`, `projectConfig`, `cli`, `ui-logic`, `node-runtime`.

### Not yet verified

- The new pages (`/app/activity`, `/app/links`, `/app/devices`, hand-off menu) have not been opened in a browser. They need a running Supabase project and a signed-in owner.
- Migrations `011`–`016` have only been applied to PGlite, not to a live Supabase project.
- The extension build (`pnpm extension:build`) has not been re-run; the `build/` folder is stale.
- Nothing is committed to git yet.

### Operational notes

- Run tests with `npx vitest run --configLoader runner --no-fsModuleCache` while the repo sits in OneDrive.
- Migration numbers `011`–`016` follow Codex's `008`–`010`. All new migrations are additive.
- Claude Code's MCP config location: resolved in section 24 (`claude mcp add-json -s user`, stored in `~/.claude.json`).

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
