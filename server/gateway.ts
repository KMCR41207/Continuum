export type AgentCall = (
  operation: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

/** Uses the publishable key, never service-role access. PostgreSQL checks the scoped token. */
export function createGateway(env: NodeJS.ProcessEnv = process.env): AgentCall {
  const base = env.CONTINUUM_SUPABASE_URL;
  const key = env.CONTINUUM_SUPABASE_KEY;
  const token = env.CONTINUUM_TOKEN;
  if (!base || !key || !token)
    throw new Error(
      "Set CONTINUUM_SUPABASE_URL, CONTINUUM_SUPABASE_KEY and CONTINUUM_TOKEN. Create a scoped token in Connections.",
    );
  const url = new URL(base);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      ))
  )
    throw new Error(
      "Use an HTTPS Supabase URL (HTTP is allowed only on loopback).",
    );
  return async (operation, args = {}) => {
    let response: Response;
    try {
      response = await fetch(new URL("/rest/v1/rpc/agent_request", url), {
        method: "POST",
        redirect: "error",
        headers: {
          apikey: key,
          ...(key.startsWith("eyJ") ? { Authorization: `Bearer ${key}` } : {}),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          p_token: token,
          p_operation: operation,
          p_args: args,
        }),
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new Error(
        "Continuum is unavailable. Check the endpoint and network, then retry. No successful sync was confirmed.",
      );
    }
    if (!response.ok)
      throw new Error(
        `Continuum request failed (${response.status}). Check database migrations and publishable key.`,
      );
    const result = await response.json();
    if (result && typeof result === "object" && "error" in result)
      throw new Error(`${result.code}: ${result.error}`);
    return result;
  };
}
