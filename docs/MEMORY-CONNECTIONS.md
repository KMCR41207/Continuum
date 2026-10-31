# Continuum memory connection completion report

## Audit result

The original build did **not** implement cross-agent memory connections. It had real member authentication/RLS, manual JSON ingestion, evidence-backed proposals, review, version history, deletion and export. Connections/Agents were placeholders; there were no scoped credentials, independent agent permissions, agent retrieval endpoint, MCP server or CLI. See `MEMORY-CONNECTION-AUDIT.md` for the initial evidence.

## Implemented and locally verified

- Owner-issued credentials with >240 random bits, SHA-256 digest storage in a non-readable credential table, 90-day expiry, rotation and immediate revocation. Plaintext is returned once and never persisted by the dashboard or CLI.
- Independent capture, retrieval and writing permissions. Separate project allowlists, global-context permission and conversation-history allowlists. Permission changes apply to the next request of an already-connected MCP client.
- Explicit authorized normalized JSON capture through a scoped connection, dashboard or CLI; member import remains available. Server validation, server-computed deduplication, original platform, source IDs/timestamps/attachment descriptions in metadata, atomic rollback, redacted failure events, manual retry, capture pause/resume and last-success timestamps.
- Conservative server extraction into all requested category types, human review, linked message evidence, confidence, versioned corrections, archive/restore/delete. Review flags possible conflicting statements with the same recognized subject and scope; it never decides which is true automatically.
- PostgreSQL full-text search and GIN indexes. Automatically regenerated 64-dimensional hashed lexical embeddings are stored, but relevance ranking currently uses full-text search. These are **not semantic model embeddings** or semantic conflict detection.
- A local stdio MCP server using the official SDK, with all ten requested memory/project/conversation tools plus `test_connection` and explicit `capture_conversation`. Its startup validates credentials before opening the protocol transport.
- CLI login/connect/status/diagnostics (validate an owner-issued token), logout/disconnect (revoke), projects, search, import and scoped JSON export. No fake provider login or token file storage.
- Source-linked project handoffs, connected-agent summaries, project instructions and scoped recent context. Handoffs never expand recipient permissions.
- Connection dashboard: provider identity, method, created/expiry dates, credential-validation state, last activity/import, permission controls, test, rotate, revoke, explicit import/retry and event history. A verified credential is not labelled a verified provider session.
- Workspace/member RLS, owner-only connection configuration, private SQL helpers, validated public RPC, redacted events, 120 authenticated requests/minute/connection, HTTPS gateway with timeout and redirect refusal. Source exclusion removes both conversations and their derived memories from agent results. Sensitive and unapproved memories are not served to agents.

## Provider capability matrix

| Provider identity | Capture implemented | Retrieval / writing implemented | Actually tested live? |
| --- | --- | --- | --- |
| ChatGPT | Explicit normalized JSON import | Generic token RPC / local MCP bridge, if the client can run it | No |
| Claude | Explicit normalized JSON import | Same generic bridge | No |
| Google Gemini | Explicit normalized JSON import | Same generic bridge | No |
| Grok | Explicit normalized JSON import | Same generic bridge | No |
| Cursor | Explicit normalized JSON import | Same generic bridge | No |
| Codex | Explicit normalized JSON import | Same generic bridge | No |
| Antigravity | Explicit normalized JSON import | Same generic bridge | No |
| Other compatible client | Explicit normalized JSON import | SDK client over actual stdio MCP | Yes, local generic SDK client only |

Provider names are source/client labels, not proof that the provider authorizes exports, supports local MCP, or grants access to conversation history. ChatGPT-labelled input and a Codex-labelled credential are used in local interoperability tests, not actual provider sessions. All providers require independent capture/retrieval/write permissions. No automatic capture, OAuth adapter or hidden browser-state access exists.

## Database and interfaces

Apply migrations in order:

1. `202610310001_website.sql`: existing workspace, project, source, memory, version and audit foundation.
2. `202610310002_connections.sql`: `agent_connections`, private `connection_credentials`, `connection_events`; source metadata; full-text indexes and lexical embeddings; scoped import deduplication; connection configuration, ingestion and authorization.
3. `202610310003_context_review.sql`: `project_handoffs`, conflict candidates, scoped handoff/context retrieval and expanded workspace export.

Supabase Data API routes (all POST):

- `/rest/v1/rpc/configure_connection`: authenticated workspace owner; creates/changes scopes, rotates/revokes credentials.
- `/rest/v1/rpc/agent_request`: publishable key plus scoped token in JSON body; every operation checks current permissions. Never put a token in a query string.
- `/rest/v1/rpc/import_conversation`: existing member import, now server extraction and deduplication. `p_hash` remains for compatibility but is not trusted. Pass null `p_proposals` for server extraction.
- `/rest/v1/rpc/memory_conflict_candidates`: member-only review candidates.
- `/rest/v1/rpc/create_handoff`: editor/owner creates a handoff tied to a source in the same project.
- `/rest/v1/rpc/export_workspace`: member snapshot includes connections, events and handoffs, never credential hashes.

`ingest_conversation`, `agent_request_core`, `connection_scope`, `connection_conversation`, `connection_memory`, and export internals cannot be called by anonymous or authenticated clients. Raw tables with credentials have no client grants or RLS policies. Agent access is through the checked gateway only. Existing member access remains workspace-wide; project allowlists constrain agents, not workspace members.

Runtime entry points: `server/gateway.ts`, `server/mcp.ts`, `server/cli.ts`. Dashboard: `src/pages/app/Connections.tsx`. Existing review/source/project pages were extended rather than replaced.

## Setup and real use

