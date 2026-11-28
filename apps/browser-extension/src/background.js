import { api, settings, save } from "./lib/storage.js";
import { upload } from "./lib/api.js";
import { restoreChatTabs } from "./lib/chat-tabs.js";
import { normalizedConversation, contentHash, withoutAttachments, chatPath } from "./lib/normalizer.js";

let serial = Promise.resolve();

function destinationKey(endpoint, project, url) {
  return JSON.stringify([endpoint, project || "", url]);
}

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
    // Endpoint must match what was set at capture time
    if (item.endpoint !== current.endpoint) continue;

    try {
      // The toggle may have been switched off after this item was queued.
      const conversation = current.captureFiles === false
        ? { ...item.conversation, messages: withoutAttachments(item.conversation.messages) }
        : item.conversation;
      await upload({ ...current, project: item.project }, conversation);
      const latest = await settings();
      await save({
        queue: latest.queue.filter((q) => q.hash !== item.hash),
        sent: [...latest.sent, item.hash].slice(-200),
        lastSent: Object.fromEntries(Object.entries({ ...latest.lastSent, [destinationKey(item.endpoint, item.project, item.conversation.metadata.url)]: item.hash }).slice(-200)),
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
  // Status queries are read-only — handle immediately outside the serial queue
  // to avoid hanging if the queue is blocked or the SW just woke up.
  if (message.type === "status") {
    settings().then((config) => {
      const hasToken = Boolean(config.token && config.token.startsWith("ctm_"));
      const hasEndpoint = Boolean(config.endpoint);
      // Warn if token hasn't been refreshed in 30 days
      const tokenAge = config.tokenSavedAt
        ? (Date.now() - new Date(config.tokenSavedAt).getTime()) / (1000 * 60 * 60 * 24)
        : 0;
      const tokenStale = hasToken && tokenAge > 30;
      respond({
        active: config.consent && config[message.provider] && !config.paused,
        auto: config.auto,
        project: config.project || null,
        projectName: config.projectName || null,
        connected: hasToken && hasEndpoint,
        tokenStale,
      });
    }).catch(() => {
      respond({ connected: false, active: false, auto: false, project: null, projectName: null, tokenStale: false });
    });
    return true;
  }

  serial = serial.catch(() => {}).then(async () => {
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
        // MessageSender.url can retain the document's original address after
        // pushState navigation. Use the address read alongside the messages.
        const source = new URL(message.url ?? sender.url);
        if (source.origin !== new URL(sender.url).origin || source.protocol !== "https:" || source.username || source.password) {
          return { error: "Conversation address does not match the sending site." };
        }
        if (!chatPath(provider, source.href)) {
          return { status: "Waiting for this chat to get its own address.", pending: true };
        }
        // Respect "Capture files and images": strip references before they are
        // normalized, queued or hashed, so nothing about the files is uploaded.
        const messages = config.captureFiles === false ? withoutAttachments(message.messages) : message.messages;
        conversation = normalizedConversation(provider, messages, message.title, source.href, {
          providerProject: typeof message.providerProject === "string" ? message.providerProject : "",
        });
      } catch (err) {
        return { error: `Content error: ${err.message}` };
      }

      const destination = destinationKey(config.endpoint, config.project, conversation.metadata.url);
      const hash = await contentHash({ ...conversation, destination });

      // Duplicate check — already sent
      if (config.lastSent[destination] === hash) {
        return { status: "Already captured. No duplicate created." };
      }

      // Duplicate check — already queued
      if (!config.queue.some((q) => q.hash === hash)) {
        // A newer snapshot of the same chat supersedes any older queued one.
        const queue = config.queue.filter((q) => destinationKey(q.endpoint, q.project, q.conversation?.metadata?.url) !== destination);
        if (queue.length >= 20) {
          return { error: "Queue full. Check network and retry later." };
        }
        await save({
          queue: [
            ...queue,
            {
              hash,
              provider,
              conversation,
              endpoint: config.endpoint,
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
      if (after.lastSent[destination] === hash) {
        const projectName = config.projectName ? ` → ${config.projectName}` : "";
        return { status: `Saved to Continuum${projectName}.` };
      }

      const queued = after.queue.find((q) => q.hash === hash);
      if (queued && queued.attempts > 0) {
        const last = after.history[0]?.status || "Upload failed.";
        return { error: queued.attempts >= 5 ? `${last} Open settings to retry.` : `${last} Will retry automatically.` };
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

// Storage access level. TRUSTED_CONTEXTS would block the restarted MV3 service
// worker from reading storage, so keep Chrome's default. Chrome accepts only
// TRUSTED_CONTEXTS or TRUSTED_AND_UNTRUSTED_CONTEXTS (not "DEFAULT"); an invalid
// value throws synchronously and used to stop the service worker registering.
// Firefox has no setAccessLevel. This must never be allowed to throw.
async function resetStorageAccess() {
  try {
    await api.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" });
  } catch {
    /* unsupported or rejected: the default access level already applies */
  }
}
api.runtime.onInstalled.addListener(resetStorageAccess);
api.runtime.onInstalled.addListener(() => restoreChatTabs().catch(error =>
  console.warn("[Continuum] Could not reconnect open chat tabs:", error.message)));
// Also on every service worker startup, to repair installs that set TRUSTED_CONTEXTS.
void resetStorageAccess();
