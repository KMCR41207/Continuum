import { createServer, type IncomingMessage } from "node:http";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { pathToFileURL } from "node:url";
import { createMemoryServer } from "./mcp.ts";
import { createGateway, type AgentCall } from "./gateway.ts";
export async function readBody(req: IncomingMessage, limit = 2_100_000) {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("Request exceeds limit");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
export function createMcpHttpServer(
  options: {
    gateway?: (token: string) => AgentCall;
    allowedHosts?: string[];
    allowedOrigins?: string[];
    rateLimit?: number;
  } = {},
) {
  const buckets = new Map<string, { count: number; until: number }>();
  return createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const host = req.headers.host || "";
    if (options.allowedHosts?.length && !options.allowedHosts.includes(host)) {
      res.writeHead(403).end();
      return;
    }
    const origin = req.headers.origin;
    if (origin && !options.allowedOrigins?.includes(origin)) {
      res.writeHead(403).end();
      return;
    }
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    const ip = req.socket.remoteAddress || "unknown";
    const now = Date.now();
    for (const [key, b] of buckets) if (b.until < now) buckets.delete(key);
    const bucket = buckets.get(ip) || { count: 0, until: now + 60000 };
    bucket.count++;
    buckets.set(ip, bucket);
    if (bucket.count > (options.rateLimit ?? 180) || buckets.size > 10000) {
      res.setHeader("Retry-After", "60");
      res.writeHead(429).end();
      return;
    }
    if (req.url === "/health") {
      res
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify({ service: "continuum-mcp", status: "running" }));
      return;
    }
    if (req.url !== "/mcp") {
      res.writeHead(404).end();
      return;
    }
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "POST, GET, DELETE");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "authorization,content-type,mcp-protocol-version,mcp-session-id",
      );
      res.writeHead(204).end();
      return;
    }
    const token = req.headers.authorization?.match(
      /^Bearer (ctm_[a-f0-9]{64})$/,
    )?.[1];
    if (!token) {
      res.setHeader("WWW-Authenticate", 'Bearer realm="Continuum"');
      res.writeHead(401).end();
      return;
    }
    let call: AgentCall;
    try {
      call = (
        options.gateway ||
        ((t: string) => createGateway({ ...process.env, CONTINUUM_TOKEN: t }))
      )(token);
    } catch {
      res
        .writeHead(503)
        .end(JSON.stringify({ error: "MCP backend configuration required" }));
      return;
    }
    try {
      await call("test_connection");
    } catch {
      res.writeHead(401).end();
      return;
    }
    const server = createMemoryServer(call);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      maxRequestBodySize: 2_100_000,
    });
    try {
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers))
        if (typeof v === "string") headers.set(k, v);
      const body = req.method === "POST" ? await readBody(req) : undefined;
      await server.connect(transport);
      const response = await transport.handleRequest(
        new Request(`http://localhost/mcp`, {
          method: req.method,
          headers,
          body: body ? new Uint8Array(body) : undefined,
        }),
      );
      response.headers.forEach((v, k) => res.setHeader(k, v));
      res.writeHead(response.status);
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      if (!res.headersSent) res.writeHead(400);
      res.end(JSON.stringify({ error: "Invalid or oversized MCP request" }));
    } finally {
      await server.close();
    }
  });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const port = Number(process.env.MCP_PORT || 3100);
  const host = process.env.MCP_BIND || "127.0.0.1";
  const allowedHosts = (
    process.env.MCP_ALLOWED_HOSTS || `localhost:${port},127.0.0.1:${port}`
  ).split(",");
  const server = createMcpHttpServer({
    allowedHosts,
    allowedOrigins: (process.env.APP_ORIGIN || "").split(",").filter(Boolean),
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.listen(port, host, () =>
    console.error(
      `Continuum MCP listening on ${host}:${port}; publish behind HTTPS.`,
    ),
  );
}
