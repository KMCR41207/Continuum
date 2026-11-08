(() => {
  const api = globalThis.browser || globalThis.chrome;
  const hostname = location.hostname;
  const provider = hostname === "chatgpt.com" ? "chatgpt" : hostname === "claude.ai" ? "claude" : null;
  if (!provider) return;

  // ── Provider-specific message extractors ────────────────────────────────
  const visible = (node) =>
    Boolean(node.getClientRects().length) &&
    getComputedStyle(node).visibility !== "hidden";

  function readChatGPT() {
    // Primary: data-message-author-role attribute (stable across ChatGPT versions)
    const nodes = [...document.querySelectorAll("[data-message-author-role]")].filter(visible);
    if (nodes.length === 0) return null; // DOM not ready
    return nodes.map((node) => ({
      role: node.getAttribute("data-message-author-role"),
      content: node.innerText.trim(),
    })).filter((m) => ["user", "assistant"].includes(m.role) && m.content.length > 0);
  }

  function readClaude() {
    // User messages
    const userNodes = [...document.querySelectorAll('[data-testid="user-message"]')].filter(visible);
    // Assistant messages — avoid nested duplicates
    const assistantNodes = [...document.querySelectorAll('.font-claude-response')].filter(visible).filter(
      (node, _i, all) => !all.some((other) => other !== node && other.contains(node))
    );

    if (userNodes.length === 0 && assistantNodes.length === 0) return null;

    // Interleave by DOM position
    const all = [
      ...userNodes.map((n) => ({ role: "user", content: n.innerText.trim(), node: n })),
      ...assistantNodes.map((n) => ({ role: "assistant", content: n.innerText.trim(), node: n })),
    ].filter((m) => m.content.length > 0);

    all.sort((a, b) => {
      const pos = a.node.compareDocumentPosition(b.node);
      return pos & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });

    return all.map(({ role, content }) => ({ role, content }));
  }

  function readMessages() {
    try {
      return provider === "chatgpt" ? readChatGPT() : readClaude();
    } catch (err) {
      console.warn("[Continuum] Read error:", err);
      return null;
    }
  }

  // ── Streaming detection ──────────────────────────────────────────────────
  function isStreaming() {
    if (provider === "chatgpt") {
      // ChatGPT shows a stop button while streaming
      return Boolean(document.querySelector('[data-testid="stop-button"]'));
    }
    if (provider === "claude") {
      // Claude shows data-is-streaming attribute
      return Boolean(document.querySelector('[data-is-streaming="true"]'));
    }
    return false;
  }

  // ── Badge ────────────────────────────────────────────────────────────────
  const badge = document.createElement("button");
  badge.style.cssText = [
    "position:fixed", "bottom:18px", "right:18px", "z-index:2147483647",
    "background:#18243a", "color:#fff", "padding:8px 12px",
    "border:1px solid #89909d", "border-radius:4px",
    "font:12px/1.4 sans-serif", "cursor:pointer", "max-width:280px",
    "text-align:left", "white-space:nowrap", "overflow:hidden",
    "text-overflow:ellipsis",
  ].join(";");
  badge.setAttribute("aria-label", "Continuum capture status");
  document.documentElement.append(badge);

  function setBadge(text, color) {
    badge.textContent = text;
    badge.style.background = color || "#18243a";
  }
  setBadge("Continuum: loading…");

  // ── State ────────────────────────────────────────────────────────────────
  let lastHash = "";
  let captureTimer = null;
  let statusTimer = null;
  let currentUrl = location.href;

  // ── Core sync function ───────────────────────────────────────────────────
  async function sync(automatic) {
    try {
      const status = await api.runtime.sendMessage({ type: "status", provider });

      if (!status.connected) {
        setBadge("Continuum: not connected", "#8b1a1a");
        return;
      }
      if (!status.active) {
        setBadge("Continuum: capture off");
        return;
      }
      if (automatic && !status.auto) return;

      // Don't capture while streaming
      if (isStreaming()) {
        setBadge("Continuum: waiting for response…", "#1a3a5c");
        if (automatic) {
          clearTimeout(captureTimer);
          captureTimer = setTimeout(() => sync(true), 3000);
        }
        return;
      }

      const messages = readMessages();
      if (!messages) {
        if (!automatic) setBadge("Continuum: no messages found", "#5a3a1a");
        return;
      }
      if (messages.length === 0) {
        if (!automatic) setBadge("Continuum: conversation is empty");
        return;
      }

      // Deduplicate by content hash
      const key = JSON.stringify(messages);
      if (automatic && key === lastHash) return;

      setBadge("Continuum: capturing…", "#1a3a5c");

      const response = await api.runtime.sendMessage({
        type: "capture",
        messages,
        title: document.title,
        automatic,
      });

      if (response.error) {
        setBadge(`Continuum: ${response.error}`, "#8b1a1a");
      } else {
        lastHash = key;
        const projectPart = status.projectName ? ` → ${status.projectName}` : "";
        setBadge(response.status || `Continuum: saved${projectPart}`, "#1a4a1a");
      }
    } catch (err) {
      if (!automatic) setBadge(`Continuum: error — ${err.message}`, "#8b1a1a");
    }
  }

  // ── Badge click = manual capture ─────────────────────────────────────────
  badge.addEventListener("click", () => {
    clearTimeout(captureTimer);
    sync(false);
  });

  // ── Periodic status update ───────────────────────────────────────────────
  async function updateStatus() {
    try {
      const status = await api.runtime.sendMessage({ type: "status", provider });
      if (!status.connected) {
        setBadge("Continuum: not connected — check settings", "#8b1a1a");
      } else if (!status.active) {
        setBadge("Continuum: capture off");
      } else {
        const projectPart = status.projectName ? ` (${status.projectName})` : "";
        setBadge(`Continuum: ${status.auto ? "auto" : "manual"}${projectPart}`, "#18243a");
      }
    } catch {
      setBadge("Continuum: extension error", "#8b1a1a");
    }
  }

  // Update status every 8 seconds
  statusTimer = setInterval(updateStatus, 8000);
  updateStatus();

  // ── URL change detection (conversation switching) ────────────────────────
  function onUrlChange() {
    if (location.href !== currentUrl) {
      currentUrl = location.href;
      lastHash = ""; // Reset hash so new conversation gets captured
      clearTimeout(captureTimer);
      // Wait for new conversation DOM to settle
      captureTimer = setTimeout(() => sync(true), 4000);
    }
  }

  // ── DOM mutation observer ─────────────────────────────────────────────────
  const observer = new MutationObserver((changes) => {
    // Ignore mutations caused by our own badge
    if (changes.every((c) => badge.contains(c.target))) return;

    onUrlChange();

    clearTimeout(captureTimer);
    // Wait 5 seconds after last DOM change before capturing
    // This handles streaming: DOM keeps changing until response completes
    captureTimer = setTimeout(() => sync(true), 5000);
  });

  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
  });

  // ── Listen for manual capture from popup ─────────────────────────────────
  api.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message.type === "manual_capture") {
      clearTimeout(captureTimer);
      sync(false).then(() => respond({ ok: true })).catch((err) => respond({ error: err.message }));
      return true;
    }
  });
})();
