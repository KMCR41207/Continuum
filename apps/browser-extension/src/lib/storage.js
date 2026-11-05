export const api = globalThis.browser || globalThis.chrome;
export const defaults = { consent: true, chatgpt: true, claude: true, paused: false, auto: true, endpoint: "http://127.0.0.1:3101", project: "", token: "", queue: [], history: [], sent: [] };
export async function settings() { return { ...defaults, ...await api.storage.local.get(null) }; }
export async function save(value) { return api.storage.local.set(value); }
