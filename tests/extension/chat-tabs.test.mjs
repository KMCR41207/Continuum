import assert from "node:assert/strict";
import { test } from "node:test";

const injections = [];
const sends = [];
globalThis.chrome = {
  tabs: {
    async query(filter) {
      assert.deepEqual(filter.url, ["https://chatgpt.com/*", "https://claude.ai/*"]);
      return [{ id: 1 }, { id: 2, discarded: true }, { id: 3 }];
    },
    async sendMessage(id, message, options) {
      sends.push({ id, message, options });
      if (id === 7) throw new Error("Upload failed");
      if (!injections.includes(id)) throw new Error("Could not establish connection. Receiving end does not exist.");
      return { status: "Saved" };
    },
  },
  scripting: { async executeScript({ target, files }) {
    assert.deepEqual(files, ["content/capture.js"]);
    injections.push(target.tabId);
    if (target.tabId === 3) throw new Error("Tab closed");
  } },
};
const { restoreChatTabs, sendToChat } = await import("../../apps/browser-extension/src/lib/chat-tabs.js");

test("extension updates reconnect open chats even if a tab closed during recovery", async () => {
  await restoreChatTabs();
  assert.deepEqual(injections, [1, 3]);
});

test("a missing receiver is reattached and the original popup action runs once", async () => {
  const request = { type: "manual_capture" };
  assert.deepEqual(await sendToChat(6, request), { status: "Saved" });
  assert.deepEqual(sends.filter(call => call.id === 6), Array(2).fill({ id: 6, message: request, options: { frameId: 0 } }));
  await assert.rejects(sendToChat(7, request), /Upload failed/);
  assert.ok(!injections.includes(7));
});
