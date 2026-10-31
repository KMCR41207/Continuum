import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { extractProposals } from "../../src/lib/memory";
let pg: PGlite;
const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
let workspace: string;
let project: string;
let conversation: string;
let memory: string;
async function asUser(id: string) {
  await pg.exec("reset role");
  await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await pg.exec("set role authenticated");
}
beforeAll(async () => {
  pg = await PGlite.create();
  await pg.exec(
    "create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;",
  );
  await pg.query("insert into auth.users values($1),($2)", [alice, bob]);
  await pg.exec(
    await readFile(
      new URL(
        "../../supabase/migrations/202610310001_website.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await asUser(alice);
  workspace = (
    await pg.query<{ id: string }>(
      "select public.create_workspace('Alice workspace') as id",
    )
  ).rows[0].id;
  project = (
    await pg.query<{ id: string }>(
      "insert into public.projects(workspace_id,name) values($1,'Atlas') returning id",
      [workspace],
    )
  ).rows[0].id;
}, 30000);
afterAll(async () => {
  await pg?.close();
});
describe("database migration and tenant isolation", () => {
  it("atomically imports a conversation and source-linked pending decision", async () => {
    const input = {
      title: "Database decision",
      platform: "ChatGPT",
      messages: [
        {
          role: "user" as const,
          content: "We decided to use PostgreSQL for the application database.",
        },
      ],
    };
    const result = await pg.query<{
      result: { id: string; proposals: number };
    }>("select public.import_conversation($1,$2,$3,$4,$5) as result", [
      workspace,
      project,
      JSON.stringify(input),
      "a".repeat(64),
      JSON.stringify(extractProposals(input)),
    ]);
    conversation = result.rows[0].result.id;
    expect(result.rows[0].result.proposals).toBe(1);
    const memories = await pg.query<{ id: string; status: string }>(
      "select id,status from public.memories",
    );
    memory = memories.rows[0].id;
    expect(memories.rows[0].status).toBe("pending");
    expect(
      (await pg.query("select * from public.memory_sources")).rows,
    ).toHaveLength(1);
  });
  it("deduplicates repeated imports and repeated decisions", async () => {
    const input = {
      title: "Database decision",
      platform: "ChatGPT",
      messages: [
        {
          role: "user" as const,
          content: "We decided to use PostgreSQL for the application database.",
        },
      ],
    };
    const same = await pg.query<{ result: { duplicate: boolean } }>(
      "select public.import_conversation($1,$2,$3,$4,$5) as result",
      [
        workspace,
        project,
        JSON.stringify(input),
        "a".repeat(64),
        JSON.stringify(extractProposals(input)),
      ],
    );
    expect(same.rows[0].result.duplicate).toBe(true);
    const later = await pg.query<{ result: { proposals: number } }>(
      "select public.import_conversation($1,$2,$3,$4,$5) as result",
      [
        workspace,
        project,
        JSON.stringify({ ...input, title: "Later conversation" }),
        "b".repeat(64),
        JSON.stringify(extractProposals(input)),
      ],
    );
    expect(later.rows[0].result.proposals).toBe(0);
    expect((await pg.query("select * from public.memories")).rows).toHaveLength(
      1,
    );
    expect(
      (await pg.query("select * from public.memory_sources")).rows,
    ).toHaveLength(2);
  });
  it("preserves previous versions on correction and approval", async () => {
    await pg.query(
      "update public.memories set status='active',content='We chose PostgreSQL for Atlas.' where id=$1",
      [memory],
    );
    const versions = await pg.query<{ content: string; version: number }>(
      "select content,version from public.memory_versions where memory_id=$1",
      [memory],
    );
    expect(versions.rows[0].content).toContain("application database");
    expect(versions.rows[0].version).toBe(1);
    expect(
      (
        await pg.query<{ version: number }>(
          "select version from public.memories where id=$1",
          [memory],
        )
      ).rows[0].version,
    ).toBe(2);
  });
  it("prevents rewriting ownership and version numbers", async () => {
    await expect(
      pg.query("update public.memories set workspace_id=$1 where id=$2", [
        workspace,
        memory,
      ]),
    ).rejects.toThrow(/permission denied/);
    await expect(
      pg.query("update public.memories set version=1 where id=$1", [memory]),
    ).rejects.toThrow(/permission denied/);
  });
  it("rejects evidence not found in the source and rolls back source records", async () => {
    const input = {
      title: "Forged",
      platform: "Manual",
      messages: [{ role: "user", content: "Hello there." }],
    };
    await expect(
      pg.query("select public.import_conversation($1,null,$2,$3,$4)", [
        workspace,
        JSON.stringify(input),
        "c".repeat(64),
        JSON.stringify([
          {
            content: "We decided to use MongoDB.",
            category: "Decisions",
            confidence: 0.9,
            sensitivity: "normal",
            message_index: 0,
          },
        ]),
      ]),
    ).rejects.toThrow(/evidence/);
    expect(
      (
        await pg.query(
          "select * from public.conversations where title='Forged'",
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("isolates every exposed table from another user", async () => {
    await asUser(bob);
    for (const table of [
      "workspaces",
      "workspace_members",
      "projects",
      "conversations",
      "messages",
      "memories",
      "memory_sources",
      "memory_versions",
      "audit_logs",
    ])
      expect(
        (await pg.query(`select * from public.${table}`)).rows,
        table,
      ).toHaveLength(0);
    expect(
      (
        await pg.query(
          "update public.memories set content='intrusion' where id=$1 returning id",
          [memory],
        )
      ).rows,
    ).toHaveLength(0);
    await expect(
      pg.query("select public.export_workspace($1)", [workspace]),
    ).rejects.toThrow(/denied/);
    await expect(
      pg.query(
        "insert into public.projects(workspace_id,name) values($1,'Intrusion')",
        [workspace],
      ),
    ).rejects.toThrow(/row-level security/);
    await asUser(alice);
  });
  it("exports complete workspace data and audits the operation", async () => {
    const result = await pg.query<{
      data: { memories: unknown[]; messages: unknown[]; sources: unknown[] };
    }>("select public.export_workspace($1) as data", [workspace]);
    expect(result.rows[0].data.memories).toHaveLength(1);
    expect(result.rows[0].data.messages).toHaveLength(2);
    expect(result.rows[0].data.sources).toHaveLength(2);
    expect(
      (
        await pg.query(
          "select * from public.audit_logs where event='Workspace exported'",
        )
      ).rows,
    ).toHaveLength(1);
  });
  it("deletes derived memories, sources, and versions with their conversation", async () => {
    await pg.query("delete from public.conversations where id=$1", [
      conversation,
    ]);
    for (const table of ["memories", "memory_sources", "memory_versions"])
      expect(
        (await pg.query(`select * from public.${table}`)).rows,
      ).toHaveLength(0);
    expect(
      (
        await pg.query(
          "select * from public.messages where conversation_id=$1",
          [conversation],
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("denies anonymous reads and privileged RPC calls", async () => {
    await pg.exec("reset role;set role anon");
    await expect(pg.query("select * from public.memories")).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      pg.query("select public.create_workspace('anonymous')"),
    ).rejects.toThrow(/permission denied/);
    await asUser(alice);
  });
});
