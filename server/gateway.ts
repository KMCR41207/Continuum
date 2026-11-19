import { embeddingProvider } from "./embeddings.ts";
import { isPrivilegedKey } from "../src/lib/publicKey.ts";
export type AgentCall = (
  operation: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

/** Scoped-token operations and the PostgreSQL entry point that serves each. */
export const coreOperations = [
  "status", "test_connection", "disconnect", "capture_conversation", "save_memory", "save_project_note",
  "update_memory", "search_memory", "recall_memory", "get_recent_context", "export_memories",
  "search_conversations", "get_conversation", "list_projects", "get_project_context",
] as const;
export const linkOperations = ["create_link", "join_link", "post_to_link", "read_link", "close_link", "list_links"] as const;
export const workspaceOperations = ["workspace_status", "list_connections", "register_device", "device_heartbeat"] as const;

export function agentRpc(operation: string): string | null {
  if (operation === "get_handoffs") return "get_agent_handoffs";
  if ((linkOperations as readonly string[]).includes(operation)) return "agent_link_request";
  if ((workspaceOperations as readonly string[]).includes(operation)) return "agent_workspace_request";
  if ((coreOperations as readonly string[]).includes(operation)) return "agent_request";
  return null;
}

/** HTTP status for an `{error, code}` result returned by an agent entry point. */
export function agentErrorStatus(code: unknown): number {
  switch (code) {
    case "unauthorized": return 401;
    case "forbidden": case "device_revoked": return 403;
    case "conflict": case "link_unavailable": return 409;
    case "rate_limited": return 429;
    default: return 400;
  }
}

export class AgentError extends Error {
  // Plain field (no parameter property): Node runs this file with type stripping only.
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

/** Uses the publishable key, never service-role access. PostgreSQL checks the scoped token. */
export function createGateway(env: NodeJS.ProcessEnv = process.env): AgentCall {
  if (env.CONTINUUM_API_URL) {
    const endpoint = new URL(env.CONTINUUM_API_URL);
    if (
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash ||
      (endpoint.protocol !== "https:" &&
        !(
          endpoint.protocol === "http:" &&
          ["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname)
        ))
    )
      throw new Error("Use an HTTPS memory API or loopback HTTP URL");
    if (!env.CONTINUUM_TOKEN)
      throw new Error("Configure a scoped CONTINUUM_TOKEN");
    return async (operation, args = {}) => {
      const response = await fetch(
        new URL(`/api/v1/agent/${encodeURIComponent(operation)}`, endpoint),
        {
          method: "POST",
          redirect: "error",
          headers: {
            Authorization: `Bearer ${env.CONTINUUM_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(args),
          signal: AbortSignal.timeout(30000),
        },
      );
      const result = await response.json().catch(() => null);
      if (result && typeof result === "object" && "error" in result)
        throw new AgentError(`${result.code || "request_denied"}: ${result.error}`, String(result.code || "request_denied"));
      if (!response.ok)
        throw new Error(
          `Local memory request denied or unavailable (${response.status})`,
        );
      return result;
    };
  }
  const base = env.CONTINUUM_SUPABASE_URL;
  const key = env.CONTINUUM_SUPABASE_KEY;
  const token = env.CONTINUUM_TOKEN;
  if (key && isPrivilegedKey(key))
    throw new Error(
      "MCP and CLI require a publishable key, never a service-role or secret key",
    );
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
  const send = async (rpc: string, payload: unknown) => {
    let response: Response;
    try {
      response = await fetch(new URL(`/rest/v1/rpc/${rpc}`, url), {
        method: "POST",
        redirect: "error",
        headers: {
          apikey: key,
          ...(key.startsWith("eyJ") ? { Authorization: `Bearer ${key}` } : {}),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
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
      throw new AgentError(`${result.code}: ${result.error}`, String(result.code));
    return result;
  };
  return async (operation, args = {}) => {
    const rpc = agentRpc(operation);
    if (rpc === "get_agent_handoffs")
      return send(rpc, {
        p_token: token,
        p_project: args.project_id || null,
      });
    if (rpc === "agent_link_request" || rpc === "agent_workspace_request")
      return send(rpc, {
        p_token: token,
        p_operation: operation,
        p_args: args,
      });
    const lexical = await send("agent_request", {
      p_token: token,
      p_operation: operation,
      p_args: args,
    });
    if (operation !== "search_memory" || args.mode !== "hybrid") return lexical;
    const provider = embeddingProvider(env);
    if (!provider)
      return {
        items: lexical,
        search_mode: "full_text_fallback",
        reason: "Embedding provider not configured",
      };
    let vector: number[];
    try {
      vector = await provider.embed(String(args.query || ""));
    } catch {
      return {
        items: lexical,
        search_mode: "full_text_fallback",
        reason: "Semantic provider unavailable; full-text results retained",
      };
    }
    const items = await send("semantic_search", {
      p_token: token,
      p_query: String(args.query || ""),
      p_vector: JSON.stringify(vector),
      p_model: provider.model,
      p_project: args.project_id || null,
    });
    return {
      items,
      search_mode: "hybrid_when_workspace_opted_in",
      model: provider.model,
    };
  };
}
