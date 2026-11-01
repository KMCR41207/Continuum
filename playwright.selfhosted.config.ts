import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests/selfhosted-browser",
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: "http://127.0.0.1:5188",
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/selfhosted-test-server.mjs",
    url: "http://127.0.0.1:5188",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
