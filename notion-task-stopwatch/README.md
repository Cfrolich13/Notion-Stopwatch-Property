# Notion Task Stopwatch

A simple Chrome extension that puts a start/pause/resume stopwatch on Notion
pages and saves the total time (in minutes) to a Number property on that
page's database entry.

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
sharing your database, and adding the Number property).

## How it works

- `content.js` injects a small floating widget on Notion pages and tracks
  elapsed time per page in `chrome.storage.local`.
- `background.js` is the only piece that talks to the Notion API — it reads
  your saved token and PATCHes the page's Number property whenever you
  pause or click Save.
- `popup.html` / `popup.js` are the settings screen (token + property name).

## Files

```
manifest.json    Extension configuration (Manifest V3)
content.js       Stopwatch widget + per-page timer logic
content.css      Widget styling
background.js    Notion API calls
popup.html       Settings UI
popup.js         Settings logic
SETUP.md         Step-by-step Notion integration setup
```
