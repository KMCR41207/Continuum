#!/usr/bin/env node
/**
 * continuum — command-line access to Continuum memory for coding agents.
 *
 * The token comes from CONTINUUM_TOKEN or ~/.continuum/token (written by
 * `continuum login`, mode 0600). Requests go through the scoped-token gateway;
 * no Supabase service key is ever used here.
 */
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir, hostname, platform as osPlatform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AgentError, createGateway, type AgentCall } from "./gateway.ts";
import { captureCodingSession, type SessionProvider } from "./sessionCapture.ts";
import { findProjectConfig, isExcluded, type ProjectConfig } from "./projectConfig.ts";
import { conversationSchema, type ConversationInput } from "../src/lib/memory.ts";
import { parseExport } from "../src/lib/importParsers.ts";

export const CLI_PATH = fileURLToPath(import.meta.url);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^ctm_[0-9a-f]{64}$/;

export type CliContext = {
  call: AgentCall;
  home: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Replaced in tests; opens a URL in the user's browser. */
  openUrl: (url: string) => Promise<boolean>;
  /** Replaced in tests; reads one line from the terminal. */
  prompt: (question: string) => Promise<string>;
  /** Builds a gateway for a freshly entered token (login), optionally at a new API URL. */
  gatewayFor: (token: string, apiUrl?: string) => AgentCall;
  log: (line: string) => void;
  /** Runs an external program (used for `claude mcp …`); replaced in tests. */
  exec: (command: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;
};

// ── local state (~/.continuum) ───────────────────────────────────────────────
export type LocalConfig = { api_url?: string; app_url?: string };
export const statePaths = (home: string) => ({
  dir: join(home, ".continuum"),
  token: join(home, ".continuum", "token"),
  device: join(home, ".continuum", "device.json"),
  config: join(home, ".continuum", "config.json"),
});
async function readJson<T>(path: string): Promise<T | null> {
  try { return JSON.parse(await readFile(path, "utf8")) as T; } catch { return null; }
}
async function writePrivate(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, content, { mode: 0o600 });
  await chmod(path, 0o600).catch(() => {});
}
export async function readToken(home: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  if (env.CONTINUUM_TOKEN) return env.CONTINUUM_TOKEN.trim();
  try { return (await readFile(statePaths(home).token, "utf8")).trim() || null; } catch { return null; }
}
export const readLocalConfig = async (home: string) => (await readJson<LocalConfig>(statePaths(home).config)) || {};
export const readDevice = (home: string) => readJson<{ device_id: string; name: string; platform: string }>(statePaths(home).device);

/** Environment for the gateway: explicit env wins, then ~/.continuum. */
export async function gatewayEnv(home: string, env: NodeJS.ProcessEnv, token?: string | null): Promise<NodeJS.ProcessEnv> {
  const config = await readLocalConfig(home);
  const resolved = token ?? (await readToken(home, env));
  const merged: NodeJS.ProcessEnv = { ...env };
  if (resolved) merged.CONTINUUM_TOKEN = resolved;
  if (!merged.CONTINUUM_API_URL && !merged.CONTINUUM_SUPABASE_URL)
    merged.CONTINUUM_API_URL = config.api_url || "http://127.0.0.1:3101";
  return merged;
}

// ── argument helpers ─────────────────────────────────────────────────────────
function takeOption(args: string[], name: string): string | undefined {
  const index = args.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (index < 0) return undefined;
  const [arg] = args.splice(index, 1);
  if (arg.includes("=")) return arg.slice(arg.indexOf("=") + 1);
  const [value] = args.splice(index, 1);
  if (value === undefined || value.startsWith("--")) throw new Error(`${name} needs a value`);
  return value;
}
function takeFlag(args: string[], name: string): boolean {
  const index = args.indexOf(name);
  if (index < 0) return false;
  args.splice(index, 1);
  return true;
}

