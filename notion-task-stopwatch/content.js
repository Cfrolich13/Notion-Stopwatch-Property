// Notion Task Stopwatch — content script
// Injects a compact stopwatch pill on Notion pages (including side peeks)
// and tracks elapsed time per page in chrome.storage.local. Saves
// automatically on pause and every 60s while running — no manual save.

(function () {
  let currentPageId = null;
  let propertyName = "Time Spent (min)";
  let excludePatterns = [];
  let widgetRoot = null;
  let els = {};

  const AUTO_SAVE_MS = 60 * 1000;

  // ---------- id / state helpers ----------

  function extractPageId(href) {
    // Grab every 32-char hex id in the URL (path + query) and use the
    // LAST one. In a normal full-page URL there's only one (the page).
    // When a side peek is open on top of a database/list view, Notion
    // appends the peeked page's id later in the URL (e.g. ...&p=<id>),
    // so the last match correctly tracks whichever page is in focus.
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
  });

  // ---------- database-view / exclude detection ----------

  function isBareDatabaseView(href) {
    // A database opened as a calendar/kanban/table/list/gallery view (no
    // page open) carries a view id ("v=...") but no peeked-page id
    // ("p=..."). If we see a view id with no peek id, no page is actually
    // open, so there's nothing to time.
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
    const state = await loadState(currentPageId);
    if (state.running) {
      state.elapsedMs += Date.now() - state.lastStartTs;
      state.running = false;
      state.lastStartTs = null;
      await saveState(currentPageId, state);
      await render();
      await pushToNotion(state.elapsedMs);
    } else {
      state.running = true;
      state.lastStartTs = Date.now();
      if (!state.lastAutoSaveAt) state.lastAutoSaveAt = Date.now();
      await saveState(currentPageId, state);
      await render();
    }
  }

  async function onReset() {
    const ok = confirm(
      "Reset the timer for this task to 00:00? This does not change what's already saved in Notion until you start/pause again."
    );
    if (!ok) return;
    const state = {
      elapsedMs: 0,
      running: false,
      lastStartTs: null,
      lastAutoSaveAt: null,
    };
    await saveState(currentPageId, state);
    await render();
  }

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

  // ---------- inline placement next to the Notion property ----------

  function getPeekContainer() {
    // A side peek renders as an overlay dialog; scope the search to it so
    // we don't accidentally match a same-named property/column elsewhere
    // on the underlying page.
    const dialogs = document.querySelectorAll('[role="dialog"]');
    return dialogs.length ? dialogs[dialogs.length - 1] : null;
  }

  function isVisible(el) {
    if (!el || !el.getClientRects().length) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function findPropertyValueCell(name) {
    const scope = getPeekContainer() || document;
    const candidates = scope.querySelectorAll("div, span");

    // Pass 1: strict leaf-node text match.
    for (const el of candidates) {
      if (
        el.childElementCount === 0 &&
        el.textContent.trim() === name &&
        isVisible(el)
      ) {
        const cell = walkUpForSibling(el);
        if (cell) return cell;
      }
    }
    // Pass 2: looser match allowing a wrapping icon/span.
    for (const el of candidates) {
      if (
        el.childElementCount <= 2 &&
        el.textContent.trim() === name &&
        isVisible(el)
      ) {
        const cell = walkUpForSibling(el);
        if (cell) return cell;
      }
    }
    return null;
  }

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

  function placeWidget() {
    if (!widgetRoot || !currentPageId) return;
    const anchor = findPropertyValueCell(propertyName);

    if (anchor) {
      // Avoid re-inserting on every tick if we're already positioned there.
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

  // Poll for URL changes (covers normal navigation, side peeks opening on
  // top of a database view, and side peeks closing) since Notion is a
  // client-rendered SPA using the History API.
  let lastHref = "";
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      onUrlChanged();
    }
  }, 500);

  // Main tick: updates the displayed time, triggers the once-a-minute
  // auto-save while running, and keeps the widget anchored inline as
  // Notion re-renders its DOM around it.
  setInterval(async () => {
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
  }, 1000);

  onUrlChanged();
})();
