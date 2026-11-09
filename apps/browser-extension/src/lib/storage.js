export const api = globalThis.browser || globalThis.chrome;

export const defaults = {
  // Auth — token only, no Supabase credentials in browser extension
  token: "",
  // Local Continuum API endpoint (never expose Supabase keys in extension)
  endpoint: "http://127.0.0.1:3101",
  // Capture settings
  consent: true,
  chatgpt: true,
  claude: true,
  paused: false,
  auto: true,
  // Project
  project: "",
  projectName: "",
  // State
  queue: [],
  history: [],
  sent: [],
};

export async function settings() {
  return { ...defaults, ...await api.storage.local.get(null) };
}

export async function save(value) {
  return api.storage.local.set(value);
}
