import { api, settings, save } from "./lib/storage.js";
const form = document.querySelector("form"), status = document.querySelector("#status");
const config = await settings();

// Load saved settings into form, using defaults for checkboxes
for (const control of form.elements) {
  if (!control.name) continue;
  if (control.type === "checkbox") {
    // Use saved value if it exists, otherwise use the HTML default (already set in HTML)
    if (control.name in config && config[control.name] !== undefined) {
      control.checked = config[control.name];
    }
  } else {
    control.value = config[control.name] || "";
  }
}

document.querySelector("#history").textContent = config.history.map((item) => `${item.at}: ${item.status}`).join("\n");

async function saveForm() {
  const data = Object.fromEntries(new FormData(form));
  for (const name of ["consent", "chatgpt", "claude", "auto", "paused"]) data[name] = form.elements[name].checked;
  const url = new URL(data.endpoint);
  const origin = url.origin + "/*";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))) {
    status.textContent = "Use loopback HTTP or HTTPS";
    return false;
  }
  if (!await api.permissions.request({ origins: [origin] })) {
    status.textContent = "Backend host access was not granted";
    return false;
  }
  await save(data);
  status.textContent = "Preferences saved.";
  return true;
}

form.onsubmit = async (event) => {
  event.preventDefault();
  await saveForm();
};

// Auto-save when token is pasted or typed (after a short delay)
form.elements["token"].addEventListener("change", async () => {
  if (form.elements["token"].value.length > 10) {
    await saveForm();
    status.textContent = "Token saved automatically.";
  }
});

// Auto-save when any checkbox changes
for (const name of ["consent", "chatgpt", "claude", "auto", "paused"]) {
  form.elements[name].addEventListener("change", async () => {
    await saveForm();
  });
}

document.querySelector("#clear").onclick = async () => {
  await save({ queue: [], history: [], sent: [] });
  status.textContent = "Local queue and history cleared";
};

document.querySelector("#retry").onclick = async () => {
  const current = await settings();
  await save({ queue: current.queue.map((item) => ({ ...item, attempts: 0, next: 0 })) });
  status.textContent = "Retry requested. Capture must still be authorized and unpaused; retry runs within one minute.";
};
