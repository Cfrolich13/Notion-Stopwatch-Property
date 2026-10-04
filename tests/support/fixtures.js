// Shared fixtures: one browser (test profile + freshly loaded extension)
// and one sandbox for the whole run.

const { test: base, expect, chromium } = require("@playwright/test");
const { PROFILE_DIR, DEFAULT_URL, readLocal, launchOptions } = require("./paths");
const { Sandbox } = require("./sandbox");

const test = base.extend({
  // Named apart from Playwright's built-in per-test `context`.
  extContext: [
    async ({}, use) => {
      const context = await chromium.launchPersistentContext(PROFILE_DIR, launchOptions());
      await use(context);
      await context.close();
    },
    { scope: "worker" },
  ],

  extensionId: [
    async ({ extContext }, use) => {
      const worker =
        extContext.serviceWorkers()[0] ||
        (await extContext.waitForEvent("serviceworker", { timeout: 15000 }));
      await use(worker.url().split("/")[2]);
    },
    { scope: "worker" },
  ],

  sandbox: [
    async ({ extContext, extensionId }, use) => {
      const url = process.env.NTS_SANDBOX_URL || readLocal().sandboxUrl || DEFAULT_URL;
      const sandbox = await Sandbox.create(extContext, extensionId, url);
      await use(sandbox);
      // Leave nothing running in the sandbox.
      await sandbox.ensurePaused(sandbox.a).catch(() => {});
      await sandbox.ensurePaused(sandbox.b).catch(() => {});
    },
    { scope: "worker", timeout: 90000 },
  ],
});

module.exports = { test, expect };
