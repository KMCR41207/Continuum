export async function upload(config, conversation) {
  const endpoint = new URL(config.endpoint);
  if (
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    (endpoint.protocol !== "https:" &&
      !(
        endpoint.protocol === "http:" &&
        ["127.0.0.1", "localhost"].includes(endpoint.hostname)
      ))
  )
    throw new Error("Use loopback HTTP or HTTPS");

  // Try HTTP MCP transport first (port 3100), fall back to self-hosted API (port 8000).
  const mcpEndpoint = new URL(endpoint);
  mcpEndpoint.port = mcpEndpoint.port || (mcpEndpoint.protocol === "https:" ? "443" : "3100");
  mcpEndpoint.pathname = "/mcp";

  const mcpBody = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "capture_conversation",
      arguments: {
        project_id: config.project || undefined,
        conversation,
      },
    },
  });

  // Try MCP HTTP endpoint first
  try {
    const mcpUrl = new URL(endpoint);
    mcpUrl.pathname = "/mcp";
    // Use port 3100 unless the endpoint already specifies one
    if (!mcpUrl.port && mcpUrl.protocol === "http:") mcpUrl.port = "3100";

    const mcpRes = await fetch(mcpUrl.toString(), {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
        "mcp-protocol-version": "2025-03-26",
      },
      body: mcpBody,
      signal: AbortSignal.timeout(25000),
    });
    if (mcpRes.ok) {
      const result = await mcpRes.json();
      if (result.error) throw new Error(result.error.message || "MCP error");
      return result.result || {};
    }
  } catch (mcpErr) {
    // MCP endpoint unavailable — fall through to legacy self-hosted API
    if (mcpErr.message === "Use loopback HTTP or HTTPS") throw mcpErr;
  }

  // Fall back to self-hosted Python API at /api/v1/agent/capture_conversation
  const legacyUrl = new URL("/api/v1/agent/capture_conversation", endpoint);
  const response = await fetch(legacyUrl.toString(), {
    method: "POST",
    redirect: "error",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ project_id: config.project || null, conversation }),
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok)
    throw new Error(`Capture denied or unavailable (${response.status})`);
  return response.json();
}
