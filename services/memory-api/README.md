# Continuum self-hosted service

This mode runs without a cloud database. SQLite is authoritative, Chroma is a rebuildable private vector index, and the existing React dashboard uses the same Python authorization/services as REST and MCP. Supabase mode remains available separately. See [integration decisions](../../docs/SELF-HOSTED-INTEGRATION.md).

## Local quick start (Windows / Linux)

Install Python 3.12, Node, pnpm and uv. At the repository root:

```text
pnpm install
cd services/memory-api
uv sync --locked --extra test --extra local-model
uv run --no-sync python -m app.admin prepare-model
cd ../..
pnpm selfhosted
```

Open the Vite URL, choose **Open workspace**, and create the first local administrator. This creates a real password hash, private workspace and revocable session on this machine. No Supabase credentials or confirmation email is required. On later visits use that local account. Network first-owner setup is refused: configure the installation from loopback first. Additional accounts are created by `python -m app.admin create-user --email person@example.com` with an interactive password prompt, then invited through the existing Team page. Password recovery uses `reset-password --email ...`; no fake reset email is sent.

Run the worker separately from `services/memory-api`: `uv run --no-sync python -m app.worker`. For one job use `--once`; inspect compaction eligibility without writing jobs using `--dry-run`. API-only: `uv run --no-sync uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000`. The launcher starts API and web; it does not silently start destructive retention work.

The default Sentence Transformers provider runs locally. `prepare-model` downloads public model weights; private input is embedded locally. Runtime defaults to cached files only, with remote model code disabled. Without installed/cached weights, ingestion/review/full-text retrieval continue and embedding jobs retry honestly. Ollama may be selected via `CONTINUUM_EMBEDDING_PROVIDER=ollama`, model and local `/api/embed` URL. Dimensions come from the model; collections are keyed by model identity plus dimensions. After a model change select Reindex approved memories. No random or lexical hashes are production embeddings.

## Use connections

Create a project, import a conversation, inspect evidence in Memories, and approve it. In Connections create a retrieval credential with the project and explicit source-history access. Copy its one-time token to the agent's private environment. Capture and writing are independent, default-off permissions. Extension credentials should be capture-only with short expiration. File-derived memory also requires `files_read` for agents.

```json
{
  "mcpServers": {
    "continuum": {
      "command": "C:/absolute/project/services/memory-api/.venv/Scripts/python.exe",
      "args": ["-m", "app.mcp_server"],
      "cwd": "C:/absolute/project/services/memory-api",
      "env": {
        "CONTINUUM_API_URL": "http://127.0.0.1:8000",
        "CONTINUUM_TOKEN": "<private scoped token>"
      }
    }
  }
}
```

On Linux use `.venv/bin/python`. This is a generic configuration template; named client compatibility is not claimed. A real official SDK stdio client is tested. `python -m app.mcp_server --http` exposes Streamable HTTP on loopback port 8001 `/mcp`, requiring each caller's scoped bearer token. Expose only behind an authenticated HTTPS reverse proxy with request/body/rate limits. No OAuth discovery/registration server is supplied. Tool discovery does not force a model to call tools.

The existing TypeScript MCP/CLI can also set `CONTINUUM_API_URL` and `CONTINUUM_TOKEN`; its gateway then calls Python instead of Supabase. Do not run simultaneous writers against both stores for the same workspace.

## API

Interactive OpenAPI documentation: `http://127.0.0.1:8000/docs`. Core endpoints include `/health`, `/api/v1/auth/{setup,login,refresh,logout}`, `/api/v1/conversations/import`, `/api/v1/memory/{ingest,query}`, `/api/v1/memories`, `/api/v1/projects`, `/api/v1/files/upload`, `/api/v1/connections`, and `/api/v1/agent/{operation}`. Existing dashboard data/RPC compatibility endpoints are member-only and have fixed table/field allowlists; they do not expose arbitrary SQL.

All imported candidates and agent-written facts require review. File uploads are parsed to pending source-linked chunks. Supported: UTF-8 text/Markdown/code/JSON/CSV, PDF, DOCX; 10 MB input, extracted-text/page/archive limits. Uploaded names never become disk paths. The API refuses unsupported/binary/encrypted/excessive input; parsers never execute uploaded code.

