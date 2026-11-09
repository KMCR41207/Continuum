/**
 * Extension API — talks ONLY to the local Continuum API (port 3101).
 *
 * Supabase credentials never enter the browser extension.
 * The local server holds them and proxies agent requests securely.
 *
 * The extension only needs:
 *   - endpoint: http://127.0.0.1:3101
 *   - token: ctm_... (scoped capture token from Connections page)
 */

function validateEndpoint(endpoint) {
  const url = new URL(endpoint);
  if (
    url.username || url.password || url.search || url.hash ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname)))
  ) throw new Error("Endpoint must be loopback HTTP or HTTPS");
  return url;
}

async function callApi(config, path, body) {
  const base = validateEndpoint(config.endpoint);
  const url = new URL(path, base);
  let response;
  try {
    response = await fetch(url.toString(), {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    throw new Error(`Cannot reach Continuum at ${base.origin}. Is the server running? (${err.message})`);
  }
  if (response.status === 401) throw new Error("Token rejected. Create a new token in Connections.");
  if (response.status === 403) throw new Error("Token does not have capture permission.");
  if (response.status === 503) throw new Error("Continuum server not configured. Check server setup.");
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Server error (${response.status}): ${text.slice(0, 150)}`);
  }
  return response.json();
}

/** Upload a captured conversation. */
export async function upload(config, conversation) {
  const result = await callApi(config, "/api/v1/agent/capture_conversation", {
    project_id: config.project || null,
    conversation,
  });
  if (result && result.error) throw new Error(result.error);
  return result;
}

/** Fetch available projects for the project picker. */
export async function fetchProjects(config) {
  if (!config.token || !config.endpoint) return [];
  try {
    const result = await callApi(config, "/api/v1/agent/list_projects", {});
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
  const result = await callApi(config, "/api/v1/agent/test_connection", {});
  if (result && result.error) throw new Error(result.error);
  return result;
}
