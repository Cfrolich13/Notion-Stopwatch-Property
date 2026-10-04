// Regression: switching pages inside one side peek must never be read as
// a Status/Done change. Page A is "In progress" and paused, page B is
// "Done"; before the fix, coming back to A sometimes resumed its timer.

const { test, expect } = require("./support/fixtures");

const TRIPS = Number(process.env.NTS_TRIPS || 30);

test("paused timers stay paused across side-peek page switches", async ({ sandbox }) => {
  test.setTimeout(TRIPS * 8000 + 120000);
  const { a, b } = sandbox;
  await sandbox.prepare({ a: "In progress", b: "Done" });
  await sandbox.openPage(a);

  const before = { a: await sandbox.timerState(a), b: await sandbox.timerState(b) };

  for (let i = 0; i < TRIPS; i++) {
    // Mostly long enough on B for a baseline read there; the last quarter
    // are quick flicks. Waits vary per trip so the clicks land at different
    // points of the extension's 500 ms / 1000 ms ticks.
    const quick = i >= Math.floor(TRIPS * 0.75);
    const dwell = quick ? 250 + ((i * 173) % 700) : 1500 + ((i * 137) % 1000);

    await sandbox.clickCard(b);
    await sandbox.wait(dwell);
    await sandbox.clickCard(a);
    await sandbox.wait(2600 + ((i * 53) % 400));

    const [stateA, stateB] = [await sandbox.timerState(a), await sandbox.timerState(b)];
    expect(stateA.running, `trip ${i}: page A resumed (dwell ${dwell} ms)`).toBe(false);
    expect(stateB.running, `trip ${i}: page B started (dwell ${dwell} ms)`).toBe(false);
  }

  expect((await sandbox.timerState(a)).elapsedMs).toBe(before.a.elapsedMs);
  expect((await sandbox.timerState(b)).elapsedMs).toBe(before.b.elapsedMs);
});
