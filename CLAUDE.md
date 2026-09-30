# Notion Task Stopwatch

## Overview

A Manifest V3 Chrome extension that puts a compact stopwatch on Notion task
pages. The user can start/pause/resume it any number of times, and the
accumulated time (in minutes) is written automatically to a Number
property on that page's database entry via the Notion API. Optional
settings let a Status property and/or a Done checkbox drive the stopwatch
automatically. There's no build step — the extension is loaded unpacked
directly into Chrome (see `README.md` for install steps, `SETUP.md` for
the Notion-side integration setup). No package manager, linter, or test
suite in this repo.

## Features

- Start/pause/resume, accumulating elapsed time across any number of
  cycles, per page (`chrome.storage.local`, keyed by page id).
- Fully automatic saving — no manual save button. Saves on pause and every
  60s while running. The Notion property is always **overwritten** with
  total elapsed minutes so far, never incremented.
- Inline placement next to the actual property it saves to, with a
  floating bottom-right pill as fallback when no anchor is found.
- Works on full pages and Notion "side peek" panels.
- Auto-hides on bare database views (calendar/kanban/table/etc. with no
  page open); a manual exclude-URL list in settings is an additional
  backstop.
- Optional **Status-driven automation**: stopwatch auto-starts when a
  configured Status property changes to "In progress", and auto-pauses
  when it changes to "Done". Starting the stopwatch manually while Status
  reads "Not started" writes Status to "In progress" back to Notion.
- Optional **Done-checkbox automation**: auto-pauses when a configured
  checkbox property is checked. Independent of the Status setting — either
  can be configured alone.

## File structure

- `manifest.json` — MV3 config; host permissions for the Notion API and
  both `notion.so`/`app.notion.com` hosts; content script + background
  service worker + popup wiring.
- `content.js` — everything that runs on the Notion page: page-id
  extraction from the URL, per-page timer state, the widget DOM, inline
  anchoring, auto-save triggers, bare-view/exclude detection, and
  Status/Done-checkbox watching.
- `background.js` — the only code that talks to the Notion API (reads
  settings, PATCHes the time property, GETs+PATCHes the Status property).
- `popup.html` / `popup.js` — settings UI (token, property names, exclude
  patterns), persisted to `chrome.storage.local`.
- `content.css` — widget styling.
- `SETUP.md` — end-user walkthrough for Notion integration setup, plus a
  "Notes & limitations" section on each DOM/URL heuristic's fragility.
- `README.md` — install-as-unpacked-extension instructions.

## Key design decisions

- **Time semantics**: the Notion property is overwritten with total
  elapsed minutes so far, not incremented — keeps Reset-then-retime
  accurate instead of double-counting.
- **No manual save button** — removed by design; all saves are automatic
  (on pause, and every 60s while running).
- **Only `background.js` talks to the Notion API** — keeps the
  integration token out of page-context JS and avoids relying on Notion's
  CORS behavior from a content script.
- **Status/Done detection is edge-triggered, not level-triggered**:
  `checkStatusTransitions` in `content.js` only acts on an observed
  *change*, never on a value simply being what it is. The previous
  reading is reset to "unknown" on page activation and on a settings
  change, so the first read after either is a baseline, not a transition —
  otherwise opening a task that's already "In progress" would force-start
  the timer.
- **Status/Done detection is DOM-based**, reusing the same anchor-finding
  code that places the inline widget, rather than a second Notion API read
  path — keeps the API surface (and the token's usage) limited to writes.

## Implementation notes / pitfalls to avoid

- **Read checkbox state from the live `.checked` DOM property**, never the
  `checked` HTML *attribute* (only reflects the initial default and never
  updates on toggle) and never a guessed `aria-checked` (Notion doesn't
  set that on its checkbox `<input>` at all).
- **A property's rendered value can coincidentally match another
  property's name** — e.g. a Status option literally named "Done" colliding
  with a separate "Done" checkbox property. Don't trust a text match alone
  as a property *label*; confirm it via `aria-haspopup="dialog"` on the
  nearest `[role="cell"]` ancestor, which only real label cells have (it's
  what opens Notion's property-type editor).
- **Scope DOM property lookups to `[role="table"][aria-label="Page
  properties"]`**, not an assumed `[role="dialog"]`. Notion's side peek
  does not render with a dialog role, so that scoping silently no-ops and
  the search falls through to the entire document — colliding with other
  same-named properties on screen, e.g. a database view's own checkbox
  column sitting behind an open peek.
- **When a DOM heuristic misbehaves on the live Notion page in a way that
  can't be diagnosed by reading the code, ask for real DevTools markup**
  (or add temporary `console.debug` logging and have the user reproduce
  it) rather than guessing again. Every DOM-heuristic bug in this project
  was root-caused this way, not by inference from static code alone.
- For fragility details on any specific heuristic (URL parsing, bare
  database view detection, inline anchoring), see `SETUP.md`'s "Notes &
  limitations" section rather than duplicating it here.

## Code style

- Comments: concise and skimmable. Explain *why* something is done a
  particular way, not what the code does. Short inline comments are fine
  where they help; avoid long paragraph comments.
