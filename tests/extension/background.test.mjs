/**
 * background.test.mjs
 * Extended service worker tests covering gaps not in capture.test.mjs.
 *
 * Uses the same single-import pattern as capture.test.mjs — the module
 * is imported once; all tests mutate the shared `state` object to control
 * test conditions. This matches how Chrome actually runs the service worker.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

// ── Shared mock infrastructure ────────────────────────────────────────────────

let listener;
let state = {};
const requests = [];
let fetchShouldFail = false;
let fetchResponse = { id: "conv-ok", duplicate: false, proposals: 0 };

globalThis.chrome = {
  storage: {
    local: {
      get: async () => ({ ...state }),
      set: async (v) => { state = { ...state, ...structuredClone(v) }; },
      setAccessLevel: async () => {},
    },
  },
  runtime: {
    onMessage: { addListener: (cb) => { listener = cb; } },
    onInstalled: { addListener: () => {} },
  },
  alarms: { create: () => {}, onAlarm: { addListener: () => {} } },
};

globalThis.fetch = async (url, options) => {
  if (fetchShouldFail) throw new Error("network error");
  requests.push({ url: String(url), body: JSON.parse(options?.body || "{}") });
  return new Response(JSON.stringify(fetchResponse));
};

// Import once — registers the listener on globalThis.chrome above
await import("../../apps/browser-extension/src/background.js");

// ── Helpers ───────────────────────────────────────────────────────────────────

const chatgptSender = { tab: { id: 1 }, url: "https://chatgpt.com/c/abc" };
const claudeSender  = { tab: { id: 2 }, url: "https://claude.ai/chat/xyz" };

function baseState(overrides = {}) {
  return {
    consent: true,
    chatgpt: true,
    claude: true,
    paused: false,
    auto: true,
    token: "ctm_" + "a".repeat(64),
    endpoint: "http://127.0.0.1:3101",
    project: "",
    projectName: "",
    queue: [],
    history: [],
    sent: [],
    ...overrides,
  };
}

function send(msg, sender = chatgptSender) {
  return new Promise((resolve) => listener(msg, sender, resolve));
}

function capture(contentSuffix = "default", overrides = {}) {
  return {
    type: "capture",
    title: "Test",
    messages: [{ role: "user", content: `Unique content ${contentSuffix} ${Math.random()}` }],
    automatic: false,
    ...overrides,
  };
}

function resetRequests() { requests.length = 0; }

// ── Tests ─────────────────────────────────────────────────────────────────────

test("status: returns connected=false when no token set", async () => {
  state = baseState({ token: "" });
  const status = await send({ type: "status", provider: "chatgpt" });
  assert.equal(status.connected, false);
  assert.equal(typeof status.active, "boolean");
  assert.equal(typeof status.auto, "boolean");
});

test("status: returns connected=false when token doesn't start with ctm_", async () => {
  state = baseState({ token: "invalid_token_format" });
  const status = await send({ type: "status", provider: "chatgpt" });
  assert.equal(status.connected, false);
});

test("status: returns connected=true with valid ctm_ token and endpoint", async () => {
  state = baseState();
  const status = await send({ type: "status", provider: "chatgpt" });
  assert.equal(status.connected, true);
});

test("status: active=false when consent is false", async () => {
  state = baseState({ consent: false });
  const status = await send({ type: "status", provider: "chatgpt" });
  assert.equal(status.active, false);
});

test("status: active=false when provider is disabled", async () => {
  state = baseState({ chatgpt: false });
  const status = await send({ type: "status", provider: "chatgpt" });
  assert.equal(status.active, false);
});

test("status: active=false when paused", async () => {
  state = baseState({ paused: true });
  const status = await send({ type: "status", provider: "chatgpt" });
  assert.equal(status.active, false);
});

test("status: returns project and projectName from storage", async () => {
  state = baseState({ project: "proj-uuid", projectName: "My Project" });
  const status = await send({ type: "status", provider: "chatgpt" });
  assert.equal(status.project, "proj-uuid");
  assert.equal(status.projectName, "My Project");
});

test("set_project: persists project selection", async () => {
  state = baseState();
  const result = await send({ type: "set_project", project: "uuid-1", projectName: "Atlas" });
  assert.ok(result.ok);
  assert.equal(state.project, "uuid-1");
  assert.equal(state.projectName, "Atlas");
});

test("set_project: clears project when empty string sent", async () => {
  state = baseState({ project: "old-proj", projectName: "Old" });
  await send({ type: "set_project", project: "", projectName: "" });
  assert.equal(state.project, "");
  assert.equal(state.projectName, "");
});

test("endpoint mismatch: queued item from old endpoint is skipped", async () => {
  resetRequests();
  fetchShouldFail = false;
  state = baseState({
    endpoint: "http://127.0.0.1:3101",
    queue: [{
      hash: "oldhash",
      provider: "chatgpt",
      conversation: { title: "Old", platform: "chatgpt", messages: [{ role: "user", content: "Old content" }] },
      endpoint: "http://127.0.0.1:9999", // different from current
      project: null,
      projectName: null,
      attempts: 0,
      next: 0,
    }],
  });
  await send({ type: "flush" });
  assert.equal(requests.length, 0, "Should not upload item from different endpoint");
  assert.equal(state.queue.length, 1, "Item should remain in queue");
});

test("attempts cap: item with attempts>=5 is never uploaded", async () => {
  resetRequests();
  state = baseState({
    queue: [{
      hash: "maxattempts",
      provider: "chatgpt",
      conversation: { title: "Max", platform: "chatgpt", messages: [{ role: "user", content: "Max attempts" }] },
      endpoint: "http://127.0.0.1:3101",
      project: null,
      projectName: null,
      attempts: 5,
      next: 0,
    }],
  });
  await send({ type: "flush" });
  assert.equal(requests.length, 0, "Should not upload item with 5+ attempts");
});

test("next throttle: item with future next time is skipped", async () => {
  resetRequests();
  state = baseState({
    queue: [{
      hash: "throttled",
      provider: "chatgpt",
      conversation: { title: "T", platform: "chatgpt", messages: [{ role: "user", content: "Throttled" }] },
      endpoint: "http://127.0.0.1:3101",
      project: null,
      projectName: null,
      attempts: 1,
      next: Date.now() + 3_600_000,
    }],
  });
  await send({ type: "flush" });
  assert.equal(requests.length, 0, "Should not upload throttled item");
});

test("queue capacity: rejects capture when queue has 20 items", async () => {
  resetRequests();
  fetchShouldFail = true;
  state = baseState({
    queue: Array.from({ length: 20 }, (_, i) => ({
      hash: `hash${i}`,
      provider: "chatgpt",
      conversation: { title: `c${i}`, platform: "chatgpt", messages: [{ role: "user", content: `msg${i}` }] },
      endpoint: "http://127.0.0.1:3101",
      project: null,
      projectName: null,
      attempts: 5,
      next: Date.now() + 999999,
    })),
  });
  const result = await send(capture("queue-full-test"));
  assert.ok(result.error, `Expected error, got: ${JSON.stringify(result)}`);
  assert.match(result.error, /queue full/i);
  fetchShouldFail = false;
});

test("claude provider: routes correctly from claude.ai sender", async () => {
  resetRequests();
  fetchShouldFail = false;
  fetchResponse = { id: "conv-claude", duplicate: false, proposals: 0 };
  state = baseState({ claude: true, chatgpt: false });
  const result = await send(capture("claude-unique"), claudeSender);
  assert.ok(result.status, `Expected status, got: ${JSON.stringify(result)}`);
  assert.ok(requests.length > 0, "Should have made a request");
  assert.equal(requests[requests.length - 1].body.conversation.platform, "claude");
});

test("history is capped at 50 entries after repeated captures", async () => {
  resetRequests();
  fetchShouldFail = false;
  fetchResponse = { id: "conv-hist", duplicate: false, proposals: 0 };
  state = baseState({
    history: Array.from({ length: 49 }, (_, i) => ({ at: new Date().toISOString(), status: `old-${i}` })),
  });
  // Two more captures — history should not exceed 50
  await send(capture("history-cap-1"));
  await send(capture("history-cap-2"));
  assert.ok(state.history.length <= 50, `History should be ≤ 50, got ${state.history.length}`);
});

test("token is never stored in history entries", async () => {
  resetRequests();
  fetchShouldFail = false;
  fetchResponse = { id: "conv-tok", duplicate: false, proposals: 0 };
  state = baseState();
  await send(capture("token-leak-test"));
  assert.ok(
    !JSON.stringify(state.history).includes("ctm_"),
    "Token must never appear in history",
  );
});

test("unknown message type returns a response without crashing", async () => {
  state = baseState();
  const result = await send({ type: "completely_unknown_xyz" });
  // Must not throw — returns empty object or error
  assert.notEqual(result, undefined);
});

test("project_id and endpoint are stored in queued items (not Supabase keys)", async () => {
  resetRequests();
  fetchShouldFail = true; // force queue
  state = baseState({ project: "proj-abc", projectName: "TestProj" });
  await send(capture("queue-storage-check"));
  fetchShouldFail = false;
  assert.ok(state.queue.length > 0, "Item should be queued");
  const item = state.queue[state.queue.length - 1];
  assert.equal(item.project, "proj-abc");
  assert.equal(item.endpoint, "http://127.0.0.1:3101");
  assert.ok(!JSON.stringify(item).includes("SUPABASE"), "Supabase keys must not be in queue");
});
