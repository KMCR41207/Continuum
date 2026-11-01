import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const service = fileURLToPath(
  new URL("../services/memory-api/", import.meta.url),
);
const python = spawn(
  "uv",
  [
    "run",
    "--locked",
    "--extra",
    "local-model",
    "uvicorn",
    "app.main:create_app",
    "--factory",
    "--host",
    "127.0.0.1",
    "--port",
    "8000",
  ],
  { cwd: service, stdio: "inherit", shell: process.platform === "win32" },
);
const web = spawn(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "5173"],
  {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      VITE_BACKEND_MODE: "selfhosted",
      VITE_MEMORY_API_URL: "http://127.0.0.1:8000",
    },
  },
);
const stop = () => {
  python.kill("SIGTERM");
  web.kill("SIGTERM");
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
python.on("error", (error) => {
  console.error("Python runtime: " + error.message);
  stop();
});
python.on("exit", (code) => {
  if (code) {
    stop();
    process.exitCode = code;
  }
});
