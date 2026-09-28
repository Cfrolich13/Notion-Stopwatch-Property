# Notion Task Stopwatch

A Chrome extension that puts a compact start/pause/resume stopwatch on
Notion task pages and saves the total time (in minutes) to a Number
property on that page's database entry — automatically, with no manual
save step.

## Features

- Start/pause/resume, accumulating elapsed time across any number of
  cycles, per page (`chrome.storage.local`, keyed by page id).
- Automatically syncs elapsed time with Notion. Saves on pause and every
  60s while running.
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

## Install (unpacked/dev mode)

1. Unzip this folder somewhere permanent (don't delete it after installing —
   Chrome loads the extension directly from these files).
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select this folder.
5. Pin the extension (puzzle-piece icon in the toolbar → pin) for easy
   access to its settings.

## Configure it

See **SETUP.md** for the full walkthrough (creating a Notion integration,
sharing your database, adding the Number property, and the optional
Status/Done-checkbox automation settings).

## How it works

- `content.js` places a small stopwatch pill on Notion pages — inline next
  to the property it saves to when possible, or floating in the
  bottom-right corner otherwise — and tracks elapsed time per page in
  `chrome.storage.local`. It saves automatically on pause and every 60
  seconds while running; there's no manual save button. It also works when
  a task is opened as a Notion "side peek," and hides itself on bare
  database views (calendar/kanban/table/etc.) where no page is open.
- If configured, `content.js` also watches a Status property and/or a Done
  checkbox to start or pause the stopwatch automatically.
- `background.js` is the only piece that talks to the Notion API — it
  reads your saved token and PATCHes the page's Number property whenever
  the stopwatch pauses or auto-saves, and PATCHes the Status property when
  auto-start writes it back.
- `popup.html` / `popup.js` are the settings screen: token, target Number
  property name, optional Status/Done-checkbox property names, and
  exclude-URL patterns.

## Files

```
manifest.json    Extension configuration (Manifest V3)
content.js       Stopwatch widget, per-page timer logic, Status/Done watching
content.css      Widget styling
background.js    Notion API calls
popup.html       Settings UI
popup.js         Settings logic
SETUP.md         Step-by-step Notion integration setup
CLAUDE.md        Overview of project intended to be accessed by Claude Code
```