// ── MCP client configuration ─────────────────────────────────────────────────
export const AGENTS = ["claude", "cursor", "codex"] as const;
export type AgentName = (typeof AGENTS)[number];
const AGENT_LABEL: Record<AgentName, string> = { claude: "Claude Code", cursor: "Cursor", codex: "Codex" };
export function agentConfigPaths(home: string): Record<AgentName, { dir: string; files: string[] }> {
  return {
    // Claude Code keeps user-scope servers in ~/.claude.json and rewrites that file
    // itself, so it is changed only through `claude mcp add-json/remove -s user`.
    claude: { dir: join(home, ".claude"), files: [join(home, ".claude.json")] },
    cursor: { dir: join(home, ".cursor"), files: [join(home, ".cursor", "mcp.json")] },
    // Codex reads TOML today; JSON is accepted for setups that use it.
    codex: { dir: join(home, ".codex"), files: [join(home, ".codex", "config.toml"), join(home, ".codex", "config.json")] },
  };
}
export function mcpServerEntry(env: NodeJS.ProcessEnv = {}) {
  const entry: { command: string; args: string[]; env?: Record<string, string> } = {
    command: process.execPath,
    args: [CLI_PATH, "mcp", "serve"],
  };
  // Only non-secret endpoint settings; the token stays in ~/.continuum/token.
  if (env.CONTINUUM_API_URL) entry.env = { CONTINUUM_API_URL: env.CONTINUUM_API_URL };
  return entry;
}
function parseAgents(value: string | undefined): AgentName[] {
  if (!value) return [...AGENTS];
  const names = value.split(",").map((v) => v.trim().toLowerCase().replace(/^claude-code$/, "claude")).filter(Boolean);
  const unknown = names.filter((n) => !(AGENTS as readonly string[]).includes(n));
  if (unknown.length) throw new Error(`Unknown agent(s): ${unknown.join(", ")}. Choose from ${AGENTS.join(", ")}.`);
  return [...new Set(names)] as AgentName[];
}
const tomlString = (value: string) => JSON.stringify(value);
const TOML_HEADER = "[mcp_servers.continuum]";
function removeTomlBlock(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (line.trim() === TOML_HEADER || line.trim().startsWith("[mcp_servers.continuum.")) { skipping = true; continue; }
    if (skipping && /^\s*\[/.test(line)) skipping = false;
    if (!skipping) out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
function addTomlBlock(text: string, entry: ReturnType<typeof mcpServerEntry>): string {
  const block = [
    TOML_HEADER,
    `command = ${tomlString(entry.command)}`,
    `args = [${entry.args.map(tomlString).join(", ")}]`,
    ...(entry.env ? [`env = { ${Object.entries(entry.env).map(([k, v]) => `${k} = ${tomlString(v)}`).join(", ")} }`] : []),
  ].join("\n");
  const base = removeTomlBlock(text).trim();
  return (base ? `${base}\n\n` : "") + block + "\n";
}

type McpChange = { agent: AgentName; label: string; file: string | null; action: "written" | "removed" | "unchanged" | "not_found" | "error"; detail?: string; instructions?: string };
async function configureClaude(enable: boolean, entry: ReturnType<typeof mcpServerEntry>, home: string, exec: CliContext["exec"]): Promise<McpChange> {
  const label = AGENT_LABEL.claude;
  const file = join(home, ".claude.json");
  const json = JSON.stringify({ type: "stdio", ...entry });
  const command = enable ? ["mcp", "add-json", "continuum", json, "-s", "user"] : ["mcp", "remove", "continuum", "-s", "user"];
  let result: { code: number; stdout: string; stderr: string };
  try { result = await exec("claude", command); }
  catch {
    return enable
      ? { agent: "claude", label, file: null, action: "not_found", instructions: `The claude command was not found. Install Claude Code, then run:\nclaude mcp add-json continuum '${json}' -s user` }
      : { agent: "claude", label, file: null, action: "unchanged", detail: "claude command not found" };
  }
  const output = `${result.stdout}\n${result.stderr}`;
  if (result.code === 0) return { agent: "claude", label, file, action: enable ? "written" : "removed" };
  // Re-running `on` replaces the server so a moved checkout keeps working.
  if (enable && /already exists/i.test(output)) {
    const removed = await exec("claude", ["mcp", "remove", "continuum", "-s", "user"]);
    const added = removed.code === 0 ? await exec("claude", command) : removed;
    if (added.code === 0) return { agent: "claude", label, file, action: "written" };
    return { agent: "claude", label, file, action: "error", detail: (added.stderr || added.stdout).trim().slice(0, 300) };
  }
  if (!enable && /no .*found|not found|does not exist/i.test(output)) return { agent: "claude", label, file, action: "unchanged", detail: "not configured" };
  return { agent: "claude", label, file, action: "error", detail: output.trim().slice(0, 300) };
}

async function configureAgent(agent: AgentName, home: string, enable: boolean, entry: ReturnType<typeof mcpServerEntry>, exec: CliContext["exec"]): Promise<McpChange> {
  if (agent === "claude") return configureClaude(enable, entry, home, exec);
  const { dir, files } = agentConfigPaths(home)[agent];
  const label = AGENT_LABEL[agent];
  const existing = files.find((file) => existsSync(file));
  // Write only where the agent is installed (its folder exists).
  const file = existing || (existsSync(dir) ? files[0] : null);
  if (!file) {
    return enable
      ? { agent, label, file: null, action: "not_found", instructions: `${label} config folder ${dir} was not found. Add this to its MCP configuration:\n${JSON.stringify({ mcpServers: { continuum: entry } }, null, 2)}` }
      : { agent, label, file: null, action: "unchanged", detail: "not installed" };
  }
  const original = existing ? await readFile(file, "utf8") : "";
  let next: string;
  if (file.endsWith(".toml")) {
    next = enable ? addTomlBlock(original, entry) : removeTomlBlock(original);
  } else {
    let data: Record<string, unknown>;
    try { data = original.trim() ? JSON.parse(original) : {}; }
    catch { return { agent, label, file, action: "error", detail: "existing file is not valid JSON; it was left unchanged" }; }
    if (!data || typeof data !== "object" || Array.isArray(data)) return { agent, label, file, action: "error", detail: "existing file is not a JSON object; it was left unchanged" };
    const servers = (data.mcpServers && typeof data.mcpServers === "object" ? data.mcpServers : {}) as Record<string, unknown>;
    if (enable) servers.continuum = entry;
    else delete servers.continuum;
    data.mcpServers = servers;
    next = JSON.stringify(data, null, 2) + "\n";
  }
  if (next === original || (!enable && !existing)) return { agent, label, file, action: "unchanged" };
  // Keep one backup of the user's original file.
  if (existing && !existsSync(`${file}.continuum-backup`)) await writeFile(`${file}.continuum-backup`, original);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, next);
  return { agent, label, file, action: enable ? "written" : "removed" };
}

// ── capture with CONTINUUM.md ────────────────────────────────────────────────
async function resolveProject(call: AgentCall, explicit: string | undefined, config: ProjectConfig | null): Promise<string | null> {
  const wanted = explicit ?? config?.project;
  if (!wanted) return null;
  if (UUID.test(wanted)) return wanted;
  const projects = (await call("list_projects", { limit: 100 })) as { id: string; name: string }[];
  const match = Array.isArray(projects) ? projects.find((p) => p.name.trim().toLowerCase() === wanted.trim().toLowerCase()) : undefined;
  if (!match) throw new Error(`Project "${wanted}" was not found or this token cannot access it.`);
  return match.id;
}

/** Normalized conversation(s) from a JSON file: one conversation, an array, or a ChatGPT/Claude/Grok export. */
export function conversationsFromJson(raw: unknown): ConversationInput[] {
  if (raw && typeof raw === "object" && !Array.isArray(raw) && "messages" in raw) return [conversationSchema.parse(raw)];
  if (Array.isArray(raw) && raw.length && raw.every((r) => r && typeof r === "object" && "messages" in r && "platform" in r))
    return raw.map((r) => conversationSchema.parse(r));
  return parseExport(raw).conversations;
}

export type CaptureGate = { skipped: true; reason: string } | { skipped: false; projectId: string | null; configDir: string | null };
export async function captureGate(file: string, cwd: string, call: AgentCall, explicitProject?: string): Promise<CaptureGate> {
  const found = findProjectConfig(cwd);
  if (found?.config.save === false) return { skipped: true, reason: `capture disabled by CONTINUUM.md (${found.dir})` };
  if (found && isExcluded(resolve(cwd, file), found.dir, found.config.exclude))
    return { skipped: true, reason: `${file} is excluded by CONTINUUM.md` };
  return { skipped: false, projectId: await resolveProject(call, explicitProject, found?.config ?? null), configDir: found?.dir ?? null };
}

// ── commands ─────────────────────────────────────────────────────────────────
export const USAGE = `continuum — Continuum memory from the command line

Usage: continuum <command> [options]   (add --json for machine-readable output)

  status                       Plan, usage, connected agents, queue and last sync
  login [--token ctm_…] [--api URL] [--app URL]
                               Save a scoped token (opens Connections to create one)
  logout                       Revoke this token and remove it from this computer
  search <query> [--project P] [--limit N]
                               Search approved memories
  capture <file.json> [--project P] [--dry-run]
                               Capture a conversation, a list of them, or a
                               ChatGPT/Claude/Grok export file
  capture <claude-code|codex|cursor> <session file> [project] [--dry-run]
                               Capture a coding-agent session
  mcp list                     List connections with provider, state and expiry
  mcp on  [--agents claude,cursor,codex]
                               Add Continuum to agent MCP config files
  mcp off [--agents …]         Remove Continuum from agent MCP config files
  mcp serve                    Run the MCP server on stdio (used by agents)
  projects                     List projects this token can access
  link list | create [private|approval|public] | join <code>
       | post <link> <message> | read <link> [since] | close <link>
  export <new-file.json>       Export approved memories
  help                         Show this help

CONTINUUM.md in a repository controls capture: save: false skips it,
project: Name assigns captures, exclude: [paths] skips matching files.
Token: CONTINUUM_TOKEN or ~/.continuum/token. API: CONTINUUM_API_URL or
~/.continuum/config.json (default http://127.0.0.1:3101).`;

/** Commands that run without a stored token or device. */
const LOCAL_COMMANDS = new Set(["help", "--help", "-h", "login", "logout", "mcp"]);

export async function runCommand(argv: string[], context: AgentCall | Partial<CliContext>): Promise<unknown> {
  const ctx = toContext(context);
  const args = [...argv];
  const command = args.shift();
  const { call } = ctx;
  switch (command) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      return { usage: USAGE };
    case "connect":
    case "diagnostics":
      return call("test_connection");
    case "status": {
      const [connection, workspace] = await Promise.all([call("test_connection"), call("workspace_status")]);
      const device = await readDevice(ctx.home);
      return { ...(workspace as Record<string, unknown>), permissions: connection, device_id: device?.device_id ?? null };
    }
    case "login": return login(args, ctx);
    case "logout":
    case "disconnect": return logout(ctx);
    case "projects": return call("list_projects");
    case "search": {
      const project = takeOption(args, "--project");
      const limit = takeOption(args, "--limit");
      const query = args.join(" ").trim();
      if (!query) throw new Error("Usage: search <query> [--project P] [--limit N]");
      const projectId = await resolveProject(call, project, null);
      return call("search_memory", { query, ...(projectId ? { project_id: projectId } : {}), ...(limit ? { limit: Number(limit) } : {}) });
    }
    case "import":
    case "capture": return capture(command, args, ctx);
    case "mcp": {
      const action = args.shift();
      const agents = parseAgents(takeOption(args, "--agents"));
      if (action === "list") return call("list_connections");
      if (action === "on" || action === "off") {
        const entry = mcpServerEntry(ctx.env);
        const changes: McpChange[] = [];
        for (const agent of agents) changes.push(await configureAgent(agent, ctx.home, action === "on", entry, ctx.exec));
        return { action, entry, changes };
      }
      throw new Error("Usage: mcp list | mcp on [--agents claude,cursor,codex] | mcp off [--agents …] | mcp serve");
    }
    case "link": {
      const action = args.shift();
      if (action === "list") return call("list_links");
      if (action === "create") return call("create_link", { type: args[0] || "private", ...(args[1] ? { name: args.slice(1).join(" ") } : {}) });
      if (action === "join" && args[0]) return call("join_link", { code: args[0] });
      if (action === "post" && args[0] && args.length >= 2) return call("post_to_link", { link_id: args[0], content: args.slice(1).join(" ") });
      if (action === "read" && args[0]) return call("read_link", { link_id: args[0], ...(args[1] ? { since: args[1] } : {}) });
      if (action === "close" && args[0]) return call("close_link", { link_id: args[0] });
      throw new Error("Usage: link list | link create [private|approval|public] [name] | link join <code> | link post <link UUID> <message> | link read <link UUID> [since ISO time] | link close <link UUID>");
    }
    case "export": {
      if (!args[0]) throw new Error("Usage: export <new-output.json>");
      const memories: unknown[] = [];
      for (let offset = 0; ; offset += 100) {
        const batch = await call("export_memories", { offset, limit: 100 });
        if (!Array.isArray(batch)) throw new Error("Invalid export response");
        memories.push(...batch);
        if (batch.length < 100) break;
      }
      await writeFile(args[0], JSON.stringify({ exported_at: new Date().toISOString(), memories }, null, 2), { flag: "wx", mode: 0o600 });
      return { exported: memories.length, file: args[0] };
    }
    default:
      throw new Error(`Unknown command "${command}".\n\n${USAGE}`);
  }
}

