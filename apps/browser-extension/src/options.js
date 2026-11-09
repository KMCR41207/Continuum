import { api, settings, save } from "./lib/storage.js";
import { testConnection, fetchProjects } from "./lib/api.js";

const form = document.querySelector("#settings");
const statusEl = document.querySelector("#status");
const historyEl = document.querySelector("#history");
const projectSelect = document.querySelector("#project-select");

function setStatus(text, type) {
  statusEl.textContent = text;
  statusEl.className = type || "";
}

// ── Load saved settings ───────────────────────────────────────────────────────
const config = await settings();

form.elements["endpoint"].value = config.endpoint || "http://127.0.0.1:3101";
form.elements["token"].value = config.token || "";

for (const name of ["consent", "chatgpt", "claude", "auto", "paused"]) {
  if (form.elements[name]) form.elements[name].checked = Boolean(config[name]);
}

historyEl.textContent = config.history.length > 0
  ? config.history.map((item) => `${item.at}\n  ${item.status}`).join("\n\n")
  : "No history yet.";

// ── Load projects ─────────────────────────────────────────────────────────────
async function loadProjects(cfg) {
  while (projectSelect.options.length > 1) projectSelect.remove(1);
  if (!cfg.token || !cfg.endpoint) return;
  try {
    const projects = await fetchProjects(cfg);
    projects.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      if (p.id === cfg.project) opt.selected = true;
      projectSelect.appendChild(opt);
    });
    if (!cfg.project) projectSelect.value = "";
  } catch { /* non-fatal */ }
}
await loadProjects(config);

// ── Save form ─────────────────────────────────────────────────────────────────
async function saveForm() {
  const data = {
    endpoint: (form.elements["endpoint"].value || "").trim(),
    token: (form.elements["token"].value || "").trim(),
  };
  for (const name of ["consent", "chatgpt", "claude", "auto", "paused"]) {
    data[name] = form.elements[name]?.checked ?? false;
  }
  const selectedOpt = projectSelect.options[projectSelect.selectedIndex];
  data.project = projectSelect.value || "";
  data.projectName = data.project ? (selectedOpt?.textContent || "") : "";

  if (data.endpoint) {
    try {
      const u = new URL(data.endpoint);
      if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Invalid protocol");
      await api.permissions.request({ origins: [u.origin + "/*"] });
    } catch (err) {
      setStatus(`Invalid endpoint: ${err.message}`, "err");
      return false;
    }
  }

  await save(data);
  setStatus("Saved.", "ok");
  await loadProjects(data);
  return true;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  setStatus("Saving…");
  await saveForm();
});

// Auto-save checkboxes
for (const name of ["consent", "chatgpt", "claude", "auto", "paused"]) {
  form.elements[name]?.addEventListener("change", () => saveForm());
}

// Auto-save token (debounced)
let tokenTimer;
form.elements["token"]?.addEventListener("input", () => {
  clearTimeout(tokenTimer);
  tokenTimer = setTimeout(() => {
    if (form.elements["token"].value.length > 10) saveForm();
  }, 800);
});

// Project change
projectSelect.addEventListener("change", async () => {
  await saveForm();
  const name = projectSelect.options[projectSelect.selectedIndex]?.textContent || "";
  setStatus(projectSelect.value ? `Project: ${name}` : "Project: global", "ok");
});

// ── Test connection ───────────────────────────────────────────────────────────
document.querySelector("#test-btn").addEventListener("click", async () => {
  setStatus("Testing…");
  try {
    await saveForm();
    const cfg = await settings();
    const result = await testConnection(cfg);
    const perms = ["capture", "retrieval", "writing"].filter((k) => result[k]);
    setStatus(`✓ Connected. Permissions: ${perms.join(", ") || "none"}`, "ok");
    await loadProjects(cfg);
  } catch (err) {
    setStatus(`✗ ${err.message}`, "err");
  }
});

// ── Retry ─────────────────────────────────────────────────────────────────────
document.querySelector("#retry").addEventListener("click", async () => {
  const current = await settings();
  await save({ queue: current.queue.map((item) => ({ ...item, attempts: 0, next: 0 })) });
  await api.runtime.sendMessage({ type: "flush" });
  setStatus("Retry requested.", "ok");
});

// ── Clear ─────────────────────────────────────────────────────────────────────
document.querySelector("#clear").addEventListener("click", async () => {
  await save({ queue: [], history: [], sent: [] });
  historyEl.textContent = "No history yet.";
  setStatus("Cleared.", "ok");
});
