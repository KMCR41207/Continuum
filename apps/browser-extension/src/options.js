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

// ── Load saved settings into form ────────────────────────────────────────────
const config = await settings();

const textFields = ["supabaseUrl", "supabaseKey", "token"];
for (const name of textFields) {
  if (form.elements[name]) form.elements[name].value = config[name] || "";
}

const checkboxFields = ["consent", "chatgpt", "claude", "auto", "paused"];
for (const name of checkboxFields) {
  if (form.elements[name]) form.elements[name].checked = Boolean(config[name]);
}

historyEl.textContent = config.history.length > 0
  ? config.history.map((item) => `${item.at}\n  ${item.status}`).join("\n\n")
  : "No history yet.";

// ── Load projects ─────────────────────────────────────────────────────────────
async function loadProjects(cfg) {
  // Reset to just the global option
  while (projectSelect.options.length > 1) projectSelect.remove(1);

  if (!cfg.token || !cfg.supabaseUrl) return;

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
  } catch {
    // Non-fatal
  }
}
await loadProjects(config);

// ── Save form ─────────────────────────────────────────────────────────────────
async function saveForm() {
  const data = {};

  for (const name of textFields) {
    data[name] = (form.elements[name]?.value || "").trim();
  }
  for (const name of checkboxFields) {
    data[name] = form.elements[name]?.checked ?? false;
  }

  // Save selected project and its name
  const selectedOpt = projectSelect.options[projectSelect.selectedIndex];
  data.project = projectSelect.value || "";
  data.projectName = data.project ? (selectedOpt?.textContent || "") : "";

  // Validate URL if provided
  if (data.supabaseUrl) {
    try {
      const u = new URL(data.supabaseUrl);
      if (u.protocol !== "https:") throw new Error("Supabase URL must use HTTPS");
    } catch (err) {
      setStatus(`Invalid Supabase URL: ${err.message}`, "err");
      return false;
    }
  }

  // Request host permissions for Supabase URL
  if (data.supabaseUrl) {
    try {
      const origin = new URL(data.supabaseUrl).origin + "/*";
      await api.permissions.request({ origins: [origin] });
    } catch {
      // Ignore — permissions may already be granted or optional
    }
  }

  await save(data);
  setStatus("Preferences saved.", "ok");

  // Reload projects with new config
  await loadProjects(data);

  return true;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  setStatus("Saving…");
  await saveForm();
});

// Auto-save checkboxes
for (const name of checkboxFields) {
  form.elements[name]?.addEventListener("change", async () => {
    await saveForm();
  });
}

// Auto-save token after change (debounced)
let tokenTimer;
form.elements["token"]?.addEventListener("input", () => {
  clearTimeout(tokenTimer);
  tokenTimer = setTimeout(async () => {
    if (form.elements["token"].value.length > 10) {
      await saveForm();
    }
  }, 800);
});

// Auto-save on project change
projectSelect.addEventListener("change", async () => {
  await saveForm();
  const name = projectSelect.options[projectSelect.selectedIndex]?.textContent || "";
  setStatus(projectSelect.value ? `Project set to: ${name}` : "Project: global (unassigned)", "ok");
});

// ── Test connection ───────────────────────────────────────────────────────────
document.querySelector("#test-btn").addEventListener("click", async () => {
  setStatus("Testing connection…");
  try {
    await saveForm();
    const cfg = await settings();
    const result = await testConnection(cfg);
    const perms = [];
    if (result.capture) perms.push("capture");
    if (result.retrieval) perms.push("retrieval");
    if (result.writing) perms.push("writing");
    setStatus(`✓ Connected. Permissions: ${perms.join(", ") || "none"}`, "ok");
  } catch (err) {
    setStatus(`✗ ${err.message}`, "err");
  }
});

// ── Retry failed captures ─────────────────────────────────────────────────────
document.querySelector("#retry").addEventListener("click", async () => {
  const current = await settings();
  await save({ queue: current.queue.map((item) => ({ ...item, attempts: 0, next: 0 })) });
  await api.runtime.sendMessage({ type: "flush" });
  setStatus("Retry requested. Results will appear in history.", "ok");
});

// ── Clear queue ───────────────────────────────────────────────────────────────
document.querySelector("#clear").addEventListener("click", async () => {
  await save({ queue: [], history: [], sent: [] });
  historyEl.textContent = "No history yet.";
  setStatus("Queue and history cleared.", "ok");
});
