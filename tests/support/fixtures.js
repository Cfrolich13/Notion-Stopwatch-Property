// Shared fixtures: one browser (test profile + freshly loaded extension)
// and one sandbox for the whole run.

const { test: base, expect, chromium } = require("@playwright/test");
const { PROFILE_DIR, DEFAULT_URL, readLocal, launchOptions } = require("./paths");
const { Sandbox } = require("./sandbox");
const { resolveTarget, stageExtension } = require("./target");

const SETTINGS_KEYS = [
  "notionToken",
  "propertyName",
  "statusPropertyName",
  "doneCheckboxPropertyName",
  "excludePatterns",
];

// Runs fn in the extension's own popup page, which can use chrome.storage.
async function inPopup(context, fn, arg) {
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker", { timeout: 15000 }));
  const page = await context.newPage();
  await page.goto(`chrome-extension://${worker.url().split("/")[2]}/popup.html`);
  const result = await page.evaluate(fn, arg);
  await page.close();
  return result;
}

const test = base.extend({
  // Named apart from Playwright's built-in per-test `context`.
  extContext: [
    async ({}, use) => {
      const target = resolveTarget();
      console.log(`Extension under test: ${target.label}`);
      if (!target.sha) {
        const context = await chromium.launchPersistentContext(PROFILE_DIR, launchOptions());
        await use(context);
        await context.close();
        return;
      }

      // An unpacked extension's id, and so its storage, depends on its
      // folder. The staged copy starts with no settings; carry them over
      // from the working-tree copy the profile was set up with.
      const current = await chromium.launchPersistentContext(PROFILE_DIR, launchOptions());
      const settings = await inPopup(current, (keys) => chrome.storage.local.get(keys), SETTINGS_KEYS);
      await current.close();

      const staged = stageExtension(target.sha);
      const context = await chromium.launchPersistentContext(PROFILE_DIR, launchOptions(staged));
      await inPopup(context, (values) => chrome.storage.local.set(values), settings);
      await use(context);
      await context.close();
    },
    { scope: "worker", timeout: 60000 },
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