This workspace has `.env.example`, but no configured `.env` or deployed Supabase endpoint. Nothing was deployed or connected to a personal provider account.

1. Apply the three migrations to your Supabase project. Supply the website's public URL/key as documented in README. Never use a service-role key in the website or agent configuration.
2. Sign in, create a project, then open Connections. Only the workspace owner can issue or change connection credentials.
3. For an import source, enable capture and grant the chosen project. For an agent, enable retrieval, grant that project, and allow the relevant source conversations (or all history within that project). Enable writing only if proposals/corrections are desired.
4. Copy the one-time token. Store it using your client/OS secret-management mechanism. The app only retains it in dialog memory until close; the CLI only reads environment variables. Tokens do not belong in source control, command arguments, screenshots or request-body logs.
5. With Node 22.18+ or Node 24+, set the three values from `.env.agent.example` in the agent process environment. If using a local env file, keep it private and run `node --env-file=.env.agent server/cli.ts diagnostics`. The CLI does not automatically read env files.
6. Import a permitted conversation with `node server/cli.ts import conversation.json PROJECT_UUID`, or use the dashboard's connection import form. A capture-only credential cannot retrieve anything.
7. Approve the extracted candidate in Memories. Pending, rejected, archived and sensitive memories remain unavailable to agents.
8. Configure a compatible MCP client with command `node`, argument the **absolute path** to `server/mcp.ts`, and the agent environment variables. Or run `node server/cli.ts search React`. The MCP server validates the credential on startup; every subsequent tool call rechecks it.

Example normalized source (timestamps and attachment descriptors are retained as metadata; attachment contents are not fetched):

```json
{
  "title": "Project architecture",
  "platform": "chatgpt",
  "metadata": {"source_id": "authorized-export-42", "timestamp": "2026-10-30T10:00:00Z"},
  "messages": [{
    "role": "user",
    "content": "This project uses React, TypeScript, and Supabase.",
    "metadata": {"attachments": [{"name": "architecture.txt", "mime_type": "text/plain"}]}
  }]
}
```

CLI commands: `login`, `logout`, `connect`, `disconnect`, `status`, `projects`, `search <query>`, `import <file> [project UUID]`, `export <new-file>`, `diagnostics`. Login/connect validate; logout/disconnect revoke. Export refuses to overwrite an existing file and includes only approved, non-sensitive, authorized memories and source references. CLI pagination is not a database-wide snapshot if content changes during export; use the member workspace export for an atomic full snapshot.

## Verification and exact boundaries

`tests/unit/connections.test.ts` runs a real SDK MCP client connected to a spawned Node stdio server, then an HTTP RPC adapter backed by PGlite PostgreSQL executing the actual migrations. It does not mock permissions or memory storage. The adapter substitutes for hosted Supabase/PostgREST; Auth uses a test-only `auth.uid()` shim.

All eight required workflows pass locally:

1. Authorized source import → server extraction → member approval → exact source-linked memory retrieved by a separate MCP credential.
2. Retrieval disable/enable takes effect without reconnecting.
3. Project A cannot read/write Project B, global context or disallowed conversation sources, including guessed IDs.
4. Correction checks version, returns to review, retains history and returns corrected text after approval.
5. Repeated imports, including changed titles, do not duplicate conversations/memories.
6. Disconnection invalidates the already-connected client's next request.
7. Retrieval with capture disabled works; capture-only cannot retrieve; pause/resume is enforced.
8. Expired/rotated tokens, invalid permissions, malformed import, source mismatch and unavailable endpoint fail meaningfully; failed imports roll back, record redacted events and can be retried.

Additional tests cover credential table denial, tenant isolation, rate limits, required tool discovery, CLI search/diagnostics, conflict review, handoff scoping, source exclusion, export secret omission and deletion cascades. Browser control tests use explicit wire fixtures and do **not** count as live backend authentication verification.

Final verification: `pnpm test` — 30 passed; `pnpm test:e2e` — 12 passed; `pnpm test:connections-ui` — 2 passed (desktop/mobile); `pnpm build` — passed. No remaining test failures. Earlier development failures (SQL alias ambiguity and an exact-label browser selector) were corrected and rerun successfully.

## Remaining incomplete

- **Live Supabase/Auth deployment and named-provider sessions:** no configured endpoint, account sessions or provider credentials were supplied. Local tests cannot verify hosted PostgREST routing, email login or actual platform compatibility.
- **Automatic conversation capture and native provider exports:** no authorized official API/browser adapter was supplied or tested. Only explicit normalized JSON imports are implemented. Provider OAuth is not invented.
- **Remote MCP/OAuth:** this implementation is a local stdio bridge to Supabase RPC. Cloud-only assistants requiring a hosted OAuth MCP endpoint cannot use it directly; that deployment and authorization-server work remains.
- **Semantic search and general conflict resolution:** deterministic extraction, same-subject conflict candidates, lexical embeddings and full-text ranking are implemented. A configured semantic embedding model, vector ANN index and broader extraction/evaluation are not.
- **Background synchronization:** no automatic feed exists, so there is no durable scheduler, provider backfill or background retry worker. Explicit import is atomic and manually retryable, with pause/resume and event history.
- **Production operations:** add edge/IP abuse controls for unknown tokens, audit retention, deployment monitoring, secret-manager provisioning and live-provider acceptance tests before public rollout. Existing team invitation, account deletion and billing gaps are unrelated and were not expanded in this task.

The core authorized import → reviewed source-linked memory → independently scoped MCP retrieval works locally. This report does not claim that every requested provider or production service is complete.

SDK reference checked during implementation: [official TypeScript MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk). Installed server/client version: 2.4.0, pinned by `pnpm-lock.yaml`.
