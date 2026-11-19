/**
 * extraction-db.test.ts
 * Database tests for migration 008_llm_extraction.sql.
 *
 * Tests: enqueue_extraction, extraction_job_input, complete_extraction_job,
 * configure_llm_extraction, auto-queue trigger, idempotency, security.
 */
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { readFile, readdir } from "node:fs/promises";

let pg: PGlite;
const owner = "11111111-1111-4111-8111-111111111111";
let workspace: string;
let project: string;
let conversation: string;

async function asUser(id = owner) {
  await pg.exec("reset role");
  await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await pg.exec("set role authenticated");
}
async function asService() {
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

const sampleConversation = {
  title: "Architecture session",
  platform: "chatgpt",
  messages: [
    {
      role: "user",
      content: "We decided to use PostgreSQL for the application database. I prefer TypeScript for all new services.",
    },
    {
      role: "assistant",
      content: "Great choices.",
    },
  ],
};

beforeAll(async () => {
  pg = await PGlite.create({ extensions: { vector } });
  await pg.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;" +
    "create schema auth;" +
    "create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);" +
    "create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;" +
    "grant usage on schema auth to authenticated,service_role;" +
    "grant execute on function auth.uid() to authenticated,service_role;",
  );
  await pg.query("insert into auth.users values($1,'owner@test.dev',now())", [owner]);

  const root = new URL("../../supabase/migrations/", import.meta.url);
  for (const file of (await readdir(root)).filter((f) => f.endsWith(".sql")).sort())
    await pg.exec(await readFile(new URL(file, root), "utf8"));

  await asUser();
  workspace = await rpc("create_workspace", ["Extraction tests"]);
  project = (
    await pg.query<{ id: string }>(
      "insert into public.projects(workspace_id,name) values($1,'Atlas') returning id",
      [workspace],
    )
  ).rows[0].id;

  // Import a conversation so we have something to extract from
  const result = await rpc("import_conversation", [
    workspace, project,
    JSON.stringify(sampleConversation),
    "ignored", null,
  ]);
  conversation = result.id;
}, 60000);

afterAll(async () => { await pg?.close(); });

describe("enqueue_extraction", () => {
  it("enqueues an extraction job for an existing conversation", async () => {
    await asUser();
    const jobId = await rpc("enqueue_extraction", [workspace, conversation]);
    expect(typeof jobId).toBe("string");
    const job = (
      await pg.query<{ kind: string; status: string }>(
        "select kind, status from public.sync_jobs where id=$1",
        [jobId],
      )
    ).rows[0];
    expect(job.kind).toBe("extraction");
    expect(job.status).toBe("queued");
  });

  it("is idempotent — returns same job ID on second call", async () => {
    await asUser();
    const id1 = await rpc("enqueue_extraction", [workspace, conversation]);
    const id2 = await rpc("enqueue_extraction", [workspace, conversation]);
    expect(id1).toBe(id2);
  });

  it("rejects when conversation does not belong to workspace", async () => {
    await asUser();
    const fakeConv = "00000000-0000-0000-0000-000000000000";
    await expect(rpc("enqueue_extraction", [workspace, fakeConv])).rejects.toThrow();
  });

  it("is inaccessible to anonymous users", async () => {
    await pg.exec("reset role; set role anon");
    await expect(
      pg.query("select public.enqueue_extraction($1,$2)", [workspace, conversation]),
    ).rejects.toThrow(/permission denied/);
    await asUser();
  });
});

describe("extraction_job_input", () => {
  it("returns conversation payload for a valid running job", async () => {
    await asUser();
    const jobId = await rpc("enqueue_extraction", [workspace, conversation]);

    // Claim the job as service role
    await asService();
    const claimed = await rpc("claim_jobs", [5]);
    const job = claimed.find((j: any) => j.id === jobId);
    expect(job).toBeTruthy();

    const input = await rpc("extraction_job_input", [jobId, job.lease_id]);
    expect(input.title).toBe("Architecture session");
    expect(input.platform).toBe("chatgpt");
    expect(Array.isArray(input.messages)).toBe(true);
    expect(input.messages.length).toBeGreaterThan(0);
    expect(input.messages[0].role).toBe("user");
    await pg.exec("reset role");
    await pg.query("update public.sync_jobs set status='queued', lease_id=null, lease_until=null where id=$1", [jobId]);
    await asUser();
  });

  it("throws when lease is wrong", async () => {
    await asService();
    const fakeJobId = "00000000-0000-4000-8000-000000000000";
    const fakeLease = "00000000-0000-4000-8000-000000000001";
    await expect(rpc("extraction_job_input", [fakeJobId, fakeLease])).rejects.toThrow();
    await asUser();
  });
});

