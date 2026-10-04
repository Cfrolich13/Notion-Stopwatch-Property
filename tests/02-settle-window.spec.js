// The settle window (first 1.5 s after a page opens) must not swallow a
// change the user makes themselves: a click inside the properties table
// ends the window early.

const { test, expect } = require("./support/fixtures");

test.beforeAll(async ({ sandbox }) => {
  await sandbox.prepare({ a: "In progress", b: "Done" });
});

test("ticking Done right after reopening a page pauses its running timer", async ({ sandbox }) => {
  const { a, b } = sandbox;
  await sandbox.openPage(a);
  await sandbox.toggle();
  await sandbox.expectRunning(a, true, "manual start");

  await sandbox.openPage(b);
  await sandbox.clickCard(a);
  await sandbox.wait(700); // inside the window, after the URL poll has seen A
  expect((await sandbox.readProps()).done).toBe(false);
  await sandbox.clickDone();

  await sandbox.expectRunning(a, false, "Done ticked inside the settle window", 3000);

  await sandbox.wait(2000);
  await sandbox.setDone(false);
});

test("setting Status to In progress right after reopening a page starts its timer", async ({
  sandbox,
}) => {
  const { a, b } = sandbox;
  await sandbox.openPage(a);
  await sandbox.setStatus("Not started");
  await sandbox.wait(1500);
  expect((await sandbox.timerState(a)).running).toBe(false);

  await sandbox.openPage(b);
  await sandbox.clickCard(a);
  await sandbox.wait(600);
  await sandbox.pickStatus("In progress");

  await sandbox.expectRunning(a, true, "Status changed inside the settle window", 3000);

  await sandbox.wait(2000);
  await sandbox.toggle();
  await sandbox.expectRunning(a, false, "manual pause");
});
