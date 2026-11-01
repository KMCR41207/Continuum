export async function upload(config, conversation) {
  const endpoint = new URL(config.endpoint);
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && ["127.0.0.1", "localhost"].includes(endpoint.hostname)))) throw new Error("Use loopback HTTP or HTTPS");
  const response = await fetch(new URL("/api/v1/agent/capture_conversation", endpoint), { method: "POST", redirect: "error", headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ project_id: config.project || null, conversation }), signal: AbortSignal.timeout(25000) });
  if (!response.ok) throw new Error(`Capture denied or unavailable (${response.status})`);
  return response.json();
}