async function capture(command: string, args: string[], ctx: CliContext) {
  const dryRun = takeFlag(args, "--dry-run");
  const project = takeOption(args, "--project");
  const sessionProvider = args[0] === "claude-code" ? "claude" : args[0];
  // Coding-agent sessions: capture <claude-code|codex|cursor> <file> [project]
  if (command === "capture" && ["claude", "codex", "cursor"].includes(sessionProvider) && args[1]) {
    const [, file, positional] = args;
    if (args.length > 3 || (positional !== undefined && project !== undefined)) throw new Error("Usage: capture <claude-code|codex|cursor> <session.jsonl|export.md> [project] [--dry-run]");
    const gate = await captureGate(file, ctx.cwd, dryRun ? offline : ctx.call, project ?? positional);
    if (gate.skipped) { ctx.log(`[continuum] ${gate.reason}`); return { skipped: true, reason: gate.reason, uploaded: false }; }
    return captureCodingSession(sessionProvider as SessionProvider, file, gate.projectId ?? undefined, ctx.call, dryRun);
  }
  const [file, positional] = args;
  if (!file || args.length > 2) throw new Error("Usage: capture <file.json> [--project P] [--dry-run]");
  const gate = await captureGate(file, ctx.cwd, dryRun ? offline : ctx.call, project ?? positional);
  if (gate.skipped) { ctx.log(`[continuum] ${gate.reason}`); return { skipped: true, reason: gate.reason, uploaded: false }; }
  const path = resolve(ctx.cwd, file);
  const info = await stat(path);
  if (!info.isFile() || info.size > 20_000_000) throw new Error("Capture file must be a JSON file no larger than 20 MB");
  let raw: unknown;
  try { raw = JSON.parse(await readFile(path, "utf8")); } catch { throw new Error(`${file} is not valid JSON`); }
  const conversations = conversationsFromJson(raw);
  if (!conversations.length) throw new Error("No conversations with text messages were found");
  const summary = { file, conversations: conversations.length, messages: conversations.reduce((n, c) => n + c.messages.length, 0), project_id: gate.projectId };
  if (dryRun) return { ...summary, uploaded: false, titles: conversations.map((c) => c.title) };
  const results: { title: string; id?: string; duplicate?: boolean; proposals?: number; error?: string }[] = [];
  for (const conversation of conversations) {
    try {
      const result = (await ctx.call("capture_conversation", { project_id: gate.projectId, conversation })) as { id: string; duplicate: boolean; proposals: number };
      results.push({ title: conversation.title, ...result });
    } catch (error) {
      results.push({ title: conversation.title, error: error instanceof Error ? error.message : "Capture failed" });
    }
  }
  return {
    ...summary,
    uploaded: true,
    imported: results.filter((r) => r.id && !r.duplicate).length,
    duplicates: results.filter((r) => r.duplicate).length,
    failed: results.filter((r) => r.error).length,
    results,
  };
}
const offline: AgentCall = async () => { throw new Error("A dry run cannot contact Continuum; pass a project UUID instead of a name."); };

