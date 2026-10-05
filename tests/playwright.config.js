// Live-Notion tests: one browser, one tab, strictly in order. Everything
// shares a single sandbox database, so nothing may run in parallel.
const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: ".",
  outputDir: ".results",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 3 * 60 * 1000,
  expect: { timeout: 10 * 1000 },
  reporter: [["list"], ["./support/file-reporter.js"]],
});
