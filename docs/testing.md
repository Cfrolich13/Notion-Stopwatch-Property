# Testing in live Notion

All testing happens against the real extension on a real Notion page;
nothing is mocked. There are two ways to do it:

1. **The Playwright suite in `tests/`** — the default. Run it after any
   change to `content.js` or `background.js`.
2. **Agent-driven browser control** (Claude in Chrome) — for investigating
   something the suite doesn't cover, or in the user's own browser.
   Covered from "Ad-hoc testing with browser tools" onward.

## Playwright suite

```
npm install             # once
npm run test:setup      # once, and again if the Notion session expires
npm test                # the whole suite, about 5 minutes
npx playwright test -c tests 02-settle-window   # one file
NTS_TRIPS=60 npm test   # more page-switch round trips (default 30)
NTS_EXTENSION_REF=3f4cc3e npm test   # current tests, extension as of that commit
```

- **How it runs**: Playwright launches its own Chromium with a dedicated
  profile (`tests/.profile/`, git-ignored) and loads the extension fresh
  from `notion-task-stopwatch/` on every run, so there is no manual
  reload step. A browser window opens; it can sit behind other windows
  while the user works elsewhere (Playwright launches Chromium with
  background throttling switched off). Don't minimize it or click around
  inside it during a run.
- **Results are saved** to `tests/.runs/<date>_<time>_<version>.txt`
  (git-ignored, one file per run, never overwritten): the extension
  version tested, each test's outcome and duration, and failure messages.
  The terminal shows the same thing live.
- **Testing an older commit**: don't check it out — the tests would
  change or vanish with it. Set `NTS_EXTENSION_REF` to any commit, tag or
  branch instead. The run unpacks `notion-task-stopwatch/` from that
  commit into `tests/.ext/` and loads that copy; the working tree and the
  tests stay as they are. Details that matter:
  - without the variable, the working tree is tested, uncommitted changes
    included;
  - the staged copy has a different extension id, so its own storage: the
    run copies the settings over from the working-tree copy first (an
    extra browser launch), and its timer state is separate;
  - tests for behavior the old commit didn't have yet are expected to
    fail there. Useful for confirming a test catches a past bug, or for
    finding which commit broke something (`git bisect` by hand).
- **One-time setup is manual by design**: `npm run test:setup` opens that
  browser so the user can log in to Notion, enter the token and property
  names in the extension settings tab, and visit the sandbox calendar
  view. The view's URL is saved to `tests/.local.json`. An agent must not
  type the login or the token; ask the user to run setup.
- **Sandbox requirements**: a calendar view showing at least two task
  cards, a Status property with "Not started" / "In progress" / "Done",
  a Done checkbox, a Number property for the time, and **no Notion
  automation linking Status and Done** (it makes triggers ambiguous).
  The suite uses the first two cards as page A and page B and sets their
  Status itself.
- **What it leaves behind**: both timers paused. Page A's timer is reset
  to zero by the Reset test and then accumulates a couple of minutes;
  the time property in Notion is overwritten accordingly.

| File | Covers |
|---|---|
| `01-page-switch.spec.js` | Switching pages in one side peek never starts or resumes a timer |
| `02-settle-window.spec.js` | A Done tick or Status change made within ~1 s of opening a page still counts |
| `03-transitions.spec.js` | Manual start writes Status; Status/Done changes start and pause; save indicator; Reset; bare calendar view |
| `04-isolation.spec.js` | A running timer and its auto-save stay on their own page while switching for 80 s |

Support code: `tests/support/sandbox.js` (drive Notion, read the
extension's stored state through its popup page), `fixtures.js` (browser
and sandbox shared by the whole run), `paths.js` (profile, launch flags),
`target.js` (which extension version is loaded), `file-reporter.js`
(the saved results).

