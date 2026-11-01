# Self-hosted implementation status

Local implementation, 1 November 2026. No commit, push, deployment or database reset.

## Implemented and verified

- FastAPI service with local Argon2 password hashing, 15-minute JWTs, rotated hashed refresh tokens, immediate session revocation and first-owner loopback setup. Supabase is optional in a separate deployment mode.
- SQLAlchemy/Alembic schema, SQLite WAL/foreign keys/busy timeout, FTS5 search, workspace membership, independent agent permissions, allowlists, token hashing/expiry/rotation/revocation, review/version/source/audit records.
- Idempotent normalized conversation import, deterministic evidence-preserving extraction, pending review, correction/history, source exclusion and the existing explicit source-deletion policy.
- Persistent Chroma indexing, model-derived dimensions, model-specific collections, local Sentence Transformers embeddings, Ollama/remote provider adapters, current-record authorization after vector search, full-text fallback and conservative context budgets.
- Existing React workspace connected through an explicit self-hosted adapter; local administrator setup, actual project/import/review/persistence and connection validation passed a real Chromium-to-FastAPI test. Files and compaction settings reuse existing styles.
- Official Python MCP SDK stdio server and tools. A separate real SDK client discovered tools, retrieved approved memory, proposed a pending fact, and observed writing permission changes/revocation. Existing TypeScript MCP/CLI can use the same local API.
- Job claiming/recovery/retry/backoff, pause/retry controls, idempotent import/embedding/compaction jobs, source/version/consent/lease rechecks, structured redacted logs and worker heartbeat. Compaction default threshold is 14 days; opt-in and redaction safeguards are explicit.
- Text/code/JSON/CSV/PDF/DOCX project file parsing with limits, opaque stored paths, source-linked pending chunks and project/file permissions.
- Offline export import into an empty selected store, credential reissue policy, backup manifests/integrity checks and non-overwriting restore.

## Verification evidence

- Python backend suite: **10 passed**, including real SQLite, persistent Chroma, local API permissions, file rejection, compaction failure/retry/persistence, expiry, lease recovery, backups and actual MCP stdio transport.
- Real self-hosted browser workflow: **1 passed (50.2 seconds)**, including setup, project/import consent, approval, persistence, scoped connection creation/test, and narrow-screen overflow check.
- Existing database/unit/protocol plus extension-normalization suite: **48 passed**.
- Actual local model: `sentence-transformers/all-MiniLM-L6-v2`, **384 dimensions**. Four-query evaluation: **recall@1 = 1.0, MRR = 1.0**. This is a small smoke dataset, not a general retrieval quality benchmark. Dataset and evaluator: `services/memory-api/tests/retrieval-evaluation.json`, `app/evaluate.py`.
- Production React build passes with existing bundle-size advisories. Chrome/Firefox packages generated locally by `pnpm extension:build`.

## Implemented but requiring acceptance

- Chrome/Firefox consented visible-DOM capture extension: default disabled, explicit platform consent, pause/manual/opt-in auto-sync, deduplicated persistent retry queue and exact backend-origin permission. Real ChatGPT/Claude account UI and Firefox distribution/signing were not used/tested. Selectors may need updates; unsupported content fails rather than using private APIs.
- Python Streamable HTTP MCP wrapper: requires per-request bearer tokens and checks origins. Stdio is the transport with actual SDK integration coverage in this pass; remote HTTP deployment and named-client compatibility remain acceptance work.
- Ollama/OpenAI-compatible/Anthropic summarization adapters exist. Compaction safety is tested with deterministic model responses; no actual summarization model or paid provider was invoked. Remote processing requires explicit operator opt-in and HTTPS.
- Dockerfiles/Compose/private Chroma networking, health checks and persistent volumes are supplied. Docker is unavailable on this machine, so images and volume permissions were not runtime-tested. Compose Chroma backups require a separate stopped-volume snapshot.
- Multi-user teams/manual invitation links and destination-specific handoffs reuse the local authorization/RPC services; browser happy paths and the legacy SQL tests do not replace a full local multi-user acceptance matrix.

## Remaining limits

Production hardening still requires proxy/TLS setup, distributed abuse limits, operator error/worker monitoring, a full restore drill on another machine, load and concurrency testing, physical devices/Safari/Firefox, extension store/provider policy review and broader retrieval evaluation. The current SQLite deployment targets one private server, one API process and one worker; embedded Chroma is for local mode and Compose uses private HTTP Chroma.

Local account recovery is an administrator CLI action. Email verification/delivery, provider OAuth, and automatic server-side provider feeds are not supplied. Capture uses only explicitly authorized visible pages; API names do not establish provider compatibility. Stripe remains in the legacy Supabase deployment and is unavailable in the private self-hosted mode. No provider account or customer transaction was connected.

See `services/memory-api/README.md` for exact Windows/Linux commands, connection setup, privacy behavior, migration, backup and restore.
