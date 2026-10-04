// One-time setup for the test profile: `npm run test:setup`.
// Opens the test browser with the extension loaded so you can log in to
// Notion and fill in the extension settings by hand. Nothing is automated
// here on purpose — credentials are only ever typed by you.

const { chromium } = require("@playwright/test");
const { PROFILE_DIR, DEFAULT_URL, readLocal, writeLocal, launchOptions } = require("./support/paths");

(async () => {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    ...launchOptions(),
    viewport: null,
    // Some sign-in providers refuse browsers that announce automation.
    ignoreDefaultArgs: ["--enable-automation"],
  });

  const worker = context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker"));
  const extensionId = worker.url().split("/")[2];

  // Remember the last database view visited, as the sandbox to test in.
  let sandboxUrl = readLocal().sandboxUrl || null;
  const track = (page) =>
    page.on("framenavigated", (frame) => {
      if (frame !== page.mainFrame()) return;
      try {
        const u = new URL(frame.url());
        if (/notion\.(com|so)$/.test(u.hostname) && u.searchParams.get("v")) {
          u.searchParams.delete("p");
          u.searchParams.delete("pm");
          u.searchParams.delete("pvs");
          sandboxUrl = u.toString();
        }
      } catch (_) {}
    });
  context.on("page", track);

  const notion = context.pages()[0] || (await context.newPage());
  track(notion);
  await notion.goto(sandboxUrl || DEFAULT_URL).catch(() => {});
  const settings = await context.newPage();
  await settings.goto(`chrome-extension://${extensionId}/popup.html`);
  await notion.bringToFront();

  console.log(`
Test browser is open. In it:

  1. Log in to Notion (first tab).
  2. In the second tab (the extension's settings), enter the integration
     token and the property names, then click Save.
  3. Back in Notion, open the sandbox database's calendar view. It needs
     at least two task cards visible on the calendar.
  4. Close the browser window when done.
`);

  await new Promise((resolve) => context.on("close", resolve));
  if (sandboxUrl) {
    writeLocal({ ...readLocal(), sandboxUrl });
    console.log("Saved sandbox view to tests/.local.json. Run the tests with: npm test");
  } else {
    console.log("No database view was visited, so no sandbox was saved. Run setup again.");
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
