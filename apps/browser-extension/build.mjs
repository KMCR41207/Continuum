import { mkdir, cp, writeFile } from "node:fs/promises";
const root = new URL("./", import.meta.url);
const backend = new URL(
  process.env.CONTINUUM_EXTENSION_API_ORIGIN || "http://127.0.0.1:8000",
);
if (
  backend.protocol !== "https:" &&
  !["127.0.0.1", "localhost"].includes(backend.hostname)
)
  throw new Error("Custom extension backend must use HTTPS");
for (const browser of ["chrome", "firefox"]) {
  const target = new URL(`build/${browser}/`, root);
  await mkdir(target, { recursive: true });
  await cp(new URL("src/", root), target, { recursive: true });
  const manifest = {
    manifest_version: 3,
    name: "Continuum authorized capture",
    version: "0.1.0",
    permissions: ["storage", "alarms"],
    host_permissions: ["https://chatgpt.com/*", "https://claude.ai/*"],
    optional_host_permissions: [
      ...new Set([
        "http://127.0.0.1/*",
        "http://localhost/*",
        backend.origin + "/*",
      ]),
    ],
    content_scripts: [
      {
        matches: ["https://chatgpt.com/*", "https://claude.ai/*"],
        js: ["content/capture.js"],
      },
    ],
    background:
      browser === "chrome"
        ? { service_worker: "background.js", type: "module" }
        : { scripts: ["background.js"], type: "module" },
    action: { default_popup: "popup.html" },
    options_ui: { page: "options.html", open_in_tab: true },
  };
  if (browser === "firefox")
    manifest.browser_specific_settings = {
      gecko: {
        id: "continuum-capture@local.invalid",
        strict_min_version: "128.0",
        data_collection_permissions: {
          required: ["websiteContent"],
          optional: [],
        },
      },
    };
  await writeFile(
    new URL("manifest.json", target),
    JSON.stringify(manifest, null, 2),
  );
}
