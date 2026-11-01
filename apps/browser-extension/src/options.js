import { api, settings, save } from "./lib/storage.js";
const form = document.querySelector("form"), status = document.querySelector("#status");
const config = await settings();
for (const control of form.elements) if (control.name) { if (control.type === "checkbox") control.checked = config[control.name]; else control.value = config[control.name] || ""; }
document.querySelector("#history").textContent = config.history.map((item) => `${item.at}: ${item.status}`).join("\n");
form.onsubmit = async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  for (const name of ["consent", "chatgpt", "claude", "auto", "paused"]) data[name] = form.elements[name].checked;
  const url = new URL(data.endpoint);
  const origin = url.origin + "/*";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))) { status.textContent = "Use loopback HTTP or HTTPS"; return; }
  if (!await api.permissions.request({ origins: [origin] })) { status.textContent = "Backend host access was not granted"; return; }
  await save(data); status.textContent = "Preferences saved. Capture requires consent, an enabled platform, and pause turned off.";
};
document.querySelector("#clear").onclick = async () => { await save({ queue: [], history: [], sent: [] }); status.textContent = "Local queue and history cleared"; };
document.querySelector("#retry").onclick = async () => { const current = await settings(); await save({queue: current.queue.map((item) => ({...item, attempts:0, next:0}))}); status.textContent = "Retry requested. Capture must still be authorized and unpaused; retry runs within one minute."; };
