# Memory connection audit — 2026-10-31

## Before implementation

| Area | Finding | Evidence |
| --- | --- | --- |
| Provider connections | UI only, honestly labelled planned | `src/config/integrations.ts`, `Connections` and `Agents` in `OtherPages.tsx` |
| Auth / tenancy | Implemented for website; no agent credentials | `AuthContext.tsx`; `is_member`, RLS and column grants in migration 001; `database.test.ts` |
| Capture | Partial: normalized manual JSON import only | `api.importConversation`, `conversationSchema`, `import_conversation` RPC |
| Extraction | Partial: client-side conservative rules, evidence checked by SQL | `extractProposals`; pending approval enforced in RPC |
| Storage / provenance | Implemented | `conversations`, `messages`, `memories`, `memory_sources` |
| Correction / deletion / export | Implemented for workspace users | `version_memory`, `delete_derived_memories`, `export_workspace`; database tests |
| Search / embeddings / conflicts | Partial UI text filtering; no database retrieval or embeddings | `Memories.tsx`; no search service or vector columns |
| Independent permissions | Not implemented | No connection tables or scoped authorization functions |
| Projects | Partial: instructions and scoped records, no agent access | `Projects.tsx`, composite project/workspace foreign keys |
| MCP / CLI | Not implemented | No server, SDK, CLI or actual client tests |
| Cross-platform tests | Not implemented | Existing tests exercise website and member RPCs only |

No live provider was connected. Existing code does not satisfy the requested cross-platform workflow. New implementation and verification results are recorded in `MEMORY-CONNECTIONS.md`.
