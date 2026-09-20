# Notion Task Stopwatch — Chrome Extension

## What this is

A Chrome extension (Manifest V3) that shows a compact stopwatch on Notion
task pages. The user can start/pause/resume it as many times as they like,
and the accumulated time (in minutes) is written automatically to a Number
property on that page's database entry via the Notion API.

This file captures full context from the chat where the extension was
designed and built, so work can continue in Claude Code without re-deriving
decisions already made.

## Current status

Fully working, iterated through several rounds of user feedback. The version
described below is the latest. No known open bugs; the "next steps" section
lists things flagged as best-effort/fragile that may need revisiting.

## User's requirements, in the order they came up

1. **Original ask**: simple Chrome extension, stopwatch on each page in a
   Notion task database, save time-to-complete to a database property,
   start/pause/resume any number of times.
2. Elapsed time storage format: **number of minutes, 2 decimal places**, in
   a Notion **Number** property.
3. User had **no existing Notion integration token** — needed full setup
   instructions (this is why `SETUP.md` exists and is detailed).
4. **Bug**: widget didn't appear — user's workspace is on `app.notion.com`,
   not `www.notion.so`. Fixed by adding both hosts to manifest + content
   script matches.
5. **UX overhaul request** (all delivered):
    - Remove the manual Save button entirely.
    - Keep auto-save on pause; **also auto-save every 60 seconds while
      running** (so long uninterrupted sessions stay in sync).
    - **Side peek support**: widget previously only worked on full pages,
      not when a task is opened as a Notion "side peek" panel.
    - **Compact single-line UI with icons** instead of a boxed widget with
      text buttons. User's example: `03:27 ► ↺` (told us to pick better
      symbols if needed — we used ▶/⏸ toggle + ↺ reset).
    - **Inline placement**: put the stopwatch next to the actual database
      property it saves to, instead of a floating corner widget, "if
      possible" — with floating as an explicit acceptable fallback.
    - User confirmed this round worked: *"That looks perfect."*
6. **Follow-up bug**: widget was showing (at `00:00`) on bare database
   views — calendar, kanban, etc. — where no page is actually open, so
   there's nothing to time. Asked for automatic detection, and if that's
   not fully reliable, a manual exclude-URL field as a backstop. Both were
   implemented. This is the most recent change and **has not yet been
   confirmed working by the user** — verify it first if picking this back
   up.

## Architecture

- **`manifest.json`** — MV3. `host_permissions` includes
  `https://api.notion.com/*`, `https://www.notion.so/*`,
  `https://app.notion.com/*`. Content script matches both Notion hosts.
  Background is a service worker (`background.js`). Popup is
  `popup.html`/`popup.js`.
- **`content.js`** — injected on every matched Notion page. Owns:
    - Page-id extraction from the URL (see "URL heuristics" below).
    - Per-page timer state in `chrome.storage.local`, keyed
      `nts_state_<pageId>`: `{ elapsedMs, running, lastStartTs,
    lastAutoSaveAt }`.
    - The widget DOM (single persistent instance, moved around rather than
      rebuilt on navigation).
    - Auto-save triggers (on pause; every 60s while running).
    - Inline DOM anchoring next to the Notion property value cell, with
      fallback to a fixed-position floating pill.
    - Bare-database-view / exclude-pattern detection to hide the widget
      entirely when no page is open.
    - Polls `location.href` every 500ms to detect Notion's client-side
      (History API) navigation, since it's an SPA and the content script
      isn't re-injected on route changes.
- **`background.js`** — the *only* piece that talks to the Notion API.
  Listens for `{ type: "NTS_SAVE_TIME", pageId, minutes }` messages,
  reads `notionToken`/`propertyName` from `chrome.storage.local`, and
  PATCHes `https://api.notion.com/v1/pages/{dashedPageId}` with
  `properties[propertyName].number = minutes`. Converts the 32-char hex
  page id to dashed UUID form (`toDashedId`) since that's what the API
  expects. Notion-Version header is pinned to `2022-06-28`.
- **`popup.html` / `popup.js`** — settings UI, all stored in
  `chrome.storage.local`:
    - `notionToken` — integration token (password field).
    - `propertyName` — target Number property name, default
      `"Time Spent (min)"`.
    - `excludePatterns` — array of strings, one per settings-textarea line.
      Plain text = substring match (case-insensitive) anywhere in the URL;
      a line wrapped in `/like this/` is used as a regex.
