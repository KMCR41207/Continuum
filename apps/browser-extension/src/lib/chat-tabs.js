import { api } from "./storage.js";

const chatPages = ["https://chatgpt.com/*", "https://claude.ai/*"];
const missingReceiver = /receiving end does not exist|could not establish connection/i;

async function attach(tabId) {
  await api.scripting.executeScript({
    target: { tabId },
    files: ["content/capture.js"],
  });
}

export async function restoreChatTabs() {
  const tabs = await api.tabs.query({ url: chatPages });
  // A tab can close or navigate between the query and injection.
  await Promise.allSettled(tabs.filter(tab => tab.id != null && !tab.discarded).map(tab => attach(tab.id)));
}

export async function sendToChat(tabId, message) {
  try {
    return await api.tabs.sendMessage(tabId, message, { frameId: 0 });
  } catch (error) {
    if (!missingReceiver.test(error.message)) throw error;
    await attach(tabId);
    return api.tabs.sendMessage(tabId, message, { frameId: 0 });
  }
}
