// One page's timer and saves must never land on another page, even when
// the user switches pages while a 60 s auto-save is in flight.

const { test, expect } = require("./support/fixtures");

const RUN_MS = 80 * 1000; // long enough to contain an auto-save

test("a running timer keeps to its own page while switching", async ({ sandbox }) => {
  test.setTimeout(RUN_MS + 150000);
  const { a, b } = sandbox;
  await sandbox.prepare({ a: "In progress", b: "Done" });

  await sandbox.openPage(b);
  const bBefore = { state: await sandbox.timerState(b), time: (await sandbox.readProps()).time };

  await sandbox.openPage(a);
  const aTimeBefore = (await sandbox.readProps()).time;
  await sandbox.toggle();
  await sandbox.expectRunning(a, true, "manual start");
  const started = await sandbox.timerState(a);

  const t0 = Date.now();
  for (let i = 0; Date.now() - t0 < RUN_MS; i++) {
    await sandbox.wait(1800 + ((i * 211) % 1300));
    await sandbox.clickCard(b);
    await sandbox.wait(1700 + ((i * 97) % 900));
    await sandbox.clickCard(a);

    const stateA = await sandbox.timerState(a);
    expect(stateA.running, `switch ${i}: page A stopped`).toBe(true);
    expect(stateA.lastStartTs, `switch ${i}: page A restarted`).toBe(started.lastStartTs);
    expect(await sandbox.timerState(b), `switch ${i}: page B's state changed`).toEqual(bBefore.state);
  }

  await sandbox.openPage(a);
  // The auto-save landed on A…
  await expect
    .poll(async () => (await sandbox.readProps()).time, { timeout: 20000 })
    .not.toBe(aTimeBefore);
  await sandbox.toggle();
  await sandbox.expectRunning(a, false, "manual pause");

  // …and never on B.
  await sandbox.openPage(b);
  expect((await sandbox.readProps()).time).toBe(bBefore.time);
  expect(await sandbox.timerState(b)).toEqual(bBefore.state);
});
