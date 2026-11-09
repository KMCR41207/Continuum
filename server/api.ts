import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { memberClient, serviceClient } from "./service.ts";
import { readBody } from "./http.ts";
export function verifyStripeEvent(
  raw: Buffer,
  signature: string,
  secret: string,
  stripe: Stripe,
) {
  return stripe.webhooks.constructEvent(raw, signature, secret, 300);
}
export async function processSubscriptionEvent(
  event: Stripe.Event,
  stripe: Stripe,
  env: NodeJS.ProcessEnv = process.env,
) {
  const object = event.data.object as unknown as Record<string, any>;
  const subscriptionId = event.type.startsWith("customer.subscription.")
    ? object.id
    : object.parent?.subscription_details?.subscription;
  if (!subscriptionId) return;
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  const workspace = sub.metadata.workspace_id;
  if (!workspace) throw new Error("Subscription has no workspace mapping");
  const db = serviceClient(env);
  const current = await db
    .from("workspace_billing")
    .select("customer_id")
    .eq("workspace_id", workspace)
    .single();
  const customer =
    typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  if (current.error || current.data.customer_id !== customer)
    throw new Error("Subscription customer mapping mismatch");
  const price = sub.items.data[0]?.price.id;
  const plan = await db
    .from("plan_catalog")
    .select("id")
    .eq("stripe_price_id", price)
    .single();
  const entitled = ["active", "trialing"].includes(sub.status);
  if (entitled && plan.error)
    throw new Error("Unconfigured subscription price");
  const end = sub.items.data[0]?.current_period_end;
  const r = await db.rpc("apply_billing_event", {
    p_event: event.id,
    p_workspace: workspace,
    p_type: event.type,
    p_created: event.created,
    p_data: {
      plan: entitled ? plan.data?.id : "free",
      customer_id: customer,
      subscription_id: sub.id,
      status: sub.status,
      cancel_at_period_end: sub.cancel_at_period_end,
      current_period_end: end ? new Date(end * 1000).toISOString() : null,
    },
  });
  if (r.error) throw new Error("Billing update failed");
}
export function createApiServer(env: NodeJS.ProcessEnv = process.env) {
  const stripe = env.STRIPE_SECRET_KEY
    ? new Stripe(env.STRIPE_SECRET_KEY)
    : null;
  const origin = env.APP_ORIGIN;
  const attempts = new Map<string, { count: number; until: number }>();
  const configured = Boolean(
    env.SUPABASE_URL &&
    env.SUPABASE_PUBLISHABLE_KEY &&
    env.SUPABASE_SERVICE_ROLE_KEY,
  );
  const server = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const send = (status: number, data: unknown) => {
      res.writeHead(status).end(JSON.stringify(data));
    };
    if (req.headers.origin && req.headers.origin !== origin) {
      send(403, { error: "Origin denied" });
      return;
    }
    if (req.headers.origin) {
      res.setHeader("Access-Control-Allow-Origin", origin!);
      res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") {
      res.setHeader(
        "Access-Control-Allow-Headers",
        "authorization,content-type",
      );
      res.setHeader("Access-Control-Allow-Methods", "GET,POST");
      res.writeHead(204).end();
      return;
    }
    const now = Date.now();
    for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
    const ip = req.socket.remoteAddress || "unknown",
      bucket = attempts.get(ip) || { count: 0, until: now + 60000 };
    bucket.count++;
    attempts.set(ip, bucket);
    if (bucket.count > 60 || attempts.size > 10000) {
      send(429, { error: "Too many requests; retry in 60 seconds" });
      return;
    }
    if (req.url === "/api/config" && req.method === "GET") {
      send(200, {
        billing:
          configured && Boolean(stripe && env.STRIPE_WEBHOOK_SECRET && origin),
        accountDeletion: configured,
        semantic: Boolean(
          env.EMBEDDING_API_KEY && env.EMBEDDING_URL && env.EMBEDDING_MODEL,
        ),
        embeddingModel: env.EMBEDDING_MODEL || null,
        embeddingEndpoint: env.EMBEDDING_URL
          ? (() => {
              try {
                return new URL(env.EMBEDDING_URL).origin;
              } catch {
                return null;
              }
            })()
          : null,
      });
      return;
    }
    if (req.url === "/health") {
      send(200, { service: "continuum-api", configured });
      return;
    }
    // ── Agent proxy endpoints — extension sends token, server holds Supabase keys ──
    const agentRoutes: Record<string, string> = {
      "/api/v1/agent/capture_conversation": "capture_conversation",
      "/api/v1/agent/test_connection": "test_connection",
      "/api/v1/agent/list_projects": "list_projects",
      "/api/v1/agent/search_memory": "search_memory",
      "/api/v1/agent/get_recent_context": "get_recent_context",
    };
    if (req.method === "POST" && req.url && agentRoutes[req.url]) {
      const operation = agentRoutes[req.url];
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) { send(401, { error: "Token required" }); return; }
      let raw: Buffer;
      try { raw = await readBody(req, 2000000); } catch { send(413, { error: "Request too large" }); return; }
      const body = (() => { try { return JSON.parse(raw.toString("utf8")); } catch { return {}; } })();
      if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) {
        send(503, { error: "Server not configured with Supabase credentials" });
        return;
      }
      try {
        const rpcUrl = new URL("/rest/v1/rpc/agent_request", env.SUPABASE_URL);
        const rpcRes = await fetch(rpcUrl.toString(), {
          method: "POST",
          headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ p_token: token, p_operation: operation, p_args: body }),
          signal: AbortSignal.timeout(30000),
        });
        const result = await rpcRes.json() as Record<string, unknown>;
        if (!rpcRes.ok) { send(rpcRes.status, result); return; }
        send(200, result);
      } catch (err) {
        send(502, { error: err instanceof Error ? err.message : "Upstream error" });
      }
      return;
    }
    if (req.method !== "POST") {
      send(405, { error: "POST required" });
      return;
    }
    if (!configured) {
      send(503, { error: "Server services need Supabase configuration" });
      return;
    }
    let raw: Buffer;
    try {
      raw = await readBody(req, 256000);
    } catch {
      send(413, { error: "Request too large" });
      return;
    }
    if (req.url === "/api/billing/webhook") {
      if (!stripe || !env.STRIPE_WEBHOOK_SECRET) {
        send(503, { error: "Billing is not configured" });
        return;
      }
      try {
        const event = verifyStripeEvent(
          raw,
          String(req.headers["stripe-signature"] || ""),
          env.STRIPE_WEBHOOK_SECRET,
          stripe,
        );
        await processSubscriptionEvent(event, stripe, env);
        send(200, { received: true });
      } catch {
        send(400, { error: "Webhook signature, mapping or processing failed" });
      }
      return;
    }
    const jwt = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!jwt) {
      send(401, { error: "Authentication required" });
      return;
    }
    const member = memberClient(jwt, env);
    const identity = await member.auth.getUser(jwt);
    if (identity.error || !identity.data.user) {
      send(401, { error: "Session expired. Sign in again." });
      return;
    }
    try {
      const body = JSON.parse(raw.toString("utf8"));
      const user = identity.data.user;
      if (req.url === "/api/account/delete") {
        if (
          body.confirmation !== "DELETE CONTINUUM ACCOUNT" ||
          typeof body.password !== "string" ||
          body.password.length > 128 ||
          !user.email
        )
          throw new Error("Confirm deletion and enter your current password");
        const fresh = createClient(
          env.SUPABASE_URL!,
          env.SUPABASE_PUBLISHABLE_KEY!,
          { auth: { persistSession: false, autoRefreshToken: false } },
        );
        const auth = await fresh.auth.signInWithPassword({
          email: user.email,
          password: body.password,
        });
        if (auth.error || auth.data.user?.id !== user.id)
          throw new Error("Reauthentication failed");
        try {
          const result = await serviceClient(env).rpc("delete_account_data", {
            p_user: user.id,
          });
          if (result.error) throw new Error(result.error.message);
          send(200, { deleted: true });
        } finally {
          await fresh.auth.signOut();
        }
        return;
      }
      if (
        !["/api/billing/checkout", "/api/billing/portal"].includes(
          req.url || "",
        )
      ) {
        send(404, { error: "Unknown endpoint" });
        return;
      }
      if (!stripe || !env.STRIPE_WEBHOOK_SECRET || !origin) {
        send(503, {
          error:
            "Stripe credentials, webhook secret and APP_ORIGIN are required",
        });
        return;
      }
      const workspace = await member
        .from("workspaces")
        .select("id,owner_id,name")
        .eq("id", body.workspace_id)
        .single();
      if (workspace.error || workspace.data.owner_id !== user.id) {
        send(403, { error: "Workspace owner required" });
        return;
      }
      const db = serviceClient(env);
      const billing = await db
        .from("workspace_billing")
        .select("*")
        .eq("workspace_id", workspace.data.id)
        .maybeSingle();
      if (billing.error) throw new Error("Cannot load billing state");
      if (req.url === "/api/billing/portal") {
        if (!billing.data?.customer_id)
          throw new Error("No billing customer exists yet");
        const portal = await stripe.billingPortal.sessions.create({
          customer: billing.data.customer_id,
          return_url: `${origin}/app/billing`,
        });
        send(200, { url: portal.url });
        return;
      }
      if (
        billing.data?.subscription_id &&
        !["canceled", "incomplete_expired"].includes(billing.data.status)
      )
        throw new Error(
          "Manage the existing subscription in the billing portal",
        );
      const plan = await db
        .from("plan_catalog")
        .select("id,stripe_price_id,enabled")
        .eq("id", body.plan_id)
        .single();
      if (plan.error || !plan.data.enabled || !plan.data.stripe_price_id)
        throw new Error("This plan has no approved Stripe price");
      let customer = billing.data?.customer_id;
      if (!customer) {
        customer = (
          await stripe.customers.create(
            {
              email: user.email,
              metadata: { workspace_id: workspace.data.id },
            },
            { idempotencyKey: `continuum-customer-${workspace.data.id}` },
          )
        ).id;
        const stored = await db
          .from("workspace_billing")
          .upsert(
            { workspace_id: workspace.data.id, customer_id: customer },
            { onConflict: "workspace_id" },
          );
        if (stored.error) throw new Error("Cannot store billing customer");
      }
      const checkout = await stripe.checkout.sessions.create(
        {
          mode: "subscription",
          customer,
          line_items: [{ price: plan.data.stripe_price_id, quantity: 1 }],
          subscription_data: { metadata: { workspace_id: workspace.data.id } },
          client_reference_id: workspace.data.id,
          success_url: `${origin}/app/billing?checkout=returned`,
          cancel_url: `${origin}/app/billing`,
        },
        {
          idempotencyKey: `checkout-${workspace.data.id}-${plan.data.id}-${Math.floor(Date.now() / 300000)}`,
        },
      );
      send(200, { url: checkout.url });
    } catch (error) {
      send(400, {
        error:
          error instanceof Stripe.errors.StripeError
            ? "Billing provider request failed. Check server configuration or retry."
            : error instanceof Error
              ? error.message
              : "Request failed",
      });
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  return server;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const port = Number(process.env.API_PORT || 3101);
  createApiServer().listen(port, process.env.API_BIND || "127.0.0.1", () =>
    console.error(`Continuum API listening on ${port}`),
  );
}
