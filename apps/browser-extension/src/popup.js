import { api, settings, save } from "./lib/storage.js";
import { fetchProjects, testConnection } from "./lib/api.js";

const statusBox = document.querySelector("#status-box");
const autoPill = document.querySelector("#auto-pill");
const pausedPill = document.querySelector("#paused-pill");
const projectSelect = document.querySelector("#project-select");
const captureBtn = document.querySelector("#capture-now");
const optionsBtn = document.querySelector("#open-options");
const lastStatus = document.querySelector("#last-status");

function setStatus(text, type) {
  statusBox.textContent = text;
  statusBox.className = "status" + (type ? ` ${type}` : "");
}

function setPill(el, value, trueLabel, falseLabel, trueClass) {
  el.textContent = value ? trueLabel : falseLabel;
  el.className = "pill" + (value && trueClass ? ` ${trueClass}` : "");
}

async function init() {
  const config = await settings();

  // Show history
  if (config.history.length > 0) {
    const last = config.history[0];
    lastStatus.textContent = `Last: ${last.status}`;
  }

  // Set pills
  setPill(autoPill, config.auto, "ON", "OFF", "on");
  setPill(pausedPill, config.paused, "YES", "NO");

  // Test connection
  if (!config.token) {
    setStatus("⚠ No token — open Settings to configure", "err");
    return;
  }

  try {
    await testConnection(config);
    setStatus("✓ Connected to Continuum", "ok");
  } catch (err) {
    setStatus(`✗ ${err.message}`, "err");
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
      projectSelect.appendChild(opt);
    });
    if (!config.project) projectSelect.value = "";
  } catch {
    // Non-fatal — project list just won't populate
  }
}

// Project selection
projectSelect.addEventListener("change", async () => {
  const id = projectSelect.value;
  const name = id ? projectSelect.options[projectSelect.selectedIndex].textContent : "";
  await save({ project: id, projectName: name });
  // Notify background
  await api.runtime.sendMessage({ type: "set_project", project: id, projectName: name });
  lastStatus.textContent = id ? `Project set: ${name}` : "Project: global";
});

// Capture now — sends to active tab
captureBtn.addEventListener("click", async () => {
  captureBtn.disabled = true;
  captureBtn.textContent = "Capturing…";
  try {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) { lastStatus.textContent = "No active tab"; return; }
    const hostname = new URL(tab.url || "").hostname;
    if (!["chatgpt.com", "claude.ai"].includes(hostname)) {
      lastStatus.textContent = "Open ChatGPT or Claude first";
      return;
    }
    // Trigger manual sync in content script
    const response = await api.tabs.sendMessage(tab.id, { type: "manual_capture" });
    lastStatus.textContent = response?.status || response?.error || "Done";
  } catch (err) {
    lastStatus.textContent = `Error: ${err.message}`;
  } finally {
    captureBtn.disabled = false;
    captureBtn.textContent = "⚡ Capture now";
  }
});

optionsBtn.addEventListener("click", () => api.runtime.openOptionsPage());

init();
