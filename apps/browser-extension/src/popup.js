import { api, settings, save } from "./lib/storage.js";
import { fetchProjects, testConnection } from "./lib/api.js";

const statusDot   = document.querySelector("#status-dot");
const statusText  = document.querySelector("#status-text");
const autoBadge   = document.querySelector("#auto-badge");
const pausedBadge = document.querySelector("#paused-badge");
const projectSel  = document.querySelector("#project-select");
const captureBtn  = document.querySelector("#capture-now");
const optionsBtn  = document.querySelector("#open-options");
const lastStatus  = document.querySelector("#last-status");
const openLink    = document.querySelector("#open-continuum");

function setStatus(text, type) {
  statusText.textContent = text;
  statusDot.className = "status-dot" + (type ? ` ${type}` : "");
}

function setBadge(el, value, onLabel, offLabel, pauseMode) {
  if (pauseMode) {
    el.textContent = "Paused";
    el.className = "badge badge-pause";
  } else if (value) {
    el.textContent = onLabel;
    el.className = "badge badge-on";
  } else {
    el.textContent = offLabel;
    el.className = "badge badge-off";
  }
}

async function init() {
  const config = await settings();

  // Show history
  if (config.history?.length > 0) {
    const last = config.history[0];
    lastStatus.textContent = last.status;
  }

  // Auto / paused badges
  setBadge(autoBadge, config.auto, "On", "Off");
  setBadge(pausedBadge, config.paused, "Yes", "No", config.paused);

  // Not configured
  if (!config.token) {
    setStatus("Not configured — open Settings", "err");
    return;
  }
  if (!config.endpoint) {
    setStatus("No endpoint — open Settings", "err");
    return;
  }

  // Test connection
  try {
    setStatus("Connecting…");
    await testConnection(config);
    if (config.paused) {
      setStatus("Connected — capture paused", "warn");
    } else if (!config.auto) {
      setStatus("Connected — manual capture only", "warn");
    } else {
      setStatus("Connected — auto capture active", "ok");
    }
  } catch (err) {
    setStatus(err.message, "err");
    return;
  }

  // Load projects
  try {
    const projects = await fetchProjects(config);
    projects.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      if (p.id === config.project) opt.selected = true;
      projectSel.appendChild(opt);
    });
    if (!config.project) projectSel.value = "";
  } catch { /* non-fatal */ }
}

// Project selection
projectSel.addEventListener("change", async () => {
  const id = projectSel.value;
  const name = id ? projectSel.options[projectSel.selectedIndex].textContent : "";
  await save({ project: id, projectName: name });
  await api.runtime.sendMessage({ type: "set_project", project: id, projectName: name });
  lastStatus.textContent = id ? `Project set → ${name}` : "Project: global";
});

// Capture now
captureBtn.addEventListener("click", async () => {
  captureBtn.disabled = true;
  const orig = captureBtn.innerHTML;
  captureBtn.textContent = "Capturing…";
  try {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) { lastStatus.textContent = "No active tab."; return; }
    const hostname = new URL(tab.url || "").hostname;
    if (!["chatgpt.com", "claude.ai"].includes(hostname)) {
      lastStatus.textContent = "Open ChatGPT or Claude first.";
      return;
    }
    const response = await api.tabs.sendMessage(tab.id, { type: "manual_capture" });
    lastStatus.textContent = response?.status || response?.error || "Done.";
  } catch (err) {
    lastStatus.textContent = `Error: ${err.message}`;
  } finally {
    captureBtn.disabled = false;
    captureBtn.innerHTML = orig;
  }
});

optionsBtn.addEventListener("click", () => api.runtime.openOptionsPage());

openLink.addEventListener("click", () => {
  api.tabs.create({ url: "http://127.0.0.1:5173/app/conversations" });
});

init();
