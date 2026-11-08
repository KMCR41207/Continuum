import { mkdir, cp, writeFile } from "node:fs/promises";

const root = new URL("./", import.meta.url);

// Optional: custom local API origin for legacy fallback
const backendOrigin = process.env.CONTINUUM_EXTENSION_API_ORIGIN || "http://127.0.0.1:3101";
const backend = new URL(backendOrigin);

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
    version: "0.2.0",
    description: "Capture ChatGPT and Claude conversations to Continuum memory.",
    permissions: ["storage", "alarms", "tabs", "activeTab"],
    host_permissions: [
      "https://chatgpt.com/*",
      "https://claude.ai/*",
      "https://*.supabase.co/*",
    ],
    optional_host_permissions: [
      // Local fallback
      "http://127.0.0.1/*",
      "http://localhost/*",
      // Custom backend if provided
      ...new Set(
        backend.protocol === "https:" ? [backend.origin + "/*"] : []
      ),
    ],
    content_scripts: [
      {
        matches: ["https://chatgpt.com/*", "https://claude.ai/*"],
        js: ["content/capture.js"],
        run_at: "document_idle",
      },
    ],
    background:
      browser === "chrome"
        ? { service_worker: "background.js", type: "module" }
        : { scripts: ["background.js"], type: "module" },
    action: {
      default_popup: "popup.html",
      default_title: "Continuum capture",
    },
    options_ui: { page: "options.html", open_in_tab: true },
  };

  if (browser === "firefox") {
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
  }

  await writeFile(
    new URL("manifest.json", target),
    JSON.stringify(manifest, null, 2),
  );
}

console.log("Extension built for chrome and firefox.");
