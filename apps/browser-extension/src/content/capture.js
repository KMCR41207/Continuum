(() => {
  const api = globalThis.browser || globalThis.chrome;
  const hostname = location.hostname;
  const provider = hostname === "chatgpt.com" ? "chatgpt" : hostname === "claude.ai" ? "claude" : null;
  if (!provider) return;

  // Wrapper: sendMessage with a timeout so the badge never hangs on "loading…"
  function sendMessage(msg, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      try {
        api.runtime.sendMessage(msg, (response) => {
          clearTimeout(timer);
          if (api.runtime.lastError) {
            reject(new Error(api.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      } catch (err) {
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  // ── Provider-specific message extractors ────────────────────────────────
  const visible = (node) =>
    Boolean(node.getClientRects().length) &&
    getComputedStyle(node).visibility !== "hidden";

  // ── Attachments (references only; file bytes are never read) ─────────────
  // data: and blob: URLs are page-local and can be megabytes, so only http(s)
  // URLs are kept; the file name is still recorded.
  const MAX_ATTACHMENTS = 20;
  const safeUrl = (value) => (/^https?:\/\//i.test(value || "") ? String(value).slice(0, 2048) : "");
  const fileName = (value) => {
    try { return decodeURIComponent(new URL(value).pathname.split("/").pop() || ""); } catch { return ""; }
  };
  const FILE_PATTERN = /\.(pdf|docx?|xlsx?|pptx?|csv|txt|md|json|zip|py|js|ts|tsx|html|css|png|jpe?g|gif|webp|svg)(\?|#|$)/i;

  function collectAttachments(root) {
    const found = [];
    const seen = new Set();
    const push = (type, url, name) => {
      const item = { type, url: safeUrl(url), name: String(name || "").trim().slice(0, 200) || (type === "image" ? "image" : "file") };
      const key = `${item.type}|${item.url}|${item.name}`;
      if (seen.has(key) || found.length >= MAX_ATTACHMENTS) return;
      seen.add(key);
      found.push(item);
    };
    for (const img of root.querySelectorAll("img")) {
      const src = img.currentSrc || img.src || "";
      // Skip avatars and inline icons.
      if (!src || (img.naturalWidth && img.naturalWidth < 32 && img.naturalHeight < 32)) continue;
      if (/avatar|profile/i.test(img.alt || "") || img.closest('[class*="avatar" i]')) continue;
      push("image", src, (img.alt || "").trim() || fileName(src));
    }
    for (const link of root.querySelectorAll("a[href]")) {
      const download = link.getAttribute("download");
      if (download === null && !FILE_PATTERN.test(link.href)) continue;
      push("file", link.href, download || link.textContent || fileName(link.href));
    }
    // Uploaded-file tiles often have no link; keep the visible file name.
    for (const tile of root.querySelectorAll('[data-testid*="file" i], [data-testid*="attachment" i]')) {
      if (tile.querySelector("a[href], img")) continue;
      const name = (tile.getAttribute("title") || tile.getAttribute("aria-label") || tile.innerText || "").trim().split("\n")[0];
      if (name) push("file", "", name);
    }
    return found;
  }

  function readChatGPT() {
    // Primary: data-message-author-role attribute (stable across ChatGPT versions)
    const nodes = [...document.querySelectorAll("[data-message-author-role]")].filter(visible);
    // Some ChatGPT layouts expose roles on the turn instead of the message.
    if (nodes.length === 0) {
      // Newer ChatGPT layouts mark user bubbles and rendered responses directly.
      // Read in document order and avoid capturing nested renderer duplicates.
      const rendered = [...document.querySelectorAll('[data-user-message-bubble], [data-dil-response]')]
        .filter(visible)
        .filter((node, _i, all) => !all.some((other) => other !== node && other.contains(node)));
      if (rendered.length) {
        return rendered.map((node) => ({
          role: node.hasAttribute("data-user-message-bubble") ? "user" : "assistant",
          content: node.innerText.trim(),
          attachments: collectAttachments(node),
        })).filter((m) => m.content.length > 0 || m.attachments.length > 0);
      }
      const turns = [...document.querySelectorAll('main [data-testid^="conversation-turn"], main article[data-turn]')].filter(visible);
      const fallback = turns.map((turn) => {
        const role = turn.getAttribute("data-turn") || turn.getAttribute("data-message-author-role") ||
          (turn.querySelector('[data-testid="user-message"]') ? "user" :
           turn.querySelector('[data-testid="assistant-message"], .markdown') ? "assistant" : "");
        const body = turn.querySelector('[data-testid="user-message"], [data-testid="assistant-message"], .markdown') || turn;
        return { role, content: body.innerText.trim(), attachments: collectAttachments(turn) };
      }).filter((m) => ["user", "assistant"].includes(m.role) && (m.content || m.attachments.length));
      return fallback.length ? fallback : null;
    }
    return nodes.map((node) => ({
      role: node.getAttribute("data-message-author-role"),
      content: node.innerText.trim(),
      // Uploads render next to the text inside the same conversation turn.
      attachments: collectAttachments(node.closest('[data-testid^="conversation-turn"], article') || node),
    })).filter((m) => ["user", "assistant"].includes(m.role) && (m.content.length > 0 || m.attachments.length > 0));
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
      // Claude renders uploads just above the bubble, inside the same message group.
      ...userNodes.map((n) => ({ role: "user", content: n.innerText.trim(), attachments: collectAttachments(n.closest("[data-test-render-count]") || n), node: n })),
      ...assistantNodes.map((n) => ({ role: "assistant", content: n.innerText.trim(), attachments: [], node: n })),
    ].filter((m) => m.content.length > 0 || m.attachments.length > 0);

    all.sort((a, b) => {
      const pos = a.node.compareDocumentPosition(b.node);
      return pos & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });

    return all.map(({ role, content, attachments }) => ({ role, content, attachments }));
  }

  // A chat is only captured once it has its own address (ChatGPT /c/<id>,
  // Claude /chat/<id>); Continuum keeps one conversation per address.
  function hasChatId() {
    const path = location.pathname.replace(/\/+$/, "");
    return provider === "chatgpt" ? /(^|\/)c\/[\w-]+$/.test(path) : /^\/chat\/[\w-]+$/.test(path);
  }

  // Claude shows the project of a project chat as a link to /project/<uuid>.
  // (ChatGPT's project is read from the URL by the background worker.)
  function providerProject() {
    if (provider !== "claude") return "";
    const link = [...document.querySelectorAll('a[href^="/project/"]')]
      .filter((a) => /^\/project\/[0-9a-f-]{8,}$/i.test(a.getAttribute("href") || ""))
      .filter((a) => visible(a) && !a.closest("nav, aside"))[0];
    return link ? link.innerText.trim().split("\n")[0].slice(0, 100) : "";
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
      return Boolean(document.querySelector('[data-testid="stop-button"], button[aria-label^="Stop" i]'));
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
  // Append to body when available, fall back to documentElement
  (document.body || document.documentElement).append(badge);

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
      const status = await sendMessage({ type: "status", provider });

      // Service worker may return undefined if it just woke up cold
      if (!status || typeof status !== "object") {
        if (!automatic) setBadge("Continuum: not connected — check settings", "#8b1a1a");
        return;
      }

      if (!status.connected) {
        setBadge("Continuum: not connected", "#8b1a1a");
        return { error: "Not connected. Check extension settings." };
      }
      if (!status.active) {
        setBadge("Continuum: capture off");
        return { error: "Capture is disabled or paused." };
      }
      if (automatic && !status.auto) return;

      if (!hasChatId()) {
        if (!automatic) setBadge("Continuum: send a message first — this chat has no address yet", "#5a3a1a");
        return;
      }

      // Don't capture while streaming
      if (isStreaming()) {
        setBadge("Continuum: waiting for response…", "#1a3a5c");
        if (automatic) {
          clearTimeout(captureTimer);
          captureTimer = setTimeout(() => sync(true), 3000);
        }
        return { error: "Waiting for the response to finish." };
      }

      const messages = readMessages();
      if (!messages) {
        if (!automatic) setBadge("Continuum: no messages found", "#5a3a1a");
        else { clearTimeout(captureTimer); captureTimer = setTimeout(() => sync(true), 5000); }
        const counts = provider === "chatgpt"
          ? `roles ${document.querySelectorAll("[data-message-author-role]").length}, turns ${document.querySelectorAll('[data-testid^="conversation-turn"]').length}, articles ${document.querySelectorAll("main article").length}`
          : `user ${document.querySelectorAll('[data-testid="user-message"]').length}, responses ${document.querySelectorAll(".font-claude-response").length}`;
        return { error: `No messages found (${counts}). Refresh the page after reloading the extension.` };
      }
      if (messages.length === 0) {
        if (!automatic) setBadge("Continuum: conversation is empty");
        return { error: "Conversation is empty." };
      }

      // Deduplicate by content (per chat address)
      const key = JSON.stringify([location.pathname, document.title, providerProject(), status.project, messages]);
      if (automatic && key === lastHash) return;

      setBadge("Continuum: capturing…", "#1a3a5c");

      const response = await sendMessage({
        type: "capture",
        messages,
        title: document.title,
        providerProject: providerProject(),
        automatic,
      }, 40000);

      if (!response || typeof response !== "object") {
        setBadge("Continuum: no response from background", "#8b1a1a");
      } else if (response.error) {
        setBadge(`Continuum: ${response.error}`, "#8b1a1a");
      } else {
        lastHash = key;
        const projectPart = status.projectName ? ` → ${status.projectName}` : "";
        setBadge(response.status || `Continuum: saved${projectPart}`, "#1a4a1a");
      }
      return response || { error: "No response from background." };
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
      const status = await sendMessage({ type: "status", provider });
      if (!status || typeof status !== "object") {
        setBadge("Continuum: not connected — check settings", "#8b1a1a");
        return;
      }
      if (!status.connected) {
        setBadge("Continuum: not connected — check settings", "#8b1a1a");
      } else if (!status.active) {
        setBadge("Continuum: capture off");
      } else {
        const projectPart = status.projectName ? ` (${status.projectName})` : "";
        setBadge(`Continuum: ${status.auto ? "auto" : "manual"}${projectPart}`, "#18243a");
      }
    } catch {
      setBadge("Continuum: not connected — check settings", "#8b1a1a");
    }
  }

  // Update status every 8 seconds
  statusTimer = setInterval(updateStatus, 8000);
  updateStatus();
  // Capture an already-loaded conversation even without subsequent DOM changes.
  captureTimer = setTimeout(() => sync(true), 2500);

  // Re-evaluate the open chat when capture settings or its destination change.
  api.storage?.onChanged?.addListener((changes, area) => {
    if (area !== "local" || !["project", "endpoint", "token", "consent", "auto", "paused", provider, "captureFiles"].some((key) => key in changes)) return;
    lastHash = "";
    clearTimeout(captureTimer);
    captureTimer = setTimeout(() => sync(true), 2500);
  });

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

    // Re-attach badge if ChatGPT's SPA replaced the body
    if (!document.contains(badge)) {
      (document.body || document.documentElement).append(badge);
    }

    onUrlChange();

    clearTimeout(captureTimer);
    // Capture 2.5 seconds after the page stops changing (sync also waits while a reply streams).
    captureTimer = setTimeout(() => sync(true), 2500);
  });

  // Save the latest state when the tab is hidden or closed, so the last reply is never lost.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") { clearTimeout(captureTimer); sync(true); }
  });
  window.addEventListener("pagehide", () => { clearTimeout(captureTimer); sync(true); });

  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
  });

  // ── Listen for manual capture from popup ─────────────────────────────────
  api.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message.type === "identify_message") {
      setBadge("Continuum: click a message to inspect", "#1a3a5c");
      const inspect = (event) => {
        if (badge.contains(event.target)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const nodes = event.composedPath().filter((node) => node instanceof Element).slice(0, 10);
        const details = nodes.map((node) => ({
          tag: node.tagName,
          classes: typeof node.className === "string" ? node.className.slice(0, 160) : "",
          testid: node.getAttribute("data-testid"),
          turn: node.getAttribute("data-turn"),
          role: node.getAttribute("data-message-author-role"),
          attributes: [...node.attributes].map((attr) => attr.name),
        }));
        // Keep controls outside the scrollable details so they never disappear.
        document.getElementById("continuum-inspector")?.remove();
        const panel = document.createElement("div");
        panel.id = "continuum-inspector";
        panel.setAttribute("role", "dialog");
        panel.setAttribute("aria-label", "Message structure");
        panel.style.cssText = "position:fixed;inset:10% 15%;z-index:2147483647;background:#111b2c;color:white;border:1px solid #8293ad;border-radius:12px;display:flex;flex-direction:column;overflow:hidden;font:12px monospace";
        const header = document.createElement("div");
        header.style.cssText = "display:flex;align-items:center;gap:12px;padding:12px 20px;border-bottom:1px solid #8293ad";
        const close = document.createElement("button");
        close.type = "button";
        close.textContent = "Close";
        close.style.cssText = "padding:8px;cursor:pointer";
        const dismiss = () => { panel.remove(); document.removeEventListener("keydown", onKey); };
        const onKey = (event) => { if (event.key === "Escape") dismiss(); };
        close.addEventListener("click", dismiss);
        document.addEventListener("keydown", onKey);
        const pre = document.createElement("pre");
        pre.style.cssText = "margin:0;padding:20px;overflow:auto;white-space:pre-wrap;word-break:break-word";
        pre.textContent = JSON.stringify(details, null, 2);
        header.append(close, document.createTextNode("Message structure ? no message text"));
        panel.append(header, pre);
        (document.body || document.documentElement).append(panel);
        close.focus();
        setBadge("Continuum: structure ready", "#1a4a1a");
      };
      document.addEventListener("click", inspect, { capture: true, once: true });
      respond({ ok: true });
      return;
    }
    if (message.type === "manual_capture") {
      clearTimeout(captureTimer);
      sync(false).then((result) => respond(result || { error: "Capture did not complete." })).catch((err) => respond({ error: err.message }));
      return true;
    }
  });
})();
