// Smoke test at iPhone size. CI runs WebKit (Safari's engine); set PW_BROWSER=chromium to run locally without WebKit.
const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "tests",
  timeout: 30000,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    ...devices["iPhone 13"],
    browserName: process.env.PW_BROWSER || "webkit",
    baseURL: "http://localhost:4173",
    serviceWorkers: "block",
    trace: "retain-on-failure"
  },
  webServer: { command: "node tests/serve.js", url: "http://localhost:4173", reuseExistingServer: !process.env.CI }
});
