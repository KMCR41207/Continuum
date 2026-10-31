import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests/connections-browser",
  workers: 1,
  timeout: 60000,
  use: { baseURL: "http://127.0.0.1:5174", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: {
    command: "pnpm dev --port 5174 --strictPort",
    url: "http://127.0.0.1:5174",
    reuseExistingServer: false,
    env: {
      VITE_SUPABASE_URL: "https://continuum-test.supabase.co",
      VITE_SUPABASE_ANON_KEY: "browser-test-public-key",
    },
  },
});
