# Setup Guide — Notion Task Stopwatch

This extension needs a **Notion integration token** so it's allowed to write
the elapsed time back to your database. This is a one-time setup.

## 1. Create a Notion integration

1. Go to https://www.notion.so/my-integrations
2. Click **"+ New integration"**.
3. Give it a name (e.g. "Task Stopwatch"), pick the workspace it should
   belong to, and click **Submit**.
4. On the next screen, copy the **Internal Integration Secret** — it starts
   with `secret_` (or `ntn_` on newer workspaces). You'll paste this into the
   extension in step 4.

## 2. Add a Number property to your task database

1. Open your Notion task database.
2. Add a new property (top-right **+** in the table header).
3. Set its type to **Number**.
4. Name it something clear, e.g. `Time Spent (min)`. Under the property's
   **Number format** settings, you can optionally show 2 decimal places.
5. Remember the exact name — you'll need to type it identically into the
   extension.

## 3. Share the database with your integration

Notion integrations can only see what you explicitly share with them.

1. Open your task database as a full page.
2. Click the **"···"** menu in the top-right corner.
3. Choose **"Connections"** (or "Add connections") → find and select the
   integration you created in step 1.

## 4. Configure the extension

1. Click the extension's icon in Chrome's toolbar.
2. Paste your integration token into **"Notion integration token"**.
3. Type the exact property name from step 2 into **"Database property
   name"** (defaults to `Time Spent (min)`).
4. Optionally, type the exact name of your **Status** property (native
   Status or Select type) into **"Status property name"**, and/or your
   **Done** checkbox property's name into **"Done checkbox property
   name"** — see "Automatic start/pause from Status" below. Both are
   blank/disabled by default.
5. Click **Save settings**.

## 5. Use it

1. Open any task page inside that database — a full page, or a row opened
   as a **side peek** — the URL will contain a 32-character page id either
   way.
2. A compact pill appears, e.g. `03:27 ▶ ↺`, ideally right next to the
   property it saves to. If that property row isn't visible or can't be
   found on the page, it falls back to a floating pill in the bottom-right
   corner.
3. Tap **▶** to start timing. It becomes **⏸**; tap it again to pause —
   pausing saves automatically. Start again anytime to resume; time
   accumulates across as many start/pause cycles as you like.
4. While running, the time is also **saved automatically once a minute**
   — you don't need to pause to keep Notion in sync.
5. **↺** resets the timer for that page to 00:00 (useful when starting a
   new task or after you've recorded the time and want to start fresh).
6. The small dot next to the icons briefly turns blue while saving, green
   once saved, and red if something went wrong (hover it for details).

## Automatic start/pause from Status (optional)

If you fill in **"Status property name"** and/or **"Done checkbox
property name"** in the settings popup:

- Changing that Status property's value to **"In progress"** in Notion
  starts the stopwatch automatically.
- Starting the stopwatch manually (tapping ▶) while Status currently
  reads **"Not started"** writes `Status = "In progress"` back to Notion,
  so the two stay in sync however you start a task.
- Changing Status to **"Done"**, or checking the **Done** checkbox
  (if configured), pauses the stopwatch automatically.

This only reacts to a value actually *changing* while the page is open —
opening a task that's already "In progress" won't force-start the timer.
Both settings are independent and optional; leave either blank to skip
that behavior.

## Notes & limitations

- The widget appears on any `notion.so` / `app.notion.com` page you open
  (the extension can't reliably tell which database a page belongs to
  without extra API calls). It's harmless to leave alone on pages you
  don't want to time.
- **Inline placement** works by searching the page for text matching your
  property name and anchoring next to it. Notion doesn't publish a stable
  DOM structure for this, so it's a best-effort match — if Notion changes
  their layout, or the property isn't visible on screen (e.g. hidden or
  scrolled out of the properties list), the widget falls back to the
  floating corner pill automatically.
- Side peeks are detected via the page id embedded in the URL when a peek
  is open; if a future Notion update changes how that URL is built, side
  peek detection may need revisiting.
- The widget hides itself automatically on a bare database view (calendar,
  kanban, table, list, gallery) where no page is actually open, since
  there's nothing to time there. This is detected from the URL and, like
  the other DOM-based heuristics here, is best-effort. If it ever shows up
  somewhere it shouldn't, add that URL (or part of it) to **"Exclude
  URLs"** in the settings popup — one entry per line, plain text matches
  anywhere in the URL, or wrap a line in `/like this/` to use it as a
  regular expression.
- Time is saved as **total minutes so far** (overwriting the property each
  time), not added on top of whatever was already there — so it stays in
  sync even if you Reset and re-time a task.
- If you ever revoke or rotate the integration token, just paste the new
  one into the popup.
- **Done-checkbox detection** (if you configure it) reads the live
  `.checked` property of Notion's underlying `<input type="checkbox">`,
  and only searches within the currently open page's own property panel
  (confirmed on a full page; a side-peek-specific scoping bug was found
  and fixed but not yet re-confirmed live).
- Status/Select value matching is case-insensitive but exact otherwise —
  it expects the literal words "Not started", "In progress", and "Done"
  (Notion's default Status template). A relabeled Status property with
  different option names won't be recognized.
