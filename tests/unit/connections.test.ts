import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { createGateway } from "../../server/gateway";
import { runCommand } from "../../server/cli";

let pg: PGlite, http: Server, client: Client;
let workspace: string,
  projectA: string,
  projectB: string,
  conversation: string,
  memory: string;
let capture: { id: string; token: string },
  agent: { id: string; token: string };
let endpoint: string;
const owner = "11111111-1111-4111-8111-111111111111";
const outsider = "22222222-2222-4222-8222-222222222222";
const input = {
  title: "Architecture",
  platform: "chatgpt",
  metadata: { source_id: "export-1", timestamp: "2026-10-30T10:00:00Z" },
  messages: [
    {
      role: "user",
      content: "This project uses React, TypeScript, and Supabase.",
      metadata: {
        attachments: [{ name: "architecture.txt", mime_type: "text/plain" }],
      },
    },
  ],
};
async function user(id = owner) {
  await pg.exec("reset role");
  await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await pg.exec("set role authenticated");
}
async function anon() {
  await pg.exec("reset role");
  await pg.query("select set_config('request.jwt.claim.sub','',false)");
  await pg.exec("set role anon");
}
async function request(
  token: string,
  op: string,
  args: Record<string, unknown> = {},
) {
  await anon();
  return (
    await pg.query<{ r: any }>("select public.agent_request($1,$2,$3) r", [
      token,
      op,
      JSON.stringify(args),
    ])
  ).rows[0].r;
}
async function configure(
  id: string | null,
  provider: string,
  permissions: Record<string, unknown>,
  rotate = false,
  revoke = false,
) {
  await user();
  return (
    await pg.query<{ r: { id: string; token: string } }>(
      "select public.configure_connection($1,$2,$3,$4,$5,$6,$7) r",
      [
        workspace,
        id,
        provider,
        provider,
        JSON.stringify(permissions),
        rotate,
        revoke,
      ],
    )
  ).rows[0].r;
}
function perms(extra: Record<string, unknown> = {}) {
  return {
    retrieval: true,
    project_ids: [projectA],
    all_history: true,
    ...extra,
  };
}
async function tool(name: string, args: Record<string, unknown> = {}) {
  const r = await client.callTool({ name, arguments: args });
  const text = (r.content as { type: string; text: string }[])[0].text;
  return r.isError ? { error: text } : JSON.parse(text).data;
}
beforeAll(async () => {
  pg = await PGlite.create();
  await pg.exec(
    "create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;",
  );
  await pg.query("insert into auth.users values($1),($2)", [owner, outsider]);
  for (const migration of [
    "202610310001_website.sql",
    "202610310002_connections.sql",
    "202610310003_context_review.sql",
  ])
    await pg.exec(
      await readFile(
        new URL(`../../supabase/migrations/${migration}`, import.meta.url),
        "utf8",
      ),
    );
  await user();
  workspace = (
    await pg.query<{ id: string }>(
      "select public.create_workspace('Connection tests') id",
    )
  ).rows[0].id;
  const projects = await pg.query<{ id: string }>(
    "insert into public.projects(workspace_id,name,instructions) values($1,'Project A','Use strict TypeScript'),($1,'Project B','Private B instructions') returning id",
    [workspace],
  );
  [projectA, projectB] = projects.rows.map((x) => x.id);
  capture = await configure(null, "chatgpt", {
    capture: true,
    project_ids: [projectA],
  });
  agent = await configure(null, "codex", perms());
  // Thin HTTP wire adapter executes the real RPC and migrations in PostgreSQL, with no mocked auth or memory results.
  http = createServer(async (req, res) => {
    try {
      if (req.url !== "/rest/v1/rpc/agent_request" || req.method !== "POST") {
        res.writeHead(404).end();
        return;
      }
      let body = "";
      for await (const chunk of req) body += chunk;
      const b = JSON.parse(body);
      const data = await request(b.p_token, b.p_operation, b.p_args);
      res
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify(data));
    } catch {
      res.writeHead(500).end("{}");
    }
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  endpoint = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
  client = new Client({
    name: "continuum-integration-client",
    version: "1.0.0",
  });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["server/mcp.ts"],
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(
            (x): x is [string, string] => x[1] !== undefined,
          ),
        ),
        CONTINUUM_SUPABASE_URL: endpoint,
        CONTINUUM_SUPABASE_KEY: "local-test-publishable",
        CONTINUUM_TOKEN: agent.token,
      },
      stderr: "pipe",
    }),
  );
}, 60000);
afterAll(async () => {
  await client?.close();
  if (http) await new Promise<void>((resolve) => http.close(() => resolve()));
  await pg?.close();
});