async function login(args: string[], ctx: CliContext) {
  const paths = statePaths(ctx.home);
  const config = await readLocalConfig(ctx.home);
  const api = takeOption(args, "--api");
  const app = takeOption(args, "--app");
  let token = takeOption(args, "--token") || "";
  if (api) config.api_url = new URL(api).toString().replace(/\/$/, "");
  if (app) config.app_url = new URL(app).toString().replace(/\/$/, "");
  if (!token) {
    const url = `${config.app_url || ctx.env.CONTINUUM_APP_URL || "http://127.0.0.1:5173"}/app/connections`;
    const opened = await ctx.openUrl(url).catch(() => false);
    ctx.log(opened ? `Opened ${url}` : `Open this page to create a token: ${url}`);
    ctx.log("Create a connection (provider: Claude, Codex, Cursor or Other), then paste its token.");
    token = (await ctx.prompt("Token (ctm_…): ")).trim();
  }
  if (!TOKEN.test(token)) throw new Error("That is not a Continuum token. Tokens start with ctm_ followed by 64 hex characters.");
  const call = ctx.gatewayFor(token, api ? config.api_url : undefined);
  const connection = (await call("test_connection")) as Record<string, unknown>;
  await writePrivate(paths.token, `${token}\n`);
  await writePrivate(paths.config, JSON.stringify(config, null, 2) + "\n");
  let device = await readDevice(ctx.home);
  if (!device) {
    const name = hostname().slice(0, 100) || "computer";
    const platform = osPlatform();
    const registered = (await call("register_device", { name, platform })) as { device_id: string };
    device = { device_id: registered.device_id, name, platform };
    await writePrivate(paths.device, JSON.stringify(device, null, 2) + "\n");
  }
  return { logged_in: true, connection: { id: connection.id, provider: connection.provider }, device_id: device.device_id, token_file: paths.token };
}

