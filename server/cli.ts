import { readFile, writeFile } from "node:fs/promises";
import { createGateway, type AgentCall } from "./gateway.ts";
import { pathToFileURL } from "node:url";

export async function runCommand(args: string[], call: AgentCall) {
  const [command, ...rest] = args;
  switch (command) {
    case "login":
    case "connect":
    case "diagnostics":
    case "status":
      return call("test_connection");
    case "logout":
    case "disconnect":
      return call("disconnect");
    case "projects":
      return call("list_projects");
    case "search":
      return call("search_memory", { query: rest.join(" ") });
    case "import": {
      if (!rest[0])
        throw new Error("Usage: import <conversation.json> [project UUID]");
      const raw = await readFile(rest[0], "utf8");
      if (Buffer.byteLength(raw) > 2000000)
        throw new Error("Import exceeds 2 MB");
      return call("capture_conversation", {
        conversation: JSON.parse(raw),
        project_id: rest[1],
      });
    }
    case "export": {
      if (!rest[0]) throw new Error("Usage: export <new-output.json>");
      const memories: unknown[] = [];
      for (let offset = 0; ; offset += 100) {
        const batch = await call("export_memories", { offset, limit: 100 });
        if (!Array.isArray(batch)) throw new Error("Invalid export response");
        memories.push(...batch);
        if (batch.length < 100) break;
      }
      await writeFile(
        rest[0],
        JSON.stringify(
          { exported_at: new Date().toISOString(), memories },
          null,
          2,
        ),
        { flag: "wx", mode: 0o600 },
      );
      return { exported: memories.length, file: rest[0] };
    }
    default:
      throw new Error(
        "Commands: login, logout, connect, disconnect, status, projects, search <query>, import <file> [project], export <new-file>, diagnostics. Set CONTINUUM_* environment variables. Login validates an owner-issued token; logout revokes it. Tokens are never persisted by this CLI.",
      );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    console.log(
      JSON.stringify(
        await runCommand(process.argv.slice(2), createGateway()),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Command failed");
    process.exitCode = 1;
  }
}