describe("real MCP stdio client → HTTP RPC → PostgreSQL connection lifecycle", () => {
  it("1: captures authorized source, extracts, approves, and retrieves exact memory through another agent", async () => {
    const result = await request(capture.token, "capture_conversation", {
      project_id: projectA,
      conversation: input,
    });
    expect(result.proposals).toBe(1);
    conversation = result.id;
    expect(await tool("search_memory", { query: "React" })).toEqual([]);
    await user();
    const rows = await pg.query<{ id: string; embedding: number[] }>(
      "update public.memories set status='active' where workspace_id=$1 returning id,embedding",
      [workspace],
    );
    memory = rows.rows[0].id;
    expect(rows.rows[0].embedding).toHaveLength(64);
    const memories = await tool("search_memory", { query: "React TypeScript" });
    expect(memories).toHaveLength(1);
    expect(memories[0].content).toBe(input.messages[0].content);
    expect(memories[0].sources[0].conversation_id).toBe(conversation);
    expect(memories[0].sources[0].platform).toBe("chatgpt");
    const messages = await tool("get_conversation", { id: conversation });
    expect(messages[0].messages[0].metadata.attachments[0].name).toBe(
      "architecture.txt",
    );
    expect((await client.listTools()).tools.map((x) => x.name)).toContain(
      "save_project_note",
    );
  });
  it("2: live permission changes deny and restore retrieval without reconnecting", async () => {
    await configure(agent.id, "codex", perms({ retrieval: false }));
    expect((await tool("search_memory", { query: "React" })).error).toContain(
      "forbidden",
    );
    await configure(agent.id, "codex", perms());
    expect(await tool("search_memory", { query: "React" })).toHaveLength(1);
  });
  it("3: isolates projects, direct IDs, context, writes, global scope and history provenance", async () => {
    await pg.exec("reset role");
    const b = (
      await pg.query<{ id: string }>(
        "insert into public.memories(workspace_id,project_id,content,category,confidence,status) values($1,$2,'Project B secret architecture','Facts',1,'active') returning id",
        [workspace, projectB],
      )
    ).rows[0].id;
    expect(await tool("recall_memory", { id: b })).toEqual([]);
    expect(
      (await tool("get_project_context", { project_id: projectB })).error,
    ).toContain("forbidden");
    expect(await tool("list_projects")).toHaveLength(1);
    await configure(agent.id, "codex", perms({ all_history: false }));
    expect(await tool("recall_memory", { id: memory })).toEqual([]);
    expect(await tool("get_conversation", { id: conversation })).toEqual([]);
    await configure(
      agent.id,
      "codex",
      perms({ all_history: false, conversation_ids: [conversation] }),
    );
    expect(await tool("recall_memory", { id: memory })).toHaveLength(1);
    expect(
      (
        await tool("save_memory", {
          content: "Write without permission",
          project_id: projectA,
        })
      ).error,
    ).toContain("forbidden");
    await configure(agent.id, "codex", perms({ writing: true }));
    expect(
      (
        await tool("save_memory", {
          content: "Write into private project",
          project_id: projectB,
        })
      ).error,
    ).toContain("forbidden");
    expect(
      (await tool("save_memory", { content: "Write into global scope" })).error,
    ).toContain("forbidden");
  });
  it("4: correction uses optimistic locking, review, and retained version history", async () => {
    const before = (await tool("recall_memory", { id: memory }))[0];
    expect(
      (
        await tool("update_memory", {
          id: memory,
          project_id: projectA,
          version: 1,
          content: "This project uses Svelte and Supabase.",
        })
      ).error,
    ).toContain("conflict");
    const changed = await tool("update_memory", {
      id: memory,
      project_id: projectA,
      version: before.version,
      content: "This project uses Svelte and Supabase.",
    });
    expect(changed.status).toBe("pending");
    expect(await tool("recall_memory", { id: memory })).toEqual([]);
    await user();
    await pg.query("update public.memories set status='active' where id=$1", [
      memory,
    ]);
    const history = await pg.query<{ content: string }>(
      "select content from public.memory_versions where memory_id=$1 order by version",
      [memory],
    );
    expect(history.rows[0].content).toContain("React");
    expect((await tool("recall_memory", { id: memory }))[0].content).toBe(
      "This project uses Svelte and Supabase.",
    );
    expect(await tool("search_memory", { query: "React" })).toEqual([]);
  });
  it("5: duplicate import with changed title does not duplicate records or memories", async () => {
    // Simulate a pre-upgrade import whose browser-generated hash included its title.
    await pg.exec("reset role");
    await pg.query("update public.conversations set content_hash=$1 where id=$2", ["a".repeat(64), conversation]);
    const same = await request(capture.token, "capture_conversation", {
      project_id: projectA,
      conversation: { ...input, title: "Renamed export" },
    });
    expect(same).toMatchObject({
      id: conversation,
      duplicate: true,
      proposals: 0,
    });
    await user();
    expect(
      (await pg.query("select id from public.conversations")).rows,
    ).toHaveLength(1);
  });
  it("7: retrieval-only connection never captures; pause/resume is independent", async () => {
    expect(
      (
        await tool("capture_conversation", {
          project_id: projectA,
          conversation: input,
        })
      ).error,
    ).toContain("forbidden");
    expect(await tool("search_memory", { query: "Svelte" })).toHaveLength(1);
    await configure(capture.id, "chatgpt", {
      capture: true,
      capture_paused: true,
      project_ids: [projectA],
    });
    expect(
      (
        await request(capture.token, "capture_conversation", {
          project_id: projectA,
          conversation: input,
        })
      ).code,
    ).toBe("forbidden");
    await configure(capture.id, "chatgpt", {
      capture: true,
      project_ids: [projectA],
    });
    expect(
      (
        await request(capture.token, "capture_conversation", {
          project_id: projectA,
          conversation: input,
        })
      ).duplicate,
    ).toBe(true);
    expect((await request(capture.token, "search_memory")).code).toBe(
      "forbidden",
    );
  });
  it("8: failed imports are atomic, logged without content, and retryable", async () => {
    const bad = {
      ...input,
      title: "Invalid",
      messages: [{ role: "system", content: "DO NOT LEAK THIS SOURCE" }],
    };
    expect(
      (
        await request(capture.token, "capture_conversation", {
          project_id: projectA,
          conversation: bad,
        })
      ).code,
    ).toBe("invalid_request");
    await user();
    expect(
      (
        await pg.query(
          "select id from public.conversations where title='Invalid'",
        )
      ).rows,
    ).toHaveLength(0);
    const events = (
      await pg.query(
        "select * from public.connection_events where success=false",
      )
    ).rows;
    expect(events.length).toBeGreaterThan(0);
    expect(JSON.stringify(events)).not.toContain("DO NOT LEAK");
    expect(
      (
        await request(capture.token, "capture_conversation", {
          project_id: projectA,
          conversation: input,
        })
      ).duplicate,
    ).toBe(true);
    expect(
      (
        await request(capture.token, "capture_conversation", {
          project_id: projectA,
          conversation: { ...input, platform: "claude" },
        })
      ).code,
    ).toBe("invalid_request");
    await expect(
      configure(agent.id, "codex", { retrieval: "yes" }),
    ).rejects.toThrow(/Invalid permission/);
    await expect(
      configure(agent.id, "codex", {
        project_ids: ["99999999-9999-4999-8999-999999999999"],
      }),
    ).rejects.toThrow(/Project access/);
    const call = createGateway({
      CONTINUUM_SUPABASE_URL: endpoint,
      CONTINUUM_SUPABASE_KEY: "local",
      CONTINUUM_TOKEN: agent.token,
    });
    expect(await runCommand(["diagnostics"], call)).toMatchObject({
      provider: "codex",
    });
    expect(await runCommand(["search", "Svelte"], call)).toHaveLength(1);
    await expect(
      createGateway({
        CONTINUUM_SUPABASE_URL: "http://127.0.0.1:1",
        CONTINUUM_SUPABASE_KEY: "local",
        CONTINUUM_TOKEN: agent.token,
      })("status"),
    ).rejects.toThrow(/unavailable/);
  });
  it("protects credentials and tenant data from members, outsiders and anonymous direct reads", async () => {
    await user();
    await expect(
      pg.query("select * from public.connection_credentials"),
    ).rejects.toThrow(/permission denied/);
    await user(outsider);
    expect(
      (await pg.query("select * from public.agent_connections")).rows,
    ).toEqual([]);
    await expect(
      pg.query(
        "select public.configure_connection($1,$2,'codex','intrusion','{}')",
        [workspace, agent.id],
      ),
    ).rejects.toThrow(/owner required/);
    await anon();
    await expect(pg.query("select * from public.memories")).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      pg.query("select public.ingest_conversation($1,$2,$3)", [
        workspace,
        projectA,
        JSON.stringify(input),
      ]),
    ).rejects.toThrow(/permission denied/);
  });
  it("expires credentials, rotates without reviving the old token, and rate limits", async () => {
    const temp = await configure(null, "other", perms());
    await pg.exec("reset role");
    await pg.query(
      "update public.agent_connections set expires_at=now()-interval '1 second' where id=$1",
      [temp.id],
    );
    expect((await request(temp.token, "status")).code).toBe("unauthorized");
    const rotated = await configure(temp.id, "other", perms(), true);
    expect((await request(temp.token, "status")).code).toBe("unauthorized");
    expect((await request(rotated.token, "status")).provider).toBe("other");
    await pg.exec("reset role");
    await pg.query(
      "insert into public.connection_events(workspace_id,connection_id,operation,success) select $1,$2,'status',true from generate_series(1,120)",
      [workspace, temp.id],
    );
    expect((await request(rotated.token, "status")).code).toBe("rate_limited");
  });
  it("6: disconnect revokes the active MCP client's next request", async () => {
    await configure(agent.id, "codex", perms(), false, true);
    expect((await tool("search_memory", { query: "Svelte" })).error).toContain(
      "unauthorized",
    );
    expect((await request(agent.token, "test_connection")).code).toBe(
      "unauthorized",
    );
  });
  it("source-linked handoffs, review candidates, exports and deletion honor the same scopes", async () => {
    const scoped = await configure(null, "claude", perms({ writing: true }));
    await user();
    await pg.query(
      "select public.create_handoff($1,$2,'claude','Implement the reviewed architecture')",
      [projectA, conversation],
    );
    await expect(
      pg.query("select public.create_handoff($1,$2,'claude','Wrong project')", [
        projectB,
        conversation,
      ]),
    ).rejects.toThrow(/Conversation access/);
    const context = await request(scoped.token, "get_project_context", {
      project_id: projectA,
    });
    expect(context[0].handoffs[0].conversation_id).toBe(conversation);
    expect(context[0].source_memories[0].sources[0].conversation_id).toBe(
      conversation,
    );
    expect(
      context[0].connected_agents.some(
        (x: { provider: string }) => x.provider === "claude",
      ),
    ).toBe(true);
    const proposal = await request(scoped.token, "save_project_note", {
      project_id: projectA,
      content: "This project uses Angular and SQLite.",
      category: "Facts",
    });
    expect(proposal.status).toBe("pending");
    await user();
    const conflicts = (
      await pg.query<{ r: any[] }>(
        "select public.memory_conflict_candidates($1) r",
        [proposal.id],
      )
    ).rows[0].r;
    expect(conflicts.some((x) => x.id === memory)).toBe(true);
    const exported = (
      await pg.query<{ r: any }>("select public.export_workspace($1) r", [
        workspace,
      ])
    ).rows[0].r;
    expect(exported.handoffs).toHaveLength(1);
    expect(exported.connections.length).toBeGreaterThan(0);
    expect(JSON.stringify(exported)).not.toContain("token_hash");
    await pg.query(
      "update public.conversations set excluded=true where id=$1",
      [conversation],
    );
    expect(
      await request(scoped.token, "recall_memory", { id: memory }),
    ).toEqual([]);
    expect(
      (
        await request(scoped.token, "get_project_context", {
          project_id: projectA,
        })
      )[0].handoffs,
    ).toEqual([]);
    await user();
    await pg.query(
      "update public.conversations set excluded=false where id=$1",
      [conversation],
    );
    expect(
      await request(scoped.token, "recall_memory", { id: memory }),
    ).toHaveLength(1);
    await user();
    await pg.query("delete from public.conversations where id=$1", [
      conversation,
    ]);
    for (const table of [
      "memory_sources",
      "memory_versions",
      "project_handoffs",
    ])
      expect(
        (await pg.query(`select * from public.${table}`)).rows,
      ).toHaveLength(0);
    expect(
      await request(scoped.token, "recall_memory", { id: memory }),
    ).toEqual([]);
    expect((await request(scoped.token, "disconnect")).revoked).toBe(true);
    expect((await request(scoped.token, "status")).code).toBe("unauthorized");
  });
});
