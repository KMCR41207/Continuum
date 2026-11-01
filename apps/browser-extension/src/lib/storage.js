export const api = globalThis.browser || globalThis.chrome;
export const defaults = { consent: false, chatgpt: false, claude: false, paused: true, auto: false, endpoint: "http://127.0.0.1:8000", project: "", token: "", queue: [], history: [], sent: [] };
export async function settings() { return { ...defaults, ...await api.storage.local.get(null) }; }
export async function save(value) { return api.storage.local.set(value); }
