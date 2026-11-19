import { pathToFileURL } from "node:url";
import { serviceClient } from "./service.ts";
import { embeddingProvider, type EmbeddingProvider } from "./embeddings.ts";
import { extractionProvider, type ExtractionProvider } from "./extraction.ts";
import type { ConversationInput } from "../src/lib/memory.ts";
type WorkerDatabase = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: any; error: unknown }>;
};
export type WorkerEvent =
  | { event: "tick"; worker_id: string; claimed: number; failed: number }
  | { event: "queue_unavailable"; worker_id: string };
export function reportWorkerEvent(event: WorkerEvent) {
  // Keep structured output intentionally free of source content, tokens, and payloads.
  console.error(JSON.stringify({ at: new Date().toISOString(), ...event }));
}
async function heartbeat(
  db: WorkerDatabase,
  workerId: string,
  state: "healthy" | "degraded" | "stopped",
  error: string | null,
) {
  // A rollout where migration 007 is not applied must not make job processing fail.
  try {
    await db.rpc("heartbeat_worker", {
      p_worker_id: workerId,
      p_state: state,
      p_error: error,
    });
  } catch {
    /* Queue execution remains authoritative; health reporting is best effort. */
  }
}
export async function workerTick(
  options: {
    db?: WorkerDatabase;
    provider?: EmbeddingProvider | null;
    extractor?: ExtractionProvider | null;
    workerId?: string;
    report?: (event: WorkerEvent) => void;
  } = {},
) {
  const db = options.db || serviceClient();
  const workerId =
    options.workerId || process.env.WORKER_ID || "continuum-worker";
  const report = options.report || reportWorkerEvent;
  const claimed = await db.rpc("claim_jobs", { p_limit: 5 });
  if (claimed.error) {
    await heartbeat(db, workerId, "degraded", "Queue unavailable");
    report({ event: "queue_unavailable", worker_id: workerId });
    throw new Error("Unable to claim jobs");
  }
  let failed = 0;
  for (const job of claimed.data) {
    try {
      if (job.kind === "import") {
        const result = await db.rpc("run_import_job", {
          p_id: job.id,
          p_lease: job.lease_id,
        });
        if (result.error) throw new Error("Import job failed");
      } else if (job.kind === "extraction") {
        // LLM-based memory extraction
        const extractor =
          options.extractor === undefined
            ? extractionProvider()
            : options.extractor;
        if (!extractor) throw new Error("Extraction provider not configured");

        const input = await db.rpc("extraction_job_input", {
          p_id: job.id,
          p_lease: job.lease_id,
        });
        if (input.error) throw new Error("Extraction job no longer authorized");

        // Build the ConversationInput from the DB payload
        const conv = input.data as {
          id: string;
          conversation_id: string;
          workspace_id: string;
          project_id: string | null;
          title: string;
          platform: string;
          messages: { role: "user" | "assistant"; content: string }[];
        };
        const conversationInput: ConversationInput = {
          title: conv.title,
          platform: conv.platform,
          messages: conv.messages,
        };

        const proposals = await extractor.extract(conversationInput);

        const stored = await db.rpc("complete_extraction_job", {
          p_id: job.id,
          p_lease: job.lease_id,
          p_model: extractor.model,
          // Send a JSON array, not a string: PostgREST would store a string as a jsonb scalar.
          p_proposals: proposals,
        });
        if (stored.error) throw new Error("Extraction store failed");
      } else {
        // embedding job
        const provider =
          options.provider === undefined
            ? embeddingProvider()
            : options.provider;
        if (!provider) throw new Error("Embedding configuration required");
        const input = await db.rpc("embedding_job_input", {
          p_id: job.id,
          p_lease: job.lease_id,
        });
        if (input.error) throw new Error("Embedding job no longer authorized");
        const embedding = await provider.embed(input.data.content);
        const stored = await db.rpc("complete_embedding_job", {
          p_id: job.id,
          p_lease: job.lease_id,
          p_model: provider.model,
          p_vector: JSON.stringify(embedding),
        });
        if (stored.error) throw new Error("Embedding store failed");
      }
    } catch {
      failed++;
      await db.rpc("finish_job", {
        p_id: job.id,
        p_lease: job.lease_id,
        p_error: "Processing failed",
        p_result: null,
      });
    }
  }
  await heartbeat(
    db,
    workerId,
    failed ? "degraded" : "healthy",
    failed ? `${failed} job(s) failed during this tick` : null,
  );
  report({
    event: "tick",
    worker_id: workerId,
    claimed: claimed.data.length,
    failed,
  });
  return claimed.data.length;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  let stopping = false;
  process.on("SIGTERM", () => {
    stopping = true;
  });
  process.on("SIGINT", () => {
    stopping = true;
  });
  do {
    try {
      await workerTick();
    } catch {
      reportWorkerEvent({
        event: "queue_unavailable",
        worker_id: process.env.WORKER_ID || "continuum-worker",
      });
      if (process.argv.includes("--once")) process.exitCode = 1;
    }
    if (process.argv.includes("--once") || stopping) break;
    await new Promise((r) => setTimeout(r, 5000));
  } while (!stopping);
  try {
    await heartbeat(
      serviceClient(),
      process.env.WORKER_ID || "continuum-worker",
      "stopped",
      null,
    );
  } catch {
    /* The process is stopping because its service configuration is unavailable. */
  }
}
