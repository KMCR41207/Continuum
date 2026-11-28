import build from "./build-config.js";

export const api = globalThis.browser || globalThis.chrome;

export const defaults = {
  // Auth — the scoped capture token (ctm_…) authorizes every request.
  token: "",
  // Timestamp when the token was last saved (ISO string). Used to warn after 30 days.
  tokenSavedAt: "",
  // Supabase project URL (direct, no local server) when the build provides one;
  // otherwise the local Continuum API.
  endpoint: build.supabaseUrl || "http://127.0.0.1:3101",
  // Publishable/anon key for direct mode. Public by design; never a secret key.
  supabaseKey: build.supabaseKey || "",
  // Capture settings
  consent: true,
  chatgpt: true,
  claude: true,
  paused: false,
  auto: true,
  // Record references (name + URL) to files and images in captured messages
  captureFiles: true,
  // Project
  project: "",
  projectName: "",
  // State
  queue: [],
  history: [],
  sent: [],
  lastSent: {},
};

export async function settings() {
  return { ...defaults, ...await api.storage.local.get(null) };
}

export async function save(value) {
  return api.storage.local.set(value);
}
