# Testing in live Notion

There is no automated test suite. Behavior is verified by driving the real
extension on a real Notion page through the Claude in Chrome browser
tools. These notes record what worked, so a new session doesn't have to
rediscover it.

## Before starting

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

## Observing state

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

## Driving the page from script

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
  which blocks the browser tools until the user dismisses it.

## Tool limits worth knowing

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

## Procedures

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

## Afterwards

Put the sandbox back the way it was found (Status, Done checkbox, timer
paused), remove any helper object from `window`, close the test tab, and
tell the user what changed that can't be undone — the timer's elapsed
time and the saved time property both grow during testing.
