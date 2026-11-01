(() => {
  const api = globalThis.browser || globalThis.chrome;
  const provider = location.hostname === "chatgpt.com" ? "chatgpt" : "claude";
  const visible = (node) => Boolean(node.getClientRects().length) && getComputedStyle(node).visibility !== "hidden";
  function read() {
    if (provider === "chatgpt") return [...document.querySelectorAll("[data-message-author-role]")].filter(visible).map((node) => ({ role: node.getAttribute("data-message-author-role"), content: node.innerText }));
    return [...document.querySelectorAll('[data-testid="user-message"], [data-is-streaming] .font-claude-response, .font-claude-response')].filter(visible).filter((node, index, nodes) => !nodes.some((other) => other !== node && other.contains(node))).map((node) => ({ role: node.getAttribute("data-testid") === "user-message" ? "user" : "assistant", content: node.innerText }));
  }
  let last = "", timer;
  const badge = document.createElement("button");
  badge.textContent = "Continuum: paused";
  badge.style.cssText = "position:fixed;bottom:18px;right:18px;z-index:2147483647;background:#18243a;color:#fff;padding:10px;border:1px solid #89909d;border-radius:3px;font:12px sans-serif";
  document.documentElement.append(badge);
  async function sync(automatic) {
    const status = await api.runtime.sendMessage({ type: "status", provider });
    if (!status.active || (automatic && !status.auto)) return;
    const messages = read();
    const key = JSON.stringify(messages);
    if (automatic && key === last) return;
    const response = await api.runtime.sendMessage({ type: "capture", messages, title: document.title, automatic });
    if (!response.error) last = key;
    badge.textContent = response.error || "Continuum: capture requested";
  }
  badge.onclick = () => sync(false);
  setInterval(async () => {
    const status = await api.runtime.sendMessage({ type: "status", provider });
    badge.textContent = status.active ? `Continuum: ${status.auto ? "auto enabled" : "manual sync"}` : "Continuum: paused";
  }, 10000);
  new MutationObserver((changes) => {
    if (changes.every((change) => badge.contains(change.target))) return;
    clearTimeout(timer); timer = setTimeout(() => sync(true), 5000);
  }).observe(document.body, { subtree: true, childList: true, characterData: true });
})();