async function logout(ctx: CliContext) {
  const paths = statePaths(ctx.home);
  let revoked = false;
  try { await ctx.call("disconnect"); revoked = true; }
  catch (error) { ctx.log(`[continuum] token could not be revoked remotely: ${error instanceof Error ? error.message : error}`); }
  await rm(paths.token, { force: true });
  await rm(paths.device, { force: true });
  return { logged_out: true, revoked };
}

/** Records the heartbeat; a revoked device loses its stored token. */
export async function heartbeat(ctx: CliContext): Promise<void> {
  const device = await readDevice(ctx.home);
  if (!device) return;
  try {
    await ctx.call("device_heartbeat", { device_id: device.device_id });
  } catch (error) {
    if (error instanceof AgentError && error.code === "device_revoked") {
      const paths = statePaths(ctx.home);
      await rm(paths.token, { force: true });
      await rm(paths.device, { force: true });
      throw new Error("This device was revoked in Continuum → Devices. Run `continuum login` to connect it again.");
    }
    // Offline or older server: heartbeats are best effort.
  }
}

// ── output ───────────────────────────────────────────────────────────────────
const when = (value: unknown) => (typeof value === "string" && value ? new Date(value).toLocaleString() : "never");
export function render(command: string | undefined, sub: string | undefined, data: unknown): string {
  if (data && typeof data === "object" && "usage" in data && typeof (data as { usage: unknown }).usage === "string") return (data as { usage: string }).usage;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d: any = data;
  if (command === "status") {
    const u = d.usage || {};
    const agents = (d.agents || []) as { provider: string; name: string; state: string; last_activity_at: string | null }[];
    return [
      `Continuum — ${d.workspace?.name ?? "workspace"}`,
      `Plan:        ${d.plan?.id ?? "free"} (${d.plan?.status ?? "unconfigured"})`,
      `Usage:       ${u.memories ?? 0} memories (${u.pending_memories ?? 0} pending review) · ${u.conversations ?? 0} conversations · ${u.projects ?? 0} projects · ${u.requests_30d ?? 0} requests in 30 days`,
      `This token:  ${d.connection?.name} (${d.connection?.provider}) · ${d.connection?.state} · expires ${when(d.connection?.expires_at)}`,
      `Agents (${agents.length}):${agents.length ? "" : " none"}`,
      ...agents.map((a) => `  • ${a.name} (${a.provider}) — ${a.state}, last active ${when(a.last_activity_at)}`),
      `Queue:       ${d.pending_jobs ?? 0} pending job(s)`,
      `Last sync:   ${when(d.last_sync_at)}`,
      `Device:      ${d.device_id ?? "not registered (run continuum login)"}`,
    ].join("\n");
  }
  if (command === "search" && Array.isArray(data)) {
    if (!data.length) return "No matching memories.";
    return data.map((m: any, i: number) => {
      const source = m.sources?.[0];
      return `${i + 1}. [${m.category}] ${m.content}${source ? `\n   from “${source.title}” (${source.platform})` : ""}`;
    }).join("\n");
  }
  if (command === "mcp" && sub === "list" && Array.isArray(data)) {
    return data.length
      ? data.map((c: any) => `${c.current ? "*" : " "} ${c.provider.padEnd(11)} ${c.name.padEnd(24)} ${c.state.padEnd(9)} expires ${when(c.expires_at)}`).join("\n")
      : "No connections.";
  }
  if (command === "mcp" && (sub === "on" || sub === "off")) {
    return (d.changes as McpChange[]).map((c) =>
      c.action === "written" ? `✓ ${c.label}: Continuum added to ${c.file}`
        : c.action === "removed" ? `✓ ${c.label}: Continuum removed from ${c.file}`
          : c.action === "not_found" ? `• ${c.label}: ${c.instructions}`
            : c.action === "error" ? `✗ ${c.label}: ${c.file} — ${c.detail}`
              : `• ${c.label}: no change${c.detail ? ` (${c.detail})` : ""}`).join("\n") +
      (sub === "on" ? "\nRestart the agent to load the server." : "");
  }
  if ((command === "capture" || command === "import") && d && !Array.isArray(d)) {
    if (d.skipped) return `Skipped: ${d.reason}`;
    if (d.uploaded === false) return `Dry run: ${d.conversations ?? d.parts} conversation(s), ${d.messages} messages — nothing uploaded.`;
    if ("imported" in d) return `Captured ${d.imported} of ${d.conversations} conversation(s) (${d.duplicates} duplicates, ${d.failed} failed).`;
  }
  if (command === "login" && d?.logged_in) return `Logged in as ${d.connection.provider} connection. Token saved to ${d.token_file}. Device ${d.device_id}.`;
  if (command === "logout") return d.revoked ? "Logged out. The token was revoked." : "Logged out locally. The token could not be revoked remotely; revoke it in Connections.";
  return JSON.stringify(data, null, 2);
}

