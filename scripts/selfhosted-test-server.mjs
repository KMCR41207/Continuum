import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtemp, mkdir } from "node:fs/promises";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
await mkdir(path.join(root, "data"), { recursive: true });
const data = await mkdtemp(path.join(root, "data", "browser-test-"));
const service = path.join(root, "services", "memory-api");
const python = path.join(
  service,
  ".venv",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);
const backend = spawn(
  python,
  [
    "-m",
    "uvicorn",
    "app.main:create_app",
    "--factory",
    "--host",
    "127.0.0.1",
    "--port",
    "8008",
  ],
  {
    cwd: service,
    stdio: "inherit",
    env: {
      ...process.env,
      CONTINUUM_DATA_DIR: data,
      CONTINUUM_ALLOWED_ORIGINS: "http://127.0.0.1:5188",
      CONTINUUM_EMBEDDING_PROVIDER: "disabled",
    },
  },
);
const web = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "--host",
    "127.0.0.1",
    "--port",
    "5188",
    "--strictPort",
  ],
  {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      VITE_BACKEND_MODE: "selfhosted",
      VITE_MEMORY_API_URL: "http://127.0.0.1:8008",
    },
  },
);
const stop = () => {
  backend.kill();
  web.kill();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
backend.on("error", (error) => {
  console.error(error.message);
  stop();
});