describe("complete_extraction_job", () => {
  it("stores valid proposals as pending memories and marks job succeeded", async () => {
    await asUser();
    const jobId = await rpc("enqueue_extraction", [workspace, conversation]);
    await asService();
    const claimed = await rpc("claim_jobs", [5]);
    const job = claimed.find((j: any) => j.id === jobId);

    const proposals = JSON.stringify([
      {
        content: "The application database is PostgreSQL.",
        category: "Decisions",
        confidence: 0.9,
        sensitivity: "normal",
        message_index: 0,
        evidence: "We decided to use PostgreSQL for the application database.",
        reason: "Explicit team decision.",
      },
      {
        content: "The user prefers TypeScript for new services.",
        category: "Preferences",
        confidence: 0.85,
        sensitivity: "normal",
        message_index: 0,
        evidence: "I prefer TypeScript for all new services.",
        reason: "Explicit preference.",
      },
    ]);

    const result = await rpc("complete_extraction_job", [
      job.id, job.lease_id, "gpt-4o-mini", proposals,
    ]);
    expect(result.proposals).toBe(2);
    expect(result.model).toBe("gpt-4o-mini");

    await asUser();
    const memories = await pg.query<{ content: string; status: string; category: string }>(
      "select content, status, category from public.memories where workspace_id=$1 order by created_at",
      [workspace],
    );
    expect(memories.rows.length).toBeGreaterThanOrEqual(2);
    expect(memories.rows.every((m) => m.status === "pending")).toBe(true);

    // Check source links were created
    const sources = await pg.query(
      "select * from public.memory_sources where conversation_id=$1",
      [conversation],
    );
    expect(sources.rows.length).toBeGreaterThanOrEqual(2);
  });

  it("is idempotent — does not create duplicate memories", async () => {
    await asUser();
    const countBefore = (
      await pg.query<{ count: string }>(
        "select count(*) from public.memories where workspace_id=$1",
        [workspace],
      )
    ).rows[0].count;

    // Re-enqueue (new job for same conversation requires new idempotency key)
    // Reset the idempotency key by directly inserting a new job
    await pg.exec("reset role");
    const jobId2 = (
      await pg.query<{ id: string }>(
        "insert into public.sync_jobs(workspace_id,project_id,created_by,kind,payload,idempotency_key) values($1,$2,$3,'extraction',$4,$5) returning id",
        [workspace, project, owner,
         JSON.stringify({ conversation_id: conversation }),
         "extraction-dedup-test-" + Date.now()],
      )
    ).rows[0].id;

    await asService();
    const claimed = await rpc("claim_jobs", [5]);
    const job = claimed.find((j: any) => j.id === jobId2);
    expect(job).toBeTruthy();

    const proposals = JSON.stringify([
      {
        content: "The application database is PostgreSQL.",
        category: "Decisions",
        confidence: 0.9,
        sensitivity: "normal",
        message_index: 0,
        evidence: "We decided to use PostgreSQL for the application database.",
        reason: "Duplicate test.",
      },
    ]);

    await rpc("complete_extraction_job", [job.id, job.lease_id, "gpt-4o-mini", proposals]);

    await asUser();
    const countAfter = (
      await pg.query<{ count: string }>(
        "select count(*) from public.memories where workspace_id=$1",
        [workspace],
      )
    ).rows[0].count;
    expect(Number(countAfter)).toBe(Number(countBefore));
  });

  it("rejects proposals with evidence not found in source message", async () => {
    await asUser();
    await pg.exec("reset role");
    const jobId = (
      await pg.query<{ id: string }>(
        "insert into public.sync_jobs(workspace_id,project_id,created_by,kind,payload,idempotency_key) values($1,$2,$3,'extraction',$4,$5) returning id",
        [workspace, project, owner,
         JSON.stringify({ conversation_id: conversation }),
         "extraction-evidence-test-" + Date.now()],
      )
    ).rows[0].id;

    await asService();
    const claimed = await rpc("claim_jobs", [5]);
    const job = claimed.find((j: any) => j.id === jobId);
    expect(job).toBeTruthy();

    const badProposals = JSON.stringify([
      {
        content: "We use MongoDB for caching layers.",
        category: "Facts",
        confidence: 0.8,
        sensitivity: "normal",
        message_index: 0,
        evidence: "We use MongoDB for caching layers.", // not in actual message
        reason: "Hallucinated.",
      },
    ]);

    const result = await rpc("complete_extraction_job", [
      job.id, job.lease_id, "gpt-4o-mini", badProposals,
    ]);
    expect(result.proposals).toBe(0);
    await asUser();
  });
});