// ── process entry ────────────────────────────────────────────────────────────
/** Runs a program without a shell; rejects only when it cannot be started. */
function runProgram(command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((done, fail) => {
    execFile(command, args, { timeout: 60000, windowsHide: true }, (error, stdout, stderr) => {
      if (error && (error as NodeJS.ErrnoException).code === "ENOENT") return fail(error);
      const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
      done({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}
async function openInBrowser(url: string): Promise<boolean> {
  const [cmd, cmdArgs] = process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
    : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  return new Promise((done) => {
    try {
      const child = spawn(cmd, cmdArgs as string[], { stdio: "ignore", detached: true });
      child.on("error", () => done(false));
      child.on("spawn", () => { child.unref(); done(true); });
    } catch { done(false); }
  });
}
async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try { return await rl.question(question); } finally { rl.close(); }
}

function toContext(context: AgentCall | Partial<CliContext>): CliContext {
  const base: Partial<CliContext> = typeof context === "function" ? { call: context } : context;
  const call = base.call ?? (async () => { throw new Error("Not logged in. Run `continuum login` or set CONTINUUM_TOKEN."); });
  return {
    call,
    home: base.home ?? homedir(),
    cwd: base.cwd ?? process.cwd(),
    env: base.env ?? process.env,
    openUrl: base.openUrl ?? openInBrowser,
    prompt: base.prompt ?? ask,
    gatewayFor: base.gatewayFor ?? (() => call),
    log: base.log ?? ((line) => console.error(line)),
    exec: base.exec ?? runProgram,
  };
}

export async function main(argv: string[], env: NodeJS.ProcessEnv = process.env, home = homedir()) {
  const args = [...argv];
  const json = takeFlag(args, "--json");
  const [command, sub] = args;
  const genv = await gatewayEnv(home, env);
  const lazyCall: AgentCall = (operation, payload) => createGateway(genv)(operation, payload);
  const ctx = toContext({
    call: lazyCall,
    home,
    env: genv,
    gatewayFor: (token, apiUrl) => (operation, payload) =>
      createGateway({ ...genv, CONTINUUM_TOKEN: token, ...(apiUrl ? { CONTINUUM_API_URL: apiUrl } : {}) })(operation, payload),
  });
  if (command === "mcp" && (sub === "serve" || sub === undefined)) {
    const [{ createMemoryServer }, { StdioServerTransport }] = await Promise.all([
      import("./mcp.ts"), import("@modelcontextprotocol/server/stdio"),
    ]);
    await heartbeat(ctx);
    await createMemoryServer(createGateway(genv)).connect(new StdioServerTransport());
    return;
  }
  const dryRun = args.includes("--dry-run");
  if (command && !LOCAL_COMMANDS.has(command) && !dryRun && genv.CONTINUUM_TOKEN) await heartbeat(ctx);
  else if (command === "mcp" && sub === "list" && genv.CONTINUUM_TOKEN) await heartbeat(ctx);
  const data = await runCommand(args, ctx);
  console.log(json ? JSON.stringify(data, null, 2) : render(command, sub, data));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : "Command failed");
    process.exitCode = 1;
  });
}