- **Reading failures**: assertions on `timerState(...)` read
  `chrome.storage.local` directly, so a failure there is the extension's
  real state, not a rendering glitch. A timeout while opening a page or
  picking a Status option usually means Notion's markup changed — fix the
  selectors in `sandbox.js`. A setup error ("not logged in" / "settings
  incomplete") means the profile needs `npm run test:setup` again.
- **Check that a new test can fail.** A live test that passes first time
  proves little. For a past bug, run the test against the pre-fix commit
  with `NTS_EXTENSION_REF`; otherwise temporarily break the behavior it
  guards, confirm the test goes red, then restore the file. Done for
  `01` (pre-fix code fails on the first round trip) and `02` (fails with
  the `onPropertiesInteraction` listeners removed).
- **Timing noise**: it is still live Notion. If a timing test fails once,
  rerun that file before concluding there is a bug.

## Ad-hoc testing with browser tools

These notes record what worked when driving the user's own browser by
hand, so a new session doesn't have to rediscover it.

### Before starting

- **The user must reload the extension** at `chrome://extensions` after
  any code change, then the Notion tab must be loaded fresh. An agent
  can't reload an unpacked extension itself — ask, and wait for a yes.
- **Use the browser that has the extension loaded** (the user's Chromium,
  not their other Chrome install). If the wrong browser is connected, ask
  the user to switch it with `/chrome`.
- **Confirm the extension is injecting before testing anything.** Open a
  task page and check that `#nts-widget-root` exists. If it doesn't, probe
  the stylesheet: append a `div#nts-widget-root.nts-floating` to
  `document.documentElement` and read its computed `position`. `fixed`
  means the extension is injecting (so the script itself is failing);
  `static` means Chrome isn't applying the extension to this tab at all
  (wrong browser/profile, or disabled) — a code bug can't cause that,
  because CSS is injected even when `content.js` throws.
- **Sandbox**: the user keeps a "To-Do" database for testing; opening
  `https://app.notion.com/` lands on its calendar view. It has (at the
  time of writing) one "In progress" task and one "Done" task on the
  calendar, which is all the page-switch tests need. Token and property
  names are already configured in the extension popup.

### Observing state

Page scripts (the `javascript_tool`) run in the page's main world, so they
can't read `chrome.storage` or the content script's variables. Read the
widget and the properties table from the DOM instead:

```js
const tbl = () => [...document.querySelectorAll(
  '[role="table"][aria-label="Page properties"]')].pop();
const snap = () => {
  const w = document.getElementById('nts-widget-root');
  const rows = tbl() ? [...tbl().querySelectorAll('[role="row"]')] : [];
  const st = rows.find(r => r.textContent.trim().startsWith('Status'));
  return {
    page: (location.href.match(/[?&]p=([0-9a-f]{32})/i) || [])[1] || null,
    time: w && w.querySelector('.nts-time').textContent,
    toggle: w && w.querySelector('.nts-toggle').textContent, // ▶ paused, ⏸ running
    dot: w && w.querySelector('.nts-dot').title,             // "Saved N min to Notion"
    status: st ? st.textContent.trim().replace(/^Status/, '') : null,
    done: tbl() && tbl().querySelector('input[type=checkbox]')?.checked,
  };
};
```

- A row's value cell is the second `[role="cell"]` in its `[role="row"]`
  (used to read "Completion Time" or whatever the time property is called).
- The widget is briefly missing from the document for a fraction of a
  second after a page switch (Notion re-renders, the next tick re-anchors
  it). A `null` widget in a sample taken right after a switch is normal.

### Driving the page from script

Scripted actions give controlled timing, which real tool clicks can't
(each tool call takes an unpredictable second or more).

- **Switch pages in the side peek**: `.click()` the calendar card's link:
  `.notion-calendar-view a[role="link"]` whose `href` contains the page's
  32-hex id. Get the two ids from those hrefs at the start of the run.
- **Start/pause**: `.click()` on `#nts-widget-root .nts-toggle`.
- **Tick the Done checkbox**: `.click()` on the table's
  `input[type=checkbox]` toggles it, but fires no `pointerdown`. The
  settle-window logic listens for `pointerdown`/`keydown`, so to imitate a
  real click dispatch
  `new PointerEvent('pointerdown', {bubbles: true, cancelable: true})` on
  the input first, then `.click()`.
- **Change Status**: dispatch `pointerdown`, `mousedown`, `mouseup` and
  `.click()` on the Status value cell's first child to open the menu, wait
  ~350 ms, then `.click()` the option whose text matches inside
  `.notion-overlay-container` (`[role="option"]` / `[role="menuitem"]`).
  Real mouse clicks via the `computer` tool also work when timing doesn't
  matter (take a screenshot for coordinates; they depend on window size).
- **Never click the Reset button (↺)**: it opens a `confirm()` dialog,
  which blocks the browser tools until the user dismisses it. (The
  Playwright suite does test Reset; it can answer the dialog.)

### Tool limits worth knowing

- **The user's own browser does throttle hidden tabs.** If the test tab is
  minimized, fully covered by another window, or not the active tab, its
  timers slow to about one tick per second, which distorts timing tests.
  Ask the user to keep that window at least partly visible.

- A `browser_batch` whose waits add up to much more than ~50 s times out.
  For long runs, start a detached async loop that writes results to a
  `window` object, return immediately, then poll with batches of ≤ 45 s
  of waits.
- `javascript_tool` refuses to return output containing URL query strings
  ("BLOCKED: Cookie/query string data"). Don't return `location.href`;
  return the extracted page id or a boolean instead.
- `Array.prototype.join` renders `null` as an empty string — a blank field
  in a joined sample line means the widget was absent, not that its text
  was empty.

### Procedures

Record the starting widget time and time-property value of both pages
first; the checks compare against them.

1. **Page-switch regression** (the "paused timer resumes on switch" bug).
   Page A "In progress" and paused, page B "Done" or "Not started".
   Run 40 round trips A → B → A, snapshotting ~2.6 s after each arrival:
   30 with 1.5–2.5 s dwell on B and 10 with 0.25–0.9 s, varying each wait
   by a few tens of ms per iteration so clicks land at different phases
   of the extension's 500 ms / 1000 ms ticks. Pass: every snapshot shows
   ▶ and an unchanged time on both pages. Takes about three minutes.
2. **Early change inside the settle window.** Page A running, Done
   unticked. Go to B, wait 2.6 s, reopen A, and 700 ms later tick Done
   (with the `pointerdown`). Sample every 50 ms. Pass: the toggle turns to
   ▶ within about a second. Same idea for Status: reopen a paused page 
   and set "In progress" within ~1 s → it starts.
3. **Real transitions on an open page.** Status → "Done" pauses and saves
   (dot title shows "Saved …"); Status → "In progress" starts; ticking
   Done pauses; manual start while Status is "Not started" writes Status
   "In progress".
4. **No cross-page writes.** Start A, then switch A ↔ B every 2–3 s for
   80 s so a 60 s auto-save falls inside the run. Pass: A's time tracks
   the wall clock, A's time property updates, B's widget time and time
   property are unchanged.
5. **Bare view.** Close the peek → widget not visible; reopen A → same
   state as before.

### Afterwards

Put the sandbox back the way it was found (Status, Done checkbox, timer
paused), remove any helper object from `window`, close the test tab, and
tell the user what changed that can't be undone — the timer's elapsed
time and the saved time property both grow during testing.
