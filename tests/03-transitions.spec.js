// Status/Done changes made on an open page drive the timer, and manual
// controls behave. Tests run in order and share page A's state.

const { test, expect } = require("./support/fixtures");

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ sandbox }) => {
  await sandbox.prepare({ a: "Not started", b: "Done" });
  await sandbox.openPage(sandbox.a);
});

test("manual start on a Not started page writes Status In progress", async ({ sandbox }) => {
  await sandbox.toggle();
  await sandbox.expectRunning(sandbox.a, true, "manual start");
  // Written through the Notion API, then synced back into the page.
  await expect
    .poll(async () => (await sandbox.readProps()).status, { timeout: 20000 })
    .toBe("In progress");
  // Our own write must not be read as a transition.
  await sandbox.wait(2500);
  expect((await sandbox.timerState(sandbox.a)).running).toBe(true);
});

test("Status → Done pauses and saves to Notion", async ({ sandbox }) => {
  await sandbox.setStatus("Done");
  await sandbox.expectRunning(sandbox.a, false, "Status set to Done");
  await expect(sandbox.widget.locator(".nts-dot")).toHaveAttribute("title", /^Saved .* min to Notion$/, {
    timeout: 15000,
  });
});

test("Status → In progress starts", async ({ sandbox }) => {
  await sandbox.setStatus("In progress");
  await sandbox.expectRunning(sandbox.a, true, "Status set to In progress");
});

test("ticking Done pauses; unticking does nothing", async ({ sandbox }) => {
  await sandbox.setDone(true);
  await sandbox.expectRunning(sandbox.a, false, "Done ticked");
  await sandbox.setDone(false);
  await sandbox.wait(2500);
  expect((await sandbox.timerState(sandbox.a)).running).toBe(false);
});

test("Reset asks first, then zeroes the timer", async ({ sandbox }) => {
  const { a, page } = sandbox;
  const before = await sandbox.timerState(a);
  expect(before.elapsedMs).toBeGreaterThan(0);

  page.once("dialog", (dialog) => dialog.dismiss());
  await sandbox.widget.locator(".nts-reset").click();
  await sandbox.wait(500);
  expect((await sandbox.timerState(a)).elapsedMs).toBe(before.elapsedMs);

  page.once("dialog", (dialog) => dialog.accept());
  await sandbox.widget.locator(".nts-reset").click();
  await expect.poll(async () => (await sandbox.timerState(a)).elapsedMs).toBe(0);
  await expect(sandbox.widget.locator(".nts-time")).toHaveText("00:00");
});

test("widget hides on the bare calendar and comes back unchanged", async ({ sandbox }) => {
  const { a } = sandbox;
  const before = await sandbox.timerState(a);
  await sandbox.closePeek();
  await expect(sandbox.widget).toBeHidden();
  await sandbox.openPage(a);
  expect(await sandbox.timerState(a)).toEqual(before);
});
