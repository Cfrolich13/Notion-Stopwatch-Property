// Notion Task Stopwatch — content script
// Injects a compact stopwatch pill on Notion pages (including side peeks)
// and tracks elapsed time per page in chrome.storage.local. Saves
// automatically on pause and every 60s while running — no manual save.

(function () {
  let currentPageId = null;
  let propertyName = "Time Spent (min)";
  let statusPropertyName = "";
  let doneCheckboxPropertyName = "";
  let excludePatterns = [];
  let widgetRoot = null;
  let els = {};

  // Baseline for edge-triggered Status/Done detection; reset to null on
  // page activation and on settings changes so the first DOM read after
  // either isn't mistaken for a live transition.
  let lastObservedStatus = null;
  let lastObservedDoneChecked = null;

  const AUTO_SAVE_MS = 60 * 1000;

  // ---------- id / state helpers ----------

  function extractPageId(href) {
    // Use the LAST 32-hex id in the URL: a side peek appends its page id
    // after the underlying view's (…&p=<id>), so last = page in focus.
    const matches = [...href.matchAll(/[0-9a-fA-F]{32}/g)];
    if (matches.length === 0) return null;
    return matches[matches.length - 1][0].toLowerCase();
  }

  function formatDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }

  // Storage (not in-memory state) is the source of truth, so every read
  // goes through loadState — keeps multiple tabs on the same page in sync.
  function storageKey(pageId) {
    return `nts_state_${pageId}`;
  }

  async function loadState(pageId) {
    const data = await chrome.storage.local.get(storageKey(pageId));
    return (
      data[storageKey(pageId)] || {
        elapsedMs: 0,
        running: false,
        lastStartTs: null,
        lastAutoSaveAt: null,
      }
    );
  }

  async function saveState(pageId, state) {
    await chrome.storage.local.set({ [storageKey(pageId)]: state });
  }

  function currentElapsedMs(state) {
    if (state.running && state.lastStartTs) {
      return state.elapsedMs + (Date.now() - state.lastStartTs);
    }
    return state.elapsedMs;
  }

  async function refreshPropertyName() {
    const { propertyName: stored } = await chrome.storage.local.get("propertyName");
    propertyName = stored && stored.trim() ? stored.trim() : "Time Spent (min)";
  }

  async function refreshExcludePatterns() {
    const { excludePatterns: stored } = await chrome.storage.local.get("excludePatterns");
    excludePatterns = Array.isArray(stored) ? stored : [];
  }

  async function refreshStatusSettings() {
    const { statusPropertyName: status, doneCheckboxPropertyName: done } =
      await chrome.storage.local.get(["statusPropertyName", "doneCheckboxPropertyName"]);
    statusPropertyName = status && status.trim() ? status.trim() : "";
    doneCheckboxPropertyName = done && done.trim() ? done.trim() : "";
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.propertyName) {
      propertyName = changes.propertyName.newValue || "Time Spent (min)";
    }
    if (changes.excludePatterns) {
      excludePatterns = Array.isArray(changes.excludePatterns.newValue)
        ? changes.excludePatterns.newValue
        : [];
      onUrlChanged(); // re-evaluate the current page against the new list
    }
    // A different property means a different value; re-baseline so the
    // switch itself isn't read as a transition.
    if (changes.statusPropertyName) {
      statusPropertyName = changes.statusPropertyName.newValue || "";
      lastObservedStatus = null;
    }
    if (changes.doneCheckboxPropertyName) {
      doneCheckboxPropertyName = changes.doneCheckboxPropertyName.newValue || "";
      lastObservedDoneChecked = null;
    }
  });

  // ---------- database-view / exclude detection ----------

  function isBareDatabaseView(href) {
    // A view id (v=) with no peeked-page id (p=) means a database view is
    // showing with no page open — nothing to time.
    try {
      const u = new URL(href);
      const hex32 = /^[0-9a-fA-F]{32}$/;
      const hasView = hex32.test(u.searchParams.get("v") || "");
      const hasPeek = hex32.test(u.searchParams.get("p") || "");
      return hasView && !hasPeek;
    } catch (_) {
      return false;
    }
  }

  // Patterns are case-insensitive substrings, or regexes when wrapped in /…/.
  function matchesExcludePattern(href) {
    return excludePatterns.some((raw) => {
      const pattern = (raw || "").trim();
      if (!pattern) return false;
      if (pattern.length > 1 && pattern.startsWith("/") && pattern.endsWith("/")) {
        try {
          return new RegExp(pattern.slice(1, -1), "i").test(href);
        } catch (_) {
          return false;
        }
      }
      return href.toLowerCase().includes(pattern.toLowerCase());
    });
  }

  // ---------- widget ----------

  function buildWidget() {
    const root = document.createElement("div");
    root.id = "nts-widget-root";
    root.className = "nts-floating"; // default until we can place it inline
    root.innerHTML = `
      <span class="nts-time">00:00</span>
      <button class="nts-toggle" title="Start">▶</button>
      <button class="nts-reset" title="Reset">↺</button>
      <span class="nts-dot" title=""></span>
    `;
    // Outside <body> so Notion's React re-renders can't wipe it out.
    document.documentElement.appendChild(root);

    els = {
      time: root.querySelector(".nts-time"),
      toggle: root.querySelector(".nts-toggle"),
      reset: root.querySelector(".nts-reset"),
      dot: root.querySelector(".nts-dot"),
    };

    els.toggle.addEventListener("click", onToggle);
    els.reset.addEventListener("click", onReset);

    return root;
  }

  function setDot(kind, title) {
    // kind: '' | 'saving' | 'saved' | 'error'
    els.dot.className = "nts-dot" + (kind ? ` nts-dot-${kind}` : "");
    els.dot.title = title || "";
    // Terminal states fade after a few seconds; "saving" stays until resolved.
    if (kind === "saved" || kind === "error") {
      clearTimeout(setDot._t);
      setDot._t = setTimeout(() => {
        els.dot.className = "nts-dot";
        els.dot.title = "";
      }, 4000);
    }
  }

  async function render() {
    if (!currentPageId || !widgetRoot) return;
    const state = await loadState(currentPageId);
    els.time.textContent = formatDuration(currentElapsedMs(state));
    els.toggle.textContent = state.running ? "⏸" : "▶";
    els.toggle.title = state.running ? "Pause (saves automatically)" : "Start";
  }

  // ---------- actions ----------

  async function onToggle() {
    if (!isContextValid()) {
      alert("This page needs to be refreshed after an extension update.");
      return;
    }
    const state = await loadState(currentPageId);
    if (state.running) {
      await pauseTimer();
    } else {
      await startTimer();
    }
  }

  async function startTimer() {
    const state = await loadState(currentPageId);
    if (state.running) return;
    state.running = true;
    state.lastStartTs = Date.now();
    if (!state.lastAutoSaveAt) state.lastAutoSaveAt = Date.now(); // first auto-save 60s from now
    await saveState(currentPageId, state);
    await render();

    // Manual start on a "Not started" task moves it to "In progress".
    if (statusPropertyName) {
      const cell = findPropertyValueCell(statusPropertyName);
      const text = cell ? cell.textContent.trim().toLowerCase() : null;
      if (text === "not started") {
        // Pre-set the baseline so our own write isn't seen as a transition.
        lastObservedStatus = "in progress";
        pushStatusInProgress();
      }
    }
  }

  async function pauseTimer() {
    const state = await loadState(currentPageId);
    if (!state.running) return;
    state.elapsedMs += Date.now() - state.lastStartTs;
    state.running = false;
    state.lastStartTs = null;
    await saveState(currentPageId, state);
    await render();
    await pushToNotion(state.elapsedMs); // every pause saves
  }

  async function onReset() {
    if (!isContextValid()) {
      alert("This page needs to be refreshed after an extension update.");
      return;
    }
    const ok = confirm(
      "Reset the timer for this task to 00:00? This does not change what's already saved in Notion until you start/pause again."
    );
    if (!ok) return;
    // Local-only: Notion keeps the old value until the next save overwrites it.
    const state = {
      elapsedMs: 0,
      running: false,
      lastStartTs: null,
      lastAutoSaveAt: null,
    };
    await saveState(currentPageId, state);
    await render();
  }

  // Sends the running total (not a delta) — background overwrites the property.
  async function pushToNotion(elapsedMs) {
    const minutes = Math.round((elapsedMs / 60000) * 100) / 100;
    setDot("saving", "Saving…");
    try {
      const response = await chrome.runtime.sendMessage({
        type: "NTS_SAVE_TIME",
        pageId: currentPageId,
        minutes,
      });
      if (response && response.error) {
        setDot("error", `Error: ${response.error}`);
      } else {
        setDot("saved", `Saved ${minutes} min to Notion`);
      }
    } catch (err) {
      setDot("error", `Error: ${err.message}`);
    }
  }

  async function pushStatusInProgress() {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "NTS_SET_STATUS_IN_PROGRESS",
        pageId: currentPageId,
        statusPropertyName,
      });
      if (response && response.error) {
        console.error("Notion Task Stopwatch: failed to set Status", response.error);
      }
    } catch (err) {
      console.error("Notion Task Stopwatch: failed to set Status", err.message);
    }
  }

  // ---------- Status / Done watching ----------

  function readCheckboxState(cell) {
    // Must read the live `.checked` property: the `checked` attribute is
    // only the initial default and never updates on toggle.
    const input = cell.matches("input[type=checkbox]")
      ? cell
      : cell.querySelector("input[type=checkbox]");
    if (input) return input.checked;

    // Fallback in case Notion ever renders a non-<input> checkbox.
    const el = cell.hasAttribute("aria-checked") ? cell : cell.querySelector("[aria-checked]");
    if (!el) return null;
    return el.getAttribute("aria-checked") === "true";
  }

  // Edge-triggered: acts only when a value *changes* from a known previous
  // reading (prev !== null), so opening an already-"In progress" task
  // doesn't force-start the timer.
  async function checkStatusTransitions() {
    if (!currentPageId) return;

    if (statusPropertyName) {
      const cell = findPropertyValueCell(statusPropertyName);
      const text = cell ? cell.textContent.trim().toLowerCase() : null;
      if (text !== null && text !== lastObservedStatus) {
        const prev = lastObservedStatus;
        lastObservedStatus = text;
        if (prev !== null) {
          if (text === "in progress") await startTimer();
          else if (text === "done") await pauseTimer();
        }
      }
    }

    if (doneCheckboxPropertyName) {
      const cell = findPropertyValueCell(doneCheckboxPropertyName);
      const checked = cell ? readCheckboxState(cell) : null;
      if (checked !== null && checked !== lastObservedDoneChecked) {
        const prev = lastObservedDoneChecked;
        lastObservedDoneChecked = checked;
        if (prev !== null && checked === true) await pauseTimer();
      }
    }
  }

  // ---------- inline placement next to the Notion property ----------

  function getPropertiesScope() {
    // Scope lookups to the open page's properties table so a same-named
    // column on a database view behind a side peek can't match. With
    // several tables (peek over a full page), the last one is on top.
    // Side peeks have no [role="dialog"] (verified in DevTools); it's only
    // a fallback in case some Notion layout uses one.
    const tables = document.querySelectorAll(
      '[role="table"][aria-label="Page properties"]'
    );
    if (tables.length) return tables[tables.length - 1];
    const dialogs = document.querySelectorAll('[role="dialog"]');
    return dialogs.length ? dialogs[dialogs.length - 1] : null;
  }

  function isVisible(el) {
    if (!el || !el.getClientRects().length) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isPropertyLabelText(el) {
    // A value can match another property's name (e.g. Status option "Done"
    // vs. a "Done" checkbox). Only real label cells carry aria-haspopup
    // (they open the property editor), so require it.
    const cell = el.closest('[role="cell"]');
    return !!cell && cell.hasAttribute("aria-haspopup");
  }

  function findPropertyValueCell(name) {
    const scope = getPropertiesScope() || document;
    const candidates = scope.querySelectorAll("div, span");

    // Pass 1: strict leaf-node text match.
    for (const el of candidates) {
      if (
        el.childElementCount === 0 &&
        el.textContent.trim() === name &&
        isVisible(el) &&
        isPropertyLabelText(el)
      ) {
        const cell = findValueCellForLabel(el);
        if (cell) return cell;
      }
    }
    // Pass 2: looser match allowing a wrapping icon/span.
    for (const el of candidates) {
      if (
        el.childElementCount <= 2 &&
        el.textContent.trim() === name &&
        isVisible(el) &&
        isPropertyLabelText(el)
      ) {
        const cell = findValueCellForLabel(el);
        if (cell) return cell;
      }
    }
    return null;
  }

  function findValueCellForLabel(nameEl) {
    // Each property is a [role="row"] with a label cell and a value cell.
    // Using the ARIA row beats walking a fixed number of ancestors, since
    // label nesting depth varies by property type (e.g. checkboxes).
    const row = nameEl.closest('[role="row"]');
    if (row) {
      const cells = row.querySelectorAll('[role="cell"]');
      for (const cell of cells) {
        if (!cell.contains(nameEl) && isVisible(cell)) {
          return cell;
        }
      }
    }
    return walkUpForSibling(nameEl);
  }

  // Fallback for layouts without ARIA rows: nearest visible next sibling
  // within a few ancestor levels.
  function walkUpForSibling(nameEl) {
    let node = nameEl;
    let depth = 0;
    while (node && depth < 5) {
      if (node.nextElementSibling && isVisible(node.nextElementSibling)) {
        return node.nextElementSibling;
      }
      node = node.parentElement;
      depth++;
    }
    return null;
  }

  // Called every tick, since Notion re-renders and can detach the widget.
  function placeWidget() {
    if (!widgetRoot || !currentPageId) return;
    const anchor = findPropertyValueCell(propertyName);

    if (anchor) {
      // Skip DOM moves when already in place, to avoid churn every tick.
      if (widgetRoot.previousElementSibling !== anchor || !anchor.parentElement) {
        anchor.insertAdjacentElement("afterend", widgetRoot);
      }
      if (widgetRoot.className !== "nts-inline") {
        widgetRoot.className = "nts-inline";
      }
    } else if (widgetRoot.className !== "nts-floating") {
      widgetRoot.className = "nts-floating";
      document.documentElement.appendChild(widgetRoot);
    }
  }

  // ---------- lifecycle / SPA + side-peek navigation ----------

  async function activatePage(pageId) {
    currentPageId = pageId;
    await refreshPropertyName();
    await refreshStatusSettings();
    // New page: first Status/Done read is a baseline, not a transition.
    lastObservedStatus = null;
    lastObservedDoneChecked = null;
    if (!widgetRoot) widgetRoot = buildWidget();
    widgetRoot.style.display = "";
    await render();
    placeWidget();
  }

  function deactivate() {
    currentPageId = null;
    if (widgetRoot) widgetRoot.style.display = "none";
  }

  async function onUrlChanged() {
    const href = location.href;
    await refreshExcludePatterns();

    if (isBareDatabaseView(href) || matchesExcludePattern(href)) {
      deactivate();
      return;
    }

    const pageId = extractPageId(href);
    if (!pageId) {
      deactivate();
      return;
    }
    if (pageId !== currentPageId) {
      await activatePage(pageId);
    }
  }

  // False once the extension is reloaded/updated under a still-open tab:
  // chrome.* calls then throw "Extension context invalidated", so callers
  // bail out instead of spamming errors. A page refresh reconnects.
  function isContextValid() {
    return !!(chrome.runtime && chrome.runtime.id);
  }

  // Poll the URL: Notion navigates via the History API (including side
  // peeks opening/closing), which fires no event a content script can hook.
  let lastHref = "";
  const urlPollId = setInterval(() => {
    if (!isContextValid()) {
      clearInterval(urlPollId);
      return;
    }
    if (location.href !== lastHref) {
      lastHref = location.href;
      onUrlChanged();
    }
  }, 500);

  // Main tick: redraws the time, runs the 60s auto-save, re-anchors the
  // widget, and checks Status/Done transitions.
  const mainTickId = setInterval(async () => {
    if (!isContextValid()) {
      clearInterval(mainTickId);
      return;
    }
    if (!currentPageId) return;
    const state = await loadState(currentPageId);
    if (state.running) {
      els.time.textContent = formatDuration(currentElapsedMs(state));
      if (Date.now() - (state.lastAutoSaveAt || 0) >= AUTO_SAVE_MS) {
        state.lastAutoSaveAt = Date.now();
        await saveState(currentPageId, state);
        await pushToNotion(currentElapsedMs(state));
      }
    }
    placeWidget();
    await checkStatusTransitions();
  }, 1000);

  onUrlChanged();
})();
