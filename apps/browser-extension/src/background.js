import { api, settings, save } from "./lib/storage.js";
import { upload } from "./lib/api.js";
import { normalizedConversation, contentHash } from "./lib/normalizer.js";

let serial = Promise.resolve();

async function record(status) {
  const config = await settings();
  await save({ history: [{ at: new Date().toISOString(), status }, ...config.history].slice(0, 50) });
}

async function flush() {
  const config = await settings();
  if (!config.consent || config.paused) return;
  if (!config.token) return;

  for (const item of [...config.queue]) {
    // Re-read config each iteration in case it changed
    const current = await settings();
    if (!current.consent || current.paused || !current.token) break;
    if (!current[item.provider]) continue;
    if (item.attempts >= 5) continue;
    if (item.next > Date.now()) continue;
    // Endpoint and supabase config must match what was set at capture time
    if (item.supabaseUrl !== current.supabaseUrl) continue;

    try {
      await upload(current, item.conversation);
      const latest = await settings();
      await save({
        queue: latest.queue.filter((q) => q.hash !== item.hash),
        sent: [...latest.sent, item.hash].slice(-200),
      });
      const projectName = item.projectName ? ` → ${item.projectName}` : "";
      await record(`Saved to Continuum${projectName}. Review memories in Continuum.`);
    } catch (err) {
      const latest = await settings();
      const attempts = item.attempts + 1;
      const delay = Math.min(3600000, 10000 * 2 ** item.attempts);
      await save({
        queue: latest.queue.map((q) =>
          q.hash === item.hash
            ? { ...q, attempts, next: Date.now() + delay }
            : q
        ),
      });
      await record(`Capture failed (attempt ${attempts}/5): ${err.message}`);
    }
  }
}

api.runtime.onMessage.addListener((message, sender, respond) => {
  serial = serial.catch(() => {}).then(async () => {
    // ── Status query from content script ──────────────────────────────────
    if (message.type === "status") {
      const config = await settings();
      return {
        active: config.consent && config[message.provider] && !config.paused,
        auto: config.auto,
        project: config.project || null,
        projectName: config.projectName || null,
        connected: Boolean(config.token && (config.supabaseUrl || config.endpoint)),
      };
    }

    // ── Capture request from content script ───────────────────────────────
    if (message.type === "capture") {
      if (!sender.tab || !sender.url) return { error: "Invalid sender" };

      const config = await settings();
      const hostname = new URL(sender.url).hostname;
      const provider =
        hostname === "chatgpt.com" ? "chatgpt" :
        hostname === "claude.ai" ? "claude" : null;

      if (!provider) return { error: "Unsupported provider" };
      if (!config.consent) return { error: "Capture not authorized. Enable consent in settings." };
      if (!config[provider]) return { error: `${provider} capture is disabled in settings.` };
      if (config.paused) return { error: "Capture is paused." };
      if (message.automatic && !config.auto) return { error: "Auto-capture is disabled." };  // Return error so test can check
      if (!config.token) return { error: "No token configured. Open extension settings." };

      let conversation;
      try {
        conversation = normalizedConversation(provider, message.messages, message.title, sender.url);
      } catch (err) {
        return { error: `Content error: ${err.message}` };
      }

      const hash = await contentHash(conversation);

      // Duplicate check — already sent
      if (config.sent.includes(hash)) {
        return { status: "Already captured. No duplicate created." };
      }

      // Duplicate check — already queued
      if (!config.queue.some((q) => q.hash === hash)) {
        if (config.queue.length >= 20) {
          return { error: "Queue full. Check network and retry later." };
        }
        await save({
          queue: [
            ...config.queue,
            {
              hash,
              provider,
              conversation,
              supabaseUrl: config.supabaseUrl,
              project: config.project || null,
              projectName: config.projectName || null,
              attempts: 0,
              next: 0,
            },
          ],
        });
      }

      // Attempt immediate upload
      await flush();

      // Check if it went through
      const after = await settings();
      if (after.sent.includes(hash)) {
        const projectName = config.projectName ? ` → ${config.projectName}` : "";
        return { status: `Saved to Continuum${projectName}.` };
      }

      const queued = after.queue.find((q) => q.hash === hash);
      if (queued && queued.attempts > 0) {
        return { error: "Upload failed. Will retry automatically. Check settings if this persists." };
      }

      return { status: "Queued for upload." };
    }

    // ── Project selection from popup/web app ──────────────────────────────
    if (message.type === "set_project") {
      await save({ project: message.project || "", projectName: message.projectName || "" });
      return { ok: true };
    }

    // ── Manual flush trigger ───────────────────────────────────────────────
    if (message.type === "flush") {
      await flush();
      return { ok: true };
    }

    return {};
  });

  serial.then(respond, (err) =>
    respond({ error: err?.message || "Extension error. Check service worker." })
  );
  return true;  // Keep message channel open for async response
});

// Periodic retry alarm
api.alarms.create("retry", { periodInMinutes: 1 });
api.alarms.onAlarm.addListener(() => {
  serial = serial.catch(() => {}).then(flush);
});

// Lock storage from content scripts on install/update
api.runtime.onInstalled.addListener(async () => {
  await api.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" });
});
