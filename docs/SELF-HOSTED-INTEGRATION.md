# Self-hosted integration and migration plan

The React website, styles, animations, Supabase SQL migrations, and TypeScript MCP/CLI remain in place. Explicit `VITE_BACKEND_MODE=selfhosted` selects the FastAPI adapter; absent this setting, existing Supabase behavior is preserved. The adapter implements the dashboard's existing data contract against the same Python services as REST and Python MCP.

In self-hosted mode SQLite is authoritative for identities, permissions, sources, review states, jobs, files, and audit history. Chroma is a rebuildable index of approved, non-sensitive memory. Every vector hit is reauthorized against SQLite. No dual writes to Supabase occur. Supabase remains the authentication/storage option for the legacy deployment; self-hosted mode uses locally hashed passwords and revocable sessions.

Python owns ingestion, authorization, retrieval, file processing, jobs, and compaction in self-hosted mode. The TypeScript gateway can select `CONTINUUM_API_URL` and continue serving existing MCP/CLI clients; Python MCP uses that same API. Both require the same scoped API key and recheck permissions for each operation.

Migration is offline and explicit: export the existing workspace, stop its writers, back up source and destination, import into an empty selected self-hosted workspace, validate IDs/counts/provenance, and switch clients. Existing Supabase keys must be revoked and reissued; credential hashes/owner passwords are never imported or synthesized. Rebuild vectors from reviewed records after local embedding setup. Keep the old database read-only until acceptance; no automatic reconciliation or deletion occurs.

Implementation/verification details and quick start are in `services/memory-api/README.md`. Embedded SQLite/Chroma target a single private server with one API and worker; use server-backed storage before horizontal scaling.
