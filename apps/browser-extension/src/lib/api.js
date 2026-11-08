/**
 * Upload a captured conversation to Continuum.
 *
 * Strategy (in order):
 *   1. Supabase RPC  — used when config.supabaseUrl + config.supabaseKey + config.token present
 *   2. Local Node API — used when config.endpoint is set (http://127.0.0.1:3101 or similar)
 *
 * The MCP HTTP transport was removed because:
 *   - It requires a separately running MCP server on port 3100 (often not running)
 *   - The Supabase RPC path works directly and is always available when the DB is configured
 */
export async function upload(config, conversation) {
  // ── Path 1: Supabase RPC (preferred — works without local server) ─────────
  if (config.supabaseUrl && config.supabaseKey && config.token) {
    const base = new URL(config.supabaseUrl);
    const rpcUrl = new URL("/rest/v1/rpc/agent_request", base);
    const body = JSON.stringify({
      p_token: config.token,
      p_operation: "capture_conversation",
      p_args: {
        project_id: config.project || null,
        conversation,
      },
    });
    let response;
    try {
      response = await fetch(rpcUrl.toString(), {
        method: "POST",
        redirect: "error",
        headers: {
          apikey: config.supabaseKey,
          "Content-Type": "application/json",
        },
        body,
        signal: AbortSignal.timeout(30000),
      });
    } catch (err) {
      throw new Error(`Network error reaching Supabase: ${err.message}`);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Supabase RPC failed (${response.status}): ${text.slice(0, 200)}`);
    }
    const result = await response.json();
    if (result && result.error) throw new Error(`${result.code || "error"}: ${result.error}`);
    if (result && result.code === "invalid_request") throw new Error(result.error || "Invalid request");
    return result;
  }

  // ── Path 2: Local Node API fallback ──────────────────────────────────────
  if (!config.endpoint) throw new Error("No endpoint configured. Set Supabase URL/key or a local endpoint.");

  const endpoint = new URL(config.endpoint);
  if (
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    (endpoint.protocol !== "https:" &&
      !(endpoint.protocol === "http:" && ["127.0.0.1", "localhost"].includes(endpoint.hostname)))
  )
    throw new Error("Use loopback HTTP or HTTPS for local endpoint");

  // The local Node API (port 3101) proxies agent_request via the same Supabase RPC
  const localUrl = new URL("/api/v1/agent/capture", endpoint);
  const response = await fetch(localUrl.toString(), {
    method: "POST",
    redirect: "error",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ project_id: config.project || null, conversation }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Local API failed (${response.status})`);
  return response.json();
}

/** Fetch available projects from Supabase for the project picker. */
export async function fetchProjects(config) {
  if (!config.supabaseUrl || !config.supabaseKey || !config.token) return [];
  try {
    const base = new URL(config.supabaseUrl);
    const rpcUrl = new URL("/rest/v1/rpc/agent_request", base);
    const response = await fetch(rpcUrl.toString(), {
      method: "POST",
      redirect: "error",
      headers: { apikey: config.supabaseKey, "Content-Type": "application/json" },
      body: JSON.stringify({ p_token: config.token, p_operation: "list_projects", p_args: {} }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return [];
    const result = await response.json();
    if (!Array.isArray(result)) return [];
    return result.map((p) => ({ id: p.id, name: p.name }));
  } catch {
    return [];
  }
}

/** Test the connection and return permissions. */
export async function testConnection(config) {
  if (!config.supabaseUrl || !config.supabaseKey || !config.token) {
    throw new Error("Missing Supabase URL, key or token");
  }
  const base = new URL(config.supabaseUrl);
  const rpcUrl = new URL("/rest/v1/rpc/agent_request", base);
  const response = await fetch(rpcUrl.toString(), {
    method: "POST",
    redirect: "error",
    headers: { apikey: config.supabaseKey, "Content-Type": "application/json" },
    body: JSON.stringify({ p_token: config.token, p_operation: "test_connection", p_args: {} }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Connection test failed (${response.status})`);
  const result = await response.json();
  if (result && result.error) throw new Error(result.error);
  return result;
}
