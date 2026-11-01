import { beforeAll, afterAll, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { readFile, readdir } from "node:fs/promises";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { createMcpHttpServer } from "../../server/http";
let pg: PGlite, w: string, p: string, conversation: string, memory: string;
const owner = "11111111-1111-4111-8111-111111111111",
  member = "22222222-2222-4222-8222-222222222222",
  other = "33333333-3333-4333-8333-333333333333";
async function user(id = owner) {
  await pg.exec("reset role");
  await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await pg.exec("set role authenticated");
}
async function service() {
  await pg.exec("reset role");
  await pg.query("select set_config('request.jwt.claim.sub','',false)");
  await pg.exec("set role service_role");
}
async function rpc(name: string, args: unknown[] = []) {
  return (
    await pg.query<{ r: any }>(
      `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) r`,
      args,
    )
  ).rows[0].r;
}
const input = {
  title: "Architecture",
  platform: "chatgpt",
  messages: [
    { role: "user", content: "This project uses React and PostgreSQL." },
  ],
};
beforeAll(async () => {
  pg = await PGlite.create({ extensions: { vector } });
  await pg.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,service_role;grant execute on function auth.uid() to authenticated,service_role;",
  );
  await pg.query(
    "insert into auth.users values($1,'owner@example.test',now()),($2,'member@example.test',now()),($3,'other@example.test',now())",
    [owner, member, other],
  );
  const root = new URL("../../supabase/migrations/", import.meta.url);
  for (const file of (await readdir(root))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await pg.exec(await readFile(new URL(file, root), "utf8"));
  await user();
  w = await rpc("create_workspace", ["Product tests"]);
  p = (
    await pg.query<{ id: string }>(
      "insert into public.projects(workspace_id,name) values($1,'Atlas') returning id",
      [w],
    )
  ).rows[0].id;
}, 60000);
afterAll(async () => {
  await pg?.close();
});
it("invitation acceptance checks verified email, prevents role escalation and supports revocation", async () => {
  await user();
  const invite = await rpc("invite_member", [
    w,
    "member@example.test",
    "viewer",
  ]);
  await user(other);
  await expect(rpc("accept_invitation", [invite.token])).rejects.toThrow(
    /Invitation invalid/,
  );
  await user(member);
  expect(await rpc("accept_invitation", [invite.token])).toBe(w);
  await expect(
    rpc("invite_member", [w, "other@example.test", "editor"]),
  ).rejects.toThrow(/owner required/);
  await expect(
    pg.query(
      "insert into public.projects(workspace_id,name) values($1,'Denied')",
      [w],
    ),
  ).rejects.toThrow(/row-level security/);
  await expect(
    pg.query("select token_hash from public.workspace_invitations"),
  ).rejects.toThrow(/permission denied/);
  await user();
  await rpc("manage_member", [w, "role", member, "editor"]);
  await user(member);
  expect(
    (
      await pg.query(
        "insert into public.projects(workspace_id,name) values($1,'Editor project') returning id",
        [w],
      )
    ).rows,
  ).toHaveLength(1);
  await user();
  const revoked = await rpc("invite_member", [
    w,
    "other@example.test",
    "editor",
  ]);
  await rpc("manage_member", [w, "revoke_invite", revoked.id, null]);
  await user(other);
  await expect(rpc("accept_invitation", [revoked.token])).rejects.toThrow(
    /Invitation invalid/,
  );
  await user();
});
it("durable imports persist, pause, resume, claim leases and deduplicate", async () => {
  const job = await rpc("enqueue_import", [w, p, JSON.stringify(input)]);
  expect(await rpc("enqueue_import", [w, p, JSON.stringify(input)])).toBe(job);
  await rpc("control_job", [job, "pause"]);
  await service();
  expect(await rpc("claim_jobs", [5])).toEqual([]);
  await user();
  await rpc("control_job", [job, "resume"]);
  await service();
  const claimed = await rpc("claim_jobs", [5]);
  expect(claimed).toHaveLength(1);
  await expect(rpc("run_import_job", [job, other])).rejects.toThrow(/lease/);
  const result = await rpc("run_import_job", [job, claimed[0].lease_id]);
  conversation = result.id;
  expect(result.proposals).toBe(1);
  await user();
  const usage = await rpc("workspace_usage", [w]);
  expect(usage.conversations).toBe(1);
  expect(usage.memories).toBe(1);
  expect(usage.stored_text_bytes).toBeGreaterThan(0);
  expect(usage.last_successful_sync).toBeTruthy();
  memory = (
    await pg.query<{ id: string }>(
      "update public.memories set status='active' where workspace_id=$1 returning id",
      [w],
    )
  ).rows[0].id;
  expect(
    (
      await rpc("search_memories", [
        w,
        "React",
        "active",
        null,
        p,
        "chatgpt",
        0,
      ])
    ).total,
  ).toBe(1);
  expect(
    (
      await rpc("search_memories", [
        w,
        "React",
        "active",
        null,
        "global",
        null,
        0,
      ])
    ).total,
  ).toBe(0);
});
it("failed jobs roll back imports, back off, and eventually become terminal", async () => {
  const job = await rpc("enqueue_import", [
    w,
    p,
    JSON.stringify({
      ...input,
      messages: [{ role: "invalid", content: "Broken import" }],
    }),
  ]);
  await service();
  let jobs = await rpc("claim_jobs", [5]);
  expect(jobs[0].id).toBe(job);
  expect(
    (await rpc("run_import_job", [job, jobs[0].lease_id])).error,
  ).toBeTruthy();
  await user();
  let row = (
    await pg.query<{ status: string; attempts: number; available_at: string }>(
      "select status,attempts,available_at from public.sync_jobs where id=$1",
      [job],
    )
  ).rows[0];
  expect(row.status).toBe("queued");
  expect(row.attempts).toBe(1);
  await pg.exec("reset role");
  await pg.query(
    "update public.sync_jobs set attempts=4,available_at=now() where id=$1",
    [job],
  );
  await service();
  jobs = await rpc("claim_jobs", [5]);
  await rpc("run_import_job", [job, jobs[0].lease_id]);
  await user();
  expect(
    (
      await pg.query<{ status: string }>(
        "select status from public.sync_jobs where id=$1",
        [job],
      )
    ).rows[0].status,
  ).toBe("failed");
});
it("semantic processing requires consent, validates dimensions and filters by source permissions", async () => {
  await rpc("configure_semantic", [w, true]);
  await service();
  const jobs = await rpc("claim_jobs", [5]);
  const job = jobs.find((j: any) => j.kind === "embedding");
  expect(job).toBeTruthy();
  expect(
    (await rpc("embedding_job_input", [job.id, job.lease_id])).content,
  ).toContain("React");
  await expect(
    rpc("complete_embedding_job", [job.id, job.lease_id, "fixture", "[1,0]"]),
  ).rejects.toThrow();
  const v = [1, ...Array(383).fill(0)];
  await rpc("complete_embedding_job", [
    job.id,
    job.lease_id,
    "fixture",
    JSON.stringify(v),
  ]);
  await user();
  const connection = await rpc("configure_connection", [
    w,
    null,
    "other",
    "Semantic agent",
    JSON.stringify({ retrieval: true, project_ids: [p], all_history: true }),
    false,
    false,
  ]);
  expect(
    await rpc("semantic_search", [
      connection.token,
      "interface",
      JSON.stringify(v),
      "fixture",
      p,
    ]),
  ).toHaveLength(1);
  await pg.query("update public.conversations set excluded=true where id=$1", [
    conversation,
  ]);
  expect(
    await rpc("semantic_search", [
      connection.token,
      "interface",
      JSON.stringify(v),
      "fixture",
      p,
    ]),
  ).toEqual([]);
  await pg.query("update public.conversations set excluded=false where id=$1", [
    conversation,
  ]);
  await rpc("configure_semantic", [w, false]);
  expect(
    await rpc("semantic_search", [
      connection.token,
      "interface",
      JSON.stringify(v),
      "fixture",
      p,
    ]),
  ).toEqual([]);
});
it("semantic reindex requires owner consent and worker health remains service-only", async () => {
  await user();
  await expect(rpc("reindex_semantic", [w])).rejects.toThrow(/consent/);
  await rpc("configure_semantic", [w, true]);
  await pg.exec("reset role");
  const activeJob = (
    await pg.query<{ id: string }>(
      "select id from public.sync_jobs where workspace_id=$1 and kind='embedding' limit 1",
      [w],
    )
  ).rows[0];
  await pg.query(
    "update public.sync_jobs set status='running',lease_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',lease_until=now()+interval '2 minutes' where id=$1",
    [activeJob.id],
  );
  await user();
  expect(await rpc("reindex_semantic", [w])).toBeGreaterThanOrEqual(1);
  await pg.exec("reset role");
  expect(
    (
      await pg.query<{ status: string; lease_id: string | null }>(
        "select status,lease_id from public.sync_jobs where id=$1",
        [activeJob.id],
      )
    ).rows[0],
  ).toMatchObject({ status: "queued", lease_id: null });
  await user();
  await expect(
    rpc("heartbeat_worker", ["fixture-worker", "healthy", null]),
  ).rejects.toThrow(/permission denied/);
  await service();
  await rpc("heartbeat_worker", ["fixture-worker", "healthy", null]);
  await user();
  expect(await rpc("worker_health")).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        worker_id: "fixture-worker",
        state: "healthy",
      }),
    ]),
  );
  await rpc("configure_semantic", [w, false]);
});
it("reviewed handoff is destination-specific and never broadens permissions", async () => {
  const connection = await rpc("configure_connection", [
    w,
    null,
    "claude",
    "Destination",
    JSON.stringify({ retrieval: true, project_ids: [p], all_history: true }),
    false,
    false,
  ]);
  const noHistory = await rpc("configure_connection", [
    w,
    null,
    "other",
    "No history",
    JSON.stringify({ retrieval: true, project_ids: [p] }),
    false,
    false,
  ]);
  await expect(
    rpc("prepare_handoff", [p, conversation, noHistory.id, "Implement this"]),
  ).rejects.toThrow(/Destination lacks/);
  const preview = await rpc("prepare_handoff", [
    p,
    conversation,
    connection.id,
    "Implement this",
  ]);
  expect(preview.messages).toHaveLength(1);
  await expect(
    rpc("confirm_handoff", [
      p,
      conversation,
      connection.id,
      "Changed note",
      JSON.stringify(preview),
    ]),
  ).rejects.toThrow(/changed/);
  await rpc("confirm_handoff", [
    p,
    conversation,
    connection.id,
    "Implement this",
    JSON.stringify(preview),
  ]);
  expect(await rpc("get_agent_handoffs", [connection.token, p])).toHaveLength(
    1,
  );
  expect(await rpc("get_agent_handoffs", [noHistory.token, p])).toEqual([]);
  await rpc("configure_connection", [
    w,
    connection.id,
    "claude",
    "Destination",
    JSON.stringify({ retrieval: true, project_ids: [p] }),
    false,
    false,
  ]);
  expect(await rpc("get_agent_handoffs", [connection.token, p])).toEqual([]);
});
it("billing events are service-only, idempotent and resist stale events", async () => {
  await expect(
    rpc("apply_billing_event", [
      "e1",
      w,
      "subscription",
      100,
      JSON.stringify({ plan: "free", status: "active" }),
    ]),
  ).rejects.toThrow(/permission denied/);
  await service();
  const data = JSON.stringify({
    plan: "free",
    customer_id: "cus_fixture",
    subscription_id: "sub_fixture",
    status: "active",
  });
  await rpc("apply_billing_event", ["e1", w, "subscription", 100, data]);
  await rpc("apply_billing_event", ["e1", w, "subscription", 100, data]);
  await rpc("apply_billing_event", [
    "e0",
    w,
    "subscription",
    50,
    JSON.stringify({ plan: "free", status: "canceled" }),
  ]);
  await user();
  expect((await rpc("workspace_usage", [w])).billing_status).toBe("active");
});
it("actual HTTP MCP client retrieves data, respects revocation, and rejects foreign origins", async () => {
  await user();
  const credential = await rpc("configure_connection", [
    w,
    null,
    "other",
    "HTTP agent",
    JSON.stringify({ retrieval: true, project_ids: [p], all_history: true }),
    false,
    false,
  ]);
  const server = createMcpHttpServer({
    allowedOrigins: ["https://continuum.example"],
    gateway:
      (token) =>
      async (operation, args = {}) => {
        await pg.exec("reset role");
        await pg.query("select set_config('request.jwt.claim.sub','',false)");
        await pg.exec("set role anon");
        const r =
          operation === "get_handoffs"
            ? await rpc("get_agent_handoffs", [token, args.project_id || null])
            : await rpc("agent_request", [
                token,
                operation,
                JSON.stringify(args),
              ]);
        if (r?.error) throw new Error(`${r.code}: ${r.error}`);
        return r;
      },
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = new URL(
    `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`,
  );
  const client = new Client({ name: "continuum-http-test", version: "1.0.0" });
  try {
    expect(
      (
        await fetch(url, {
          method: "POST",
          headers: { Origin: "https://hostile.example" },
        })
      ).status,
    ).toBe(403);
    expect((await fetch(url, { method: "POST" })).status).toBe(401);
    await client.connect(
      new StreamableHTTPClientTransport(url, {
        requestInit: {
          headers: { Authorization: `Bearer ${credential.token}` },
        },
      }),
    );
    const result = await client.callTool({
      name: "search_memory",
      arguments: { query: "React" },
    });
    expect(JSON.stringify(result)).toContain("PostgreSQL");
    await user();
    await rpc("configure_connection", [
      w,
      credential.id,
      "other",
      "HTTP agent",
      JSON.stringify({ retrieval: true, project_ids: [p], all_history: true }),
      false,
      true,
    ]);
    await expect(
      client.callTool({ name: "search_memory", arguments: { query: "React" } }),
    ).rejects.toThrow();
  } finally {
    await client.close();
    await new Promise<void>((r) => server.close(() => r()));
    await user();
  }
});
it("exports new product records without credential digests, enforces quotas, and validates retention", async () => {
  await user();
  const data = await rpc("export_account");
  expect(data.workspaces[0].jobs.length).toBeGreaterThan(0);
  expect(data.workspaces[0].members.length).toBe(2);
  expect(JSON.stringify(data)).not.toMatch(/token_hash|lease_id/);
  await expect(
    rpc("prune_operational_history", [w, new Date().toISOString()]),
  ).rejects.toThrow(/30 days/);
  await pg.exec("reset role");
  await pg.exec(
    "update public.plan_catalog set limits=jsonb_set(limits,'{memories}','1') where id='free'",
  );
  await user();
  const duplicate = await rpc("import_conversation", [
    w,
    p,
    JSON.stringify(input),
    "ignored",
    null,
  ]);
  expect(duplicate.duplicate).toBe(true);
  await expect(
    rpc("import_conversation", [
      w,
      p,
      JSON.stringify({
        ...input,
        title: "Another architecture",
        messages: [
          { role: "user", content: "This project uses Python and SQLite." },
        ],
      }),
      "ignored",
      null,
    ]),
  ).rejects.toThrow(/limit reached/);
  await pg.exec("reset role");
  await pg.exec(
    "update public.plan_catalog set limits=jsonb_set(limits,'{memories}','100000') where id='free'",
  );
  await user();
});
it("ownership transfer is atomic, preserves a single owner, and revokes old credentials", async () => {
  const extra = await rpc("create_workspace", ["Transfer test"]);
  const invitation = await rpc("invite_member", [
    extra,
    "member@example.test",
    "viewer",
  ]);
  await user(member);
  await rpc("accept_invitation", [invitation.token]);
  await user();
  const c = await rpc("configure_connection", [
    extra,
    null,
    "other",
    "Old owner token",
    JSON.stringify({ retrieval: true, global_access: true }),
    false,
    false,
  ]);
  await rpc("manage_member", [extra, "transfer", member, null]);
  expect((await rpc("agent_request", [c.token, "status", "{}"])).code).toBe(
    "unauthorized",
  );
  await expect(
    rpc("invite_member", [extra, "other@example.test", "viewer"]),
  ).rejects.toThrow(/owner required/);
  await user(member);
  const members = await rpc("list_members", [extra]);
  expect(members.filter((m: any) => m.role === "owner")).toHaveLength(1);
  expect(members.find((m: any) => m.user_id === owner).role).toBe("editor");
  await user();
});
it("deletion rejects shared ownership and active subscriptions before atomic cascade", async () => {
  await expect(rpc("delete_account_data", [owner])).rejects.toThrow(
    /permission denied/,
  );
  await service();
  await expect(rpc("delete_account_data", [owner])).rejects.toThrow(
    /Transfer shared/,
  );
  await user();
  await rpc("manage_member", [w, "remove", member, null]);
  await service();
  await expect(rpc("delete_account_data", [owner])).rejects.toThrow(
    /Cancel subscriptions/,
  );
  await rpc("apply_billing_event", [
    "e2",
    w,
    "subscription",
    200,
    JSON.stringify({
      plan: "free",
      customer_id: "cus_fixture",
      subscription_id: "sub_fixture",
      status: "canceled",
    }),
  ]);
  await rpc("delete_account_data", [owner]);
  await pg.exec("reset role");
  expect(
    (await pg.query("select * from public.workspaces where id=$1", [w])).rows,
  ).toEqual([]);
  expect((await pg.query("select * from public.memories")).rows).toEqual([]);
});
