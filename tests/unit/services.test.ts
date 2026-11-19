import { it, expect } from "vitest";
import Stripe from "stripe";
import { verifyStripeEvent, createApiServer } from "../../server/api";
import { embeddingProvider } from "../../server/embeddings";
import { isPrivilegedKey } from "../../src/lib/publicKey";
import { createGateway } from "../../server/gateway";
import { workerTick } from "../../server/worker";

it("worker sends extracted evidence to the completion RPC", async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const conversation = { title: "Test", platform: "claude", messages: [{ role: "user" as const, content: "I prefer concise explanations." }] };
  const proposal = { content: "The user prefers concise explanations.", category: "Preferences" as const, confidence: 0.9, sensitivity: "normal" as const, message_index: 0, evidence: "I prefer concise explanations.", reason: "Preference" };
  const db = { rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    if (name === "claim_jobs") return { data: [{ id: "job", lease_id: "lease", kind: "extraction" }], error: null };
    if (name === "extraction_job_input") return { data: conversation, error: null };
    return { data: null, error: null };
  } };
  await workerTick({ db, extractor: { model: "test", extract: async (input) => { expect(input).toEqual(conversation); return [proposal]; } }, report: () => {} });
  expect(calls.find((c) => c.name === "complete_extraction_job")?.args).toEqual({ p_id: "job", p_lease: "lease", p_model: "test", p_proposals: [proposal] });
  // A string would reach PostgREST as a jsonb scalar and be rejected by complete_extraction_job.
  expect(Array.isArray(calls.find((c) => c.name === "complete_extraction_job")?.args.p_proposals)).toBe(true);
  expect(calls.some((c) => c.name === "finish_job")).toBe(false);
});
it("routes every agent operation to its PostgreSQL entry point and maps error codes to HTTP", async () => {
  const { agentRpc, agentErrorStatus } = await import("../../server/gateway");
  expect(agentRpc("capture_conversation")).toBe("agent_request");
  expect(agentRpc("save_memory")).toBe("agent_request");
  expect(agentRpc("get_handoffs")).toBe("get_agent_handoffs");
  expect(agentRpc("post_to_link")).toBe("agent_link_request");
  expect(agentRpc("register_device")).toBe("agent_workspace_request");
  expect(agentRpc("drop_everything")).toBeNull();
  expect([401, 403, 409, 429, 400].map((s, i) => agentErrorStatus(["unauthorized", "forbidden", "link_unavailable", "rate_limited", "invalid_request"][i]))).toEqual([401, 403, 409, 429, 400]);
});
it("rejects privileged keys in public and agent configuration", () => {
  const key = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.fixture`;
  expect(isPrivilegedKey(key)).toBe(true);
  expect(isPrivilegedKey("sb_publishable_fixture")).toBe(false);
  expect(() =>
    createGateway({
      CONTINUUM_SUPABASE_URL: "https://example.test",
      CONTINUUM_SUPABASE_KEY: key,
      CONTINUUM_TOKEN: "ctm_" + "a".repeat(64),
    }),
  ).toThrow(/publishable/);
});
it("Stripe webhook verification rejects tampering and expired signatures", () => {
  const stripe = new Stripe("sk_test_fixture");
  const secret = "whsec_fixture";
  const payload = JSON.stringify({
    id: "evt_fixture",
    object: "event",
    type: "customer.subscription.updated",
    data: { object: { id: "sub_fixture" } },
  });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
  expect(
    verifyStripeEvent(Buffer.from(payload), header, secret, stripe).id,
  ).toBe("evt_fixture");
  expect(() =>
    verifyStripeEvent(Buffer.from(payload + " "), header, secret, stripe),
  ).toThrow();
  const old = stripe.webhooks.generateTestHeaderString({
    payload,
    secret,
    timestamp: Math.floor(Date.now() / 1000) - 1000,
  });
  expect(() =>
    verifyStripeEvent(Buffer.from(payload), old, secret, stripe),
  ).toThrow();
});
it("semantic adapter validates model responses and has no configured-by-default external dependency", async () => {
  expect(embeddingProvider({})).toBeNull();
  const env = {
    EMBEDDING_URL: "https://embeddings.example.test/v1/embeddings",
    EMBEDDING_MODEL: "fixture",
    EMBEDDING_API_KEY: "fixture",
  };
  const fake: typeof fetch = async (_url, options) => {
    expect(JSON.parse(String(options?.body)).dimensions).toBe(384);
    return new Response(
      JSON.stringify({ data: [{ embedding: [1, ...Array(383).fill(0)] }] }),
    );
  };
  expect(
    await embeddingProvider(env, fake)!.embed("Architecture"),
  ).toHaveLength(384);
  const invalid: typeof fetch = async () =>
    new Response(JSON.stringify({ data: [{ embedding: [1, 2] }] }));
  await expect(
    embeddingProvider(env, invalid)!.embed("Architecture"),
  ).rejects.toThrow(/dimension/);
});
it("unconfigured API reports honest capabilities and never accepts deletion or checkout", async () => {
  const server = createApiServer({ APP_ORIGIN: "https://continuum.example" });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const config = await (await fetch(url + "/api/config")).json();
    expect(config.billing).toBe(false);
    expect(config.accountDeletion).toBe(false);
    expect(
      (await fetch(url + "/api/account/delete", { method: "POST" })).status,
    ).toBe(503);
    expect(
      (
        await fetch(url + "/api/config", {
          headers: { Origin: "https://wrong.example" },
        })
      ).status,
    ).toBe(403);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
it("worker reports health without logging source content and marks failed jobs", async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const db = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      if (name === "claim_jobs")
        return {
          data: [
            { id: "import-job", lease_id: "lease", kind: "import" },
            { id: "embedding-job", lease_id: "lease", kind: "embedding" },
          ],
          error: null,
        };
      if (name === "run_import_job") return { data: {}, error: null };
      if (name === "finish_job" || name === "heartbeat_worker")
        return { data: null, error: null };
      return { data: null, error: { message: "unexpected" } };
    },
  };
  const events: unknown[] = [];
  await expect(
    workerTick({
      db,
      workerId: "fixture-worker",
      provider: null,
      report: (event) => events.push(event),
    }),
  ).resolves.toBe(2);
  expect(calls.find((call) => call.name === "finish_job")?.args).toMatchObject({
    p_id: "embedding-job",
    p_error: "Processing failed",
  });
  expect(
    calls.find((call) => call.name === "heartbeat_worker")?.args,
  ).toMatchObject({ p_worker_id: "fixture-worker", p_state: "degraded" });
  expect(JSON.stringify(events)).not.toContain("private source");
});
