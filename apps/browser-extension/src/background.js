import { api, settings, save } from "./lib/storage.js";
import { upload } from "./lib/api.js";
import { normalizedConversation, contentHash } from "./lib/normalizer.js";
let serial = Promise.resolve();
async function record(status) {
  const config = await settings();
  await save({ history: [{ at: new Date().toISOString(), status }, ...config.history].slice(0, 30) });
}
async function flush() {
  const config = await settings();
  if (!config.consent || config.paused || !config.token) return;
  for (const item of config.queue) {
    const current = await settings();
    if (!current.consent || current.paused || !current[item.provider] || current.token !== config.token) return;
    if (item.attempts >= 5) continue;
    if (!config[item.provider]) continue;
    if (item.next > Date.now()) continue;
    // Queued snapshots are bound to the scope and endpoint authorized at capture time.
    if (item.endpoint !== config.endpoint || item.project !== config.project) continue;
    try {
      await upload(config, item.conversation);
      const latest = await settings();
      await save({ queue: latest.queue.filter((q) => q.hash !== item.hash), sent: [...latest.sent, item.hash].slice(-200) });
      await record("Conversation imported; review proposed memories in Continuum");
    } catch {
      const latest = await settings();
      await save({ queue: latest.queue.map((q) => q.hash === item.hash ? { ...q, attempts: q.attempts + 1, next: Date.now() + Math.min(3600000, 10000 * 2 ** q.attempts) } : q) });
      await record("Capture failed; queued locally for retry. Check credential and service.");
    }
  }
}
api.runtime.onMessage.addListener((message, sender, respond) => {
  serial = serial.catch(() => {}).then(async () => {
    if (message.type === "status") {
      const config = await settings();
      // Never return tokens, queued bodies or history to provider content scripts.
      return { active: config.consent && config[message.provider] && !config.paused, auto: config.auto };
    }
    if (message.type !== "capture" || !sender.tab || !sender.url) return {};
    const config = await settings();
    const provider = new URL(sender.url).hostname === "chatgpt.com" ? "chatgpt" : new URL(sender.url).hostname === "claude.ai" ? "claude" : null;
    if (!provider || !config.consent || !config[provider] || config.paused || (message.automatic && !config.auto)) throw new Error("Capture not authorized");
    const conversation = normalizedConversation(provider, message.messages, message.title, sender.url);
    const hash = await contentHash(conversation);
    if (!config.sent.includes(hash) && !config.queue.some((q) => q.hash === hash)) {
      if (config.queue.length >= 20) throw new Error("Local retry queue full");
      await save({ queue: [...config.queue, { hash, provider, conversation, endpoint: config.endpoint, project: config.project, attempts: 0, next: 0 }] });
    }
    await flush();
    return { status: "Capture requested. Check extension history for confirmation." };
  });
  serial.then(respond, () => respond({ error: "Capture unavailable or not authorized. Check extension settings." }));
  return true;
});
api.alarms.create("retry", { periodInMinutes: 1 });
api.alarms.onAlarm.addListener(() => { serial = serial.catch(() => {}).then(flush); });
api.runtime.onInstalled.addListener(async () => {
  // Prevent provider-page scripts from reading extension-local tokens in Chromium.
  await api.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" });
});
