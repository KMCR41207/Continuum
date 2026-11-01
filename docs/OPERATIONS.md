# Local setup and deployment operations

## Database

Apply SQL migrations 001 through 006 in filename order with the Supabase migration role. Migration 005 requires pgvector in the `extensions` schema. On an existing project with pgvector installed in another schema, inspect and move/configure the extension schema before applying 005; do not drop existing vectors. `service_role`, `authenticated`, `anon` and the Supabase `auth.users` schema must exist. Fresh test databases emulate these explicitly.

Each migration is transactional. Back up before applying. Do not roll back by deleting the new tables: they may hold invitations, subscriptions, jobs and user data. On a failed migration, PostgreSQL rolls back that migration. After a successful migration, prefer a forward corrective migration or restore the pre-migration backup during a coordinated maintenance window. Stop the API and worker before restoring, and reconcile Stripe state afterwards. Older frontend versions can still read base data; do not run an old worker against an unknown queue schema.

Operational limits live in `plan_catalog.limits` (`memories`, `conversations`, `connections`, `projects`). Default Free values are development operational ceilings, not commercial promises. Paid plans are disabled and have no price IDs until the operator configures them. Updating plan rows requires an administrative database connection; workspace users cannot edit entitlements.

## Processes and secrets

Use Node 22.18+ (Node 24+ recommended), `pnpm install`, and keep local secret files out of Git.

- Website `.env`: only public `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, optional `VITE_API_URL`, and Google auth flag. Vite rejects recognizable privileged keys and secret-named public variables.
- API/worker `.env.server`: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_ORIGIN`, optional Stripe and embedding configuration. Never copy this file into a client/MCP configuration.
- MCP process environment: only `CONTINUUM_SUPABASE_URL`, `CONTINUUM_SUPABASE_KEY`, bind/port/host/origin settings, and optional embedding query-provider configuration. The local stdio/CLI also needs `CONTINUUM_TOKEN`; the HTTP bridge obtains it from each request's Authorization header. No service-role key is needed or accepted as its publishable key.

Commands:

```text
pnpm dev
pnpm api
pnpm worker
pnpm worker -- --once
node server/http.ts
node server/mcp.ts
node server/cli.ts diagnostics
```

`pnpm api` and `pnpm worker` load `.env.server` if present. `pnpm mcp:http` loads the separate `.env.mcp` file; supply only its publishable Supabase key and MCP host/origin settings, never a service-role key. For deployment each process can receive its separately scoped environment directly. Bind defaults are loopback. Configure a TLS reverse proxy, allowed Host headers and exact `APP_ORIGIN` before public exposure. Never log Authorization headers, RPC payloads, passwords, embedding text or tokens. Process request limits are not a substitute for edge/IP limits across replicas.

API routes:

- `GET /api/config`: non-secret capability configuration.
- `POST /api/billing/checkout`: verified user, workspace owner and enabled approved price.
- `POST /api/billing/portal`: verified owner; real existing Stripe customer.
- `POST /api/billing/webhook`: raw-body Stripe signature verification, authoritative subscription fetch, idempotent ordered persistence.
- `POST /api/account/delete`: verified user, exact confirmation phrase and fresh password authentication; SQL rejects shared ownership/uncanceled subscriptions before atomic deletion.
- `GET /health`: process/configuration state, no secret values.
- Separate MCP service: `/mcp`, using the official stateless Streamable HTTP transport and scoped bearer tokens.

## Semantic indexing and worker

Set `EMBEDDING_URL` to an HTTPS OpenAI-compatible embedding endpoint, `EMBEDDING_MODEL` to its actual model, and `EMBEDDING_API_KEY`. It must accept/request **384** dimensions; different dimensions require a deliberate schema/index migration and reindex. Workspace owners explicitly authorize sending approved non-sensitive memory text before jobs are created. Source exclusions and withdrawn consent stop processing/storage. In-flight provider requests cannot be recalled; communicate the configured provider's privacy policy before obtaining consent.

Run the worker under a process supervisor. Claims use `FOR UPDATE SKIP LOCKED`, two-minute leases, five attempts and exponential delay (capped at one hour). Pausing invalidates the lease; expired leases can be reclaimed. Terminal failures stay visible until retried or pruned. Existing jobs are rechecked against current source/version/consent and, for imports, the submitting member's role. No automatic provider feed is configured.

Use MCP `search_memory` with `mode: "hybrid"` to request the optional provider path. If the provider is unconfigured/unavailable, full-text results remain available with an explicit fallback label. Default search stays full-text. Hybrid scoring combines vector similarity, full-text rank, confidence and recency only after project/source permission filtering.

## Billing and account deletion

Use Stripe **test mode first**. Configure `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, exact `APP_ORIGIN`, approved recurring prices in `plan_catalog`, and the Stripe billing portal's allowed plan/cancellation options. Subscribe to customer subscription created/updated/deleted and invoice payment success/failure events. Checkout redirects do not activate entitlement; verified webhooks do. Alert on failed mapping/signature/processing responses and let Stripe retry. Test duplicate/out-of-order deliveries.

Account deletion removes the Supabase auth row transactionally with its dependent workspace data, after recent password verification at the application server. Shared workspace owners must transfer first; subscriptions must be canceled. Memberships in other people's workspaces are removed without deleting their shared content. No binary storage has been introduced; if object storage is later added, extend preflight/deletion before claiming complete deletion. External Stripe customer/invoice records remain subject to the payment provider's retention policies.

## Verification

`pnpm test`, `pnpm test:e2e`, `pnpm test:connections-ui`, `pnpm build`.

Local SQL/protocol tests use PGlite with pgvector and a test-only Auth identity shim. Browser product tests use clearly identified wire fixtures. Live Supabase Auth/SMTP, Stripe test checkout and real embeddings must be tested separately with configured services. The final feature/status matrix is in `PRODUCT-IMPLEMENTATION-STATUS.md` at the repository root.

## Capture investigation

The existing authorized normalized import remains the supported input boundary. [Claude documents user-requested conversation exports](https://support.claude.com/en/articles/9450526-export-your-claude-data). That describes an export workflow, not a continuous third-party chat feed or a stable parser contract. Without authorized export samples and real provider sessions, no adapter or automatic synchronization is advertised. No cookies, passwords, hidden state or provider access controls were inspected.

Official references used: [MCP remote connections](https://modelcontextprotocol.io/docs/develop/connect-remote-servers), [Stripe webhooks](https://docs.stripe.com/webhooks), [Supabase HNSW vector indexing](https://supabase.com/docs/guides/ai/vector-indexes/hnsw-indexes), [PGlite extension support](https://pglite.dev/extensions/).