Retrieval filters current SQLite approval, sensitivity, workspace/project/source/file/history permissions after Chroma returns hits. Stale-version/deleted vectors cannot restore access. FTS5 is the fallback. A conservative UTF-8 byte estimate budgets the entire returned items JSON, including provenance; it intentionally returns fewer items than a model-specific tokenizer might permit.

## Compaction and privacy

Compaction is off until the workspace owner enables it in Security and data. Default age is `CONTINUUM_RAW_CONVERSATION_RETENTION_DAYS=14`. Projects/conversations can be excluded using their `compaction_excluded` property through the authenticated data API. The worker claims an idempotent job, calls the configured local Ollama model, rechecks source/lease/consent, persists the summary and pending sensitive summary candidate, verifies them, then marks complete. Raw messages remain by default. Redaction requires both `CONTINUUM_REDACT_AFTER_COMPACTION=true` and workspace policy `redact_after_verified_compaction`. Failures preserve raw content and retry; model summaries are never automatically approved facts.

Remote embedding/summarization requires explicit `CONTINUUM_ALLOW_REMOTE_PROCESSING=true`, an HTTPS endpoint and provider credentials in server-only configuration. Summary providers: local Ollama, OpenAI-compatible chat completions, Anthropic messages. Remote providers were not live-tested. Review their retention terms before enabling workspace processing. This mode is not fully local when you choose remote processing.

## Docker

From root: `docker compose up --build -d`. Web is loopback port 8080; API loopback port 8000; Chroma is on the private compose network. API/worker run as UID 10001. Initialize the local account through API loopback or create a user interactively with `docker compose exec api .venv/bin/python -m app.admin create-user --email ...`. Prepare the model cache with `docker compose exec api .venv/bin/python -m app.admin prepare-model`. Configure an Ollama endpoint reachable from the containers before enabling compaction. Docker is not installed in the development environment, so image builds/compose/volume ownership need runtime acceptance.

Do not expose SQLite, uploads, Chroma ports, or development Vite to the internet. Use TLS, exact origins/hosts, edge rate limits and operator monitoring for network deployment. API limits are per process; they are not distributed limits. The SQLite WAL/busy timeout design targets one private machine, one API process, one worker and local persistent volumes. Chroma HTTP is used in Compose to avoid embedded index writers in separate containers.

## Migration / backup / restore

Alembic runs non-destructive upgrades at API/worker startup; `uv run --no-sync alembic upgrade head` is also available. Never edit the old Supabase migrations. Offline import: stop both stores' writers, export the Supabase workspace, back up, then `python -m app.admin import-snapshot --email OWNER --workspace LOCAL_WORKSPACE_ID --path EXPORT.json --services-stopped`. Target must be empty. IDs/source/version records are preserved; credentials/passwords are not imported. Reissue scoped keys and rebuild vectors, verify counts and current access, switch clients, then keep the old store read-only. No dual writes occur.

Stop API and worker before snapshots. Embedded mode: `python -m app.admin backup --path /private/new-backup --services-stopped`. It uses SQLite's backup API and copies local Chroma/uploads/signing material with SHA-256 manifest. Restore only to an empty data directory: set `CONTINUUM_DATA_DIR`, then `python -m app.admin restore --path BACKUP --services-stopped`. Integrity and manifest checks run; existing data is never overwritten. Backups contain private data and signing material; encrypt and access-restrict them. For Compose, also stop Chroma and snapshot the `continuum-chroma` volume at the same maintenance boundary; the Python embedded snapshot cannot copy an external Chroma server volume. Test restoration before relying on a backup.

## Verification and limits

`uv run --no-sync pytest -q`; from root `pnpm exec playwright test --config playwright.selfhosted.config.ts`, `pnpm test`, `pnpm test:connections-ui`, `pnpm test:e2e`, `pnpm build`.

SQLite/Chroma, API authorization, real MCP transport, compaction safety and browser persistence have automated coverage. Model fixtures are labeled in tests; optional local-model evaluation is separate. Provider account DOM capture, real remote model calls, Docker, Firefox release behavior, distributed operation, restore on another host, SMTP and commercial billing remain deployment/provider acceptance. Stripe stays in the legacy deployment; self-hosted mode does not fabricate a paid subscription.