- **`SETUP.md`** — full walkthrough for a first-time user: create a Notion
  integration at notion.so/my-integrations, add a Number property to the
  database, share the database with the integration, configure the
  extension, how to use it day-to-day, and a "Notes & limitations" section
  documenting every heuristic's fragility.
- **`README.md`** — install-as-unpacked-extension instructions + file
  overview, points to SETUP.md for the Notion-side setup.

## Key design decisions worth knowing before changing things

- **Time semantics**: the Notion property is always **overwritten with the
  total elapsed minutes so far**, not incremented. This was a deliberate
  choice so Reset-then-retime stays accurate rather than double-counting.
- **Save is fully automatic** — no manual save button exists anymore (was
  explicitly removed per user request). Saves happen on pause and every
  60s while running.
- **Why the background script does the API call, not content.js**: keeps
  the integration token out of page-context JS, and avoids relying on
  Notion API CORS behavior from a content script.

## URL heuristics (the fragile/best-effort parts)

These are inferred from observing Notion's URL structure, not from any
documented API, and are flagged in SETUP.md as things that may break if
Notion changes their app:

- **Page id extraction** (`extractPageId` in `content.js`): takes *every*
  32-character hex substring in the full URL (path + query) and uses the
  **last** one. Rationale: a plain full-page URL has exactly one hex id
  (the page). A side-peek URL appends the peeked page's id later in the
  query string (after the view id), so "last occurring" correctly tracks
  whichever page is actually in focus. **User confirmed this works** for
  side peeks.
- **Bare database view detection** (`isBareDatabaseView`): parses the URL
  with `new URL()`, and treats it as "no page open" when there's a `v=`
  query param that looks like a 32-hex view id but **no** `p=` param (the
  peeked-page id). This is the automatic half of the most recent fix.
  **Not yet confirmed by the user.**
- **Exclude patterns**: manual backstop for the above — user-entered
  strings/regexes checked against the full URL in `matchesExcludePattern`.
  Takes precedence alongside the automatic check (either one hides the
  widget).
- **Inline anchor placement** (`findPropertyValueCell` /
  `walkUpForSibling`): searches for a DOM element whose trimmed text
  content exactly equals the configured property name (two passes: strict
  leaf-node match, then a looser match allowing a small wrapping element
  for an icon/span), then walks up to find a sibling element to treat as
  the "value cell," and inserts the widget right after it via
  `insertAdjacentElement("afterend", ...)`. Scoped to the last
  `[role="dialog"]` on the page when one exists (side peek), otherwise the
  whole document. Falls back to a fixed bottom-right floating pill if no
  anchor is found. This has **no guaranteed stability** — Notion's DOM
  structure is unobfuscated-by-us but also undocumented and can change
  between Notion releases.

If Notion changes their markup or URL structure in a way that breaks any
of the above, the fix is almost always localized to one function in
`content.js` — the rest of the architecture doesn't need to change.

## Known non-goals / things not implemented

- No drag-to-reposition for the floating fallback widget.
- No detection of *which* database a page belongs to — the widget will
  activate on any Notion page whose URL yields a page id, database task or
  not (mitigated by the exclude-list for cases where that's unwanted).
- No packaging for the Chrome Web Store (unpacked/developer-mode install
  only, per the "simple extension" framing of the original ask).
- No icon files (manifest omits `default_icon`; Chrome shows a generic
  puzzle-piece icon in the toolbar).

## Suggested next steps if resuming

1. Confirm the bare-database-view auto-hide actually works across the
   user's calendar/kanban/table views; adjust `isBareDatabaseView` if
   Notion's `v=`/`p=` param behavior doesn't match what was assumed.
2. If the user wants it distributed beyond their own machine, consider
   Chrome Web Store packaging (icons, store listing, privacy disclosures
   for the Notion API token).
3. If inline placement proves too fragile as Notion updates their UI,
   consider a more targeted approach (e.g., MutationObserver-based anchor
   re-acquisition, or scoping the search more tightly using ARIA
   attributes if Notion adds any).