describe("configure_llm_extraction", () => {
  it("automatically queues new imports only when opted in", async () => {
    await asUser();
    await rpc("configure_llm_extraction", [workspace, true]);
    const imported = await rpc("import_conversation", [workspace, project, JSON.stringify({ title: "New", platform: "claude", messages: [{ role: "user", content: "A unique conversation for the extraction queue." }] }), "ignored", null]);
    await pg.exec("reset role");
    const jobs = await pg.query<{id: string}>("select id from public.sync_jobs where kind='extraction' and payload->>'conversation_id'=$1", [imported.id]);
    expect(jobs.rows).toHaveLength(1);
    await asUser();
    await rpc("configure_llm_extraction", [workspace, false]);
    await asService();
    const claimed = await rpc("claim_jobs", [20]);
    const job = claimed.find((j: {id: string}) => j.id === jobs.rows[0].id);
    expect(job).toBeTruthy();
    await expect(rpc("extraction_job_input", [job.id, job.lease_id])).rejects.toThrow();
    await asUser();
  });
  it("owner can enable and disable LLM extraction", async () => {
    await asUser();
    await rpc("configure_llm_extraction", [workspace, true]);
    const enabled = (
      await pg.query<{ preferences: { llm_extraction_enabled: boolean } }>(
        "select preferences from public.workspaces where id=$1",
        [workspace],
      )
    ).rows[0].preferences.llm_extraction_enabled;
    expect(enabled).toBe(true);

    await rpc("configure_llm_extraction", [workspace, false]);
    const disabled = (
      await pg.query<{ preferences: { llm_extraction_enabled: boolean } }>(
        "select preferences from public.workspaces where id=$1",
        [workspace],
      )
    ).rows[0].preferences.llm_extraction_enabled;
    expect(disabled).toBe(false);
  });

  it("non-owner cannot call configure_llm_extraction", async () => {
    const other = "22222222-2222-4222-8222-222222222222";
    await pg.exec("reset role");
    await pg.query("insert into auth.users values($1,'other@test.dev',now()) on conflict do nothing", [other]);
    await asUser(other);
    await expect(rpc("configure_llm_extraction", [workspace, true])).rejects.toThrow(/owner/i);
    await asUser();
  });
});

describe("LLM proposals replace rule-based proposals", () => {
  async function runJob(conversationId: string, payload: unknown) {
    await pg.exec("reset role");
    const id = (await pg.query<{ id: string }>(
      "insert into public.sync_jobs(workspace_id,project_id,created_by,kind,payload,idempotency_key) values($1,$2,$3,'extraction',$4,$5) returning id",
      [workspace, project, owner, JSON.stringify({ conversation_id: conversationId }), "replace-" + Math.random()],
    )).rows[0].id;
    await asService();
    const job = (await rpc("claim_jobs", [20])).find((j: { id: string }) => j.id === id);
    return rpc("complete_extraction_job", [job.id, job.lease_id, "test-model", payload]);
  }

  it("removes unreviewed regex proposals, skips malformed items and accepts a JSON string payload", async () => {
    await asUser();
    const text = "We decided to ship the mobile app first. Also the release train runs weekly.";
    const imported = await rpc("import_conversation", [workspace, project, JSON.stringify({ title: "Replace", platform: "claude", messages: [{ role: "user", content: text }] }), "ignored", null]);
    await pg.exec("reset role");
    const before = await pg.query<{ reason: string }>(
      "select m.reason from public.memories m join public.memory_sources s on s.memory_id=m.id where s.conversation_id=$1", [imported.id]);
    expect(before.rows.some((r) => r.reason.startsWith("Conservative server rule"))).toBe(true);

    const result = await runJob(imported.id, JSON.stringify(JSON.stringify([
      { content: "The mobile app ships before other clients.", category: "Decisions", confidence: 0.9, message_index: 0, evidence: "We decided to ship the mobile app first." },
      { content: "Bad category should be skipped quietly.", category: "Nonsense", confidence: 0.9, message_index: 0, evidence: "We decided" },
      { content: "Bad confidence should be skipped quietly.", category: "Facts", confidence: "high", message_index: 0, evidence: "We decided" },
      "not an object",
    ])));
    expect(result.proposals).toBe(1);
    expect(result.replaced).toBeGreaterThanOrEqual(1);
    await pg.exec("reset role");
    const after = await pg.query<{ reason: string; content: string }>(
      "select m.reason,m.content from public.memories m join public.memory_sources s on s.memory_id=m.id where s.conversation_id=$1", [imported.id]);
    expect(after.rows.map((r) => r.content)).toEqual(["The mobile app ships before other clients."]);
    const meta = (await pg.query<{ source_metadata: Record<string, unknown> }>("select source_metadata from public.conversations where id=$1", [imported.id])).rows[0].source_metadata;
    expect(meta.extraction_model).toBe("test-model");
    await asUser();
  });

  it("keeps approved memories even when the LLM finds nothing", async () => {
    await asUser();
    const imported = await rpc("import_conversation", [workspace, project, JSON.stringify({ title: "Keep", platform: "claude", messages: [{ role: "user", content: "We decided to keep approved memories untouched." }] }), "ignored", null]);
    await pg.exec("reset role");
    await pg.query("update public.memories m set status='active' from public.memory_sources s where s.memory_id=m.id and s.conversation_id=$1", [imported.id]);
    const result = await runJob(imported.id, []);
    expect(result.proposals).toBe(0);
    await pg.exec("reset role");
    const kept = await pg.query("select 1 from public.memory_sources where conversation_id=$1", [imported.id]);
    expect(kept.rows).toHaveLength(1);
    await asUser();
  });
});
