/**
 * Extension API. Two transports, same scoped-token entry point:
 *
 *  - Direct (endpoint https://<project>.supabase.co): calls the database function
 *    agent_request with the project's publishable/anon key, which is public by
 *    design. No local server has to be running.
 *  - Local API (endpoint http://127.0.0.1:3101 or an HTTPS API): the server holds
 *    the Supabase settings and proxies the same call.
 *
 * Either way the capture token (ctm_…) is what authorizes the request, and
 * PostgreSQL enforces its permissions. A service-role or secret key is refused.
 */

export function isSupabaseEndpoint(url) {
  return url.protocol === "https:" && /\.supabase\.(co|in)$/i.test(url.hostname);
}

/** Throws for keys that would bypass row-level security. */
export function assertPublicKey(key) {
  if (!key) throw new Error("Add the Supabase publishable key in extension settings.");
  if (/^sb_secret_/i.test(key)) throw new Error("That is a secret key. Use the publishable or anon key.");
  if (key.startsWith("eyJ")) {
    let role = "";
    try { role = JSON.parse(atob(key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).role; } catch { /* not a JWT */ }
    if (role && role !== "anon") throw new Error("That key is not the anon key. Never use the service_role key in the extension.");
  }
  return key;
}

function validateEndpoint(endpoint) {
  const url = new URL(endpoint);
  if (
    url.username || url.password || url.search || url.hash ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname)))
  ) throw new Error("Endpoint must be loopback HTTP or HTTPS");
  return url;
}

function failure(status, detail) {
  if (status === 401 || detail?.code === "unauthorized") return new Error("Token rejected. Create a new token in Connections.");
  if (status === 429 || detail?.code === "rate_limited") return new Error("Rate limit reached. Continuum will retry automatically.");
  if (status === 503) return new Error("Continuum server not configured. Check server setup.");
  const message = typeof detail?.error === "string" ? detail.error : typeof detail?.message === "string" ? detail.message : typeof detail?.detail === "string" ? detail.detail : "";
  if (status === 403 || detail?.code === "forbidden") return new Error(message || "Token does not have capture permission.");
  return new Error(message ? message.slice(0, 200) : `Server error (${status})`);
}

async function callApi(config, operation, body) {
  const base = validateEndpoint(config.endpoint);
  const direct = isSupabaseEndpoint(base);
  const key = direct ? assertPublicKey(config.supabaseKey) : "";
  const url = direct ? new URL("/rest/v1/rpc/agent_request", base) : new URL(`/api/v1/agent/${operation}`, base);
  let response;
  try {
    response = await fetch(url.toString(), {
      method: "POST",
      redirect: "error",
      headers: direct
        ? { apikey: key, ...(key.startsWith("eyJ") ? { Authorization: `Bearer ${key}` } : {}), "Content-Type": "application/json" }
        : { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(direct ? { p_token: config.token, p_operation: operation, p_args: body } : body),
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    throw new Error(`Cannot reach Continuum at ${base.origin}. ${direct ? "Check your network." : "Is the server running?"} (${err.message})`);
  }
  const text = await response.text().catch(() => "");
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!response.ok) throw failure(response.status, data);
  // The database answers 200 with {error, code} for denied requests.
  if (data && typeof data === "object" && !Array.isArray(data) && "error" in data) throw failure(response.status, data);
  return data;
}

/** Upload a captured conversation. */
export async function upload(config, conversation) {
  return callApi(config, "capture_conversation", {
    project_id: config.project || null,
    conversation,
  });
}

/** Fetch available projects for the project picker. */
export async function fetchProjects(config) {
  if (!config.token || !config.endpoint) return [];
  try {
    const result = await callApi(config, "list_projects", {});
    if (!Array.isArray(result)) return [];
    return result.map((p) => ({ id: p.id, name: p.name }));
  } catch {
    return [];
  }
}

/** Test connection and return permissions. */
export async function testConnection(config) {
  if (!config.token) throw new Error("No token configured.");
  if (!config.endpoint) throw new Error("No endpoint configured.");
  return callApi(config, "test_connection", {});
}
