// Drives the Notion sandbox and reads the extension's state.
//
// Two tabs: the Notion page under test (kept in front so its timers aren't
// throttled) and the extension's own popup page, used only as a window
// into chrome.storage.local — the source of truth for timer state.

const { expect } = require("@playwright/test");

const TABLE = '[role="table"][aria-label="Page properties"]';
const CARD = '.notion-calendar-view a[role="link"]';
const SETTLE_MS = 1500; // must match content.js

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

class Sandbox {
  constructor(page, extPage, settings, cards) {
    this.page = page;
    this.extPage = extPage;
    this.settings = settings;
    // Page A and page B: the first two task cards on the calendar.
    this.a = cards[0].id;
    this.b = cards[1].id;
  }

  static async create(context, extensionId, url) {
    const extPage = await context.newPage();
    await extPage.goto(`chrome-extension://${extensionId}/popup.html`);
    const stored = await extPage.evaluate(() => chrome.storage.local.get(null));
    const settings = {
      hasToken: !!stored.notionToken,
      timeName: (stored.propertyName || "Time Spent (min)").trim(),
      statusName: (stored.statusPropertyName || "").trim(),
      doneName: (stored.doneCheckboxPropertyName || "").trim(),
    };
    if (!settings.hasToken || !settings.statusName || !settings.doneName) {
      throw new Error(
        "Extension settings are incomplete in the test profile (token, Status property and Done checkbox property are all needed). Run `npm run test:setup`."
      );
    }

    const page = await context.newPage();
    await page.goto(url);
    await page.bringToFront();
    try {
      await page.waitForFunction(
        (sel) => document.querySelectorAll(sel).length >= 2,
        CARD,
        { timeout: 30000 }
      );
    } catch (_) {
      throw new Error(
        `No calendar view with two task cards at ${page.url().split("?")[0]}. ` +
          "Either the test profile isn't logged in to Notion or the saved sandbox view is wrong. Run `npm run test:setup`."
      );
    }
    const cards = await page.evaluate((sel) => {
      const seen = new Set();
      const out = [];
      for (const a of document.querySelectorAll(sel)) {
        const m = (a.getAttribute("href") || "").split("?")[0].match(/[0-9a-f]{32}/gi);
        if (!m) continue;
        const id = m[m.length - 1].toLowerCase();
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({ id });
      }
      return out;
    }, CARD);

    const sandbox = new Sandbox(page, extPage, settings, cards);
    await sandbox.closePeek();
    return sandbox;
  }

  wait(ms) {
    return this.page.waitForTimeout(ms);
  }

  // ---------- extension state ----------

  async timerState(pageId) {
    const key = `nts_state_${pageId}`;
    const state = await this.extPage.evaluate(
      async (k) => (await chrome.storage.local.get(k))[k] || null,
      key
    );
    return state || { elapsedMs: 0, running: false, lastStartTs: null, lastAutoSaveAt: null };
  }

  async expectRunning(pageId, running, message, timeout = 5000) {
    await expect
      .poll(async () => (await this.timerState(pageId)).running, { message, timeout })
      .toBe(running);
  }

  get widget() {
    return this.page.locator("#nts-widget-root");
  }

  async toggle() {
    await this.widget.locator(".nts-toggle").click();
  }

  // ---------- navigation ----------

  // Scripted click: with a peek open, the cards are partly covered by it,
  // so a real mouse click can't reliably reach them. Returns immediately,
  // which the timing-sensitive tests rely on.
  async clickCard(pageId) {
    await this.page.evaluate(
      ({ sel, id }) => {
        const link = [...document.querySelectorAll(sel)].find((a) =>
          (a.getAttribute("href") || "").includes(id)
        );
        if (!link) throw new Error(`No calendar card for page ${id}`);
        link.click();
      },
      { sel: CARD, id: pageId }
    );
  }

  async peekId() {
    return this.page.evaluate(
      () => (location.href.match(/[?&]p=([0-9a-f]{32})/i) || [])[1] || null
    );
  }

  // Opens a page in the side peek and waits out the settle window, so
  // whatever the test does next counts as a change on an open page.
  async openPage(pageId, { settle = true } = {}) {
    if ((await this.peekId()) !== pageId) await this.clickCard(pageId);
    await this.page.waitForFunction(
      ({ id, table }) =>
        new RegExp(`[?&]p=${id}`, "i").test(location.href) && !!document.querySelector(table),
      { id: pageId, table: TABLE }
    );
    await expect(this.widget).toBeVisible();
    if (settle) await this.wait(SETTLE_MS + 1000);
  }

  async closePeek() {
    if (!(await this.peekId())) return;
    await this.page.keyboard.press("Escape");
    await this.page.waitForFunction(() => !/[?&]p=[0-9a-f]{32}/i.test(location.href));
  }

  // ---------- page properties ----------

  async readProps() {
    return this.page.evaluate(
      ({ table, s }) => {
        const t = [...document.querySelectorAll(table)].pop();
        if (!t) return null;
        const cell = (name) => {
          for (const row of t.querySelectorAll('[role="row"]')) {
            const cells = row.querySelectorAll('[role="cell"]');
            if (cells.length >= 2 && cells[0].textContent.trim() === name) return cells[1];
          }
          return null;
        };
        const status = cell(s.statusName);
        const done = cell(s.doneName);
        const time = cell(s.timeName);
        const box = done && done.querySelector("input[type=checkbox]");
        return {
          status: status ? status.textContent.trim() : null,
          done: box ? box.checked : null,
          time: time ? time.textContent.trim() : null,
        };
      },
      { table: TABLE, s: this.settings }
    );
  }

  row(name) {
    const label = this.page
      .locator('[role="cell"]')
      .filter({ hasText: new RegExp(`^\\s*${escapeRe(name)}\\s*$`) });
    return this.page.locator(TABLE).last().locator('[role="row"]').filter({ has: label });
  }

  valueCell(name) {
    return this.row(name).locator('[role="cell"]').nth(1);
  }

  get doneCheckbox() {
    return this.valueCell(this.settings.doneName).locator("input[type=checkbox]");
  }

  // Real mouse clicks, so the extension sees the same pointer events a
  // person would produce.
  async clickDone() {
    await this.doneCheckbox.click({ force: true });
  }

  async setDone(checked) {
    if ((await this.readProps()).done === checked) return;
    await this.clickDone();
    await expect.poll(async () => (await this.readProps()).done).toBe(checked);
  }

  async pickStatus(option) {
    const cell = this.valueCell(this.settings.statusName);
    const box = await cell.boundingBox();
    await cell.click({ position: { x: 24, y: box.height / 2 } });
    await this.page
      .locator(".notion-overlay-container")
      .locator('[role="option"], [role="menuitem"]')
      .filter({ hasText: new RegExp(`^\\s*${escapeRe(option)}\\s*$`) })
      .first()
      .click();
  }

  async setStatus(option) {
    if ((await this.readProps()).status === option) return;
    await this.pickStatus(option);
    await expect.poll(async () => (await this.readProps()).status).toBe(option);
  }

  // ---------- known starting state ----------

  async ensurePaused(pageId) {
    if (!(await this.timerState(pageId)).running) return;
    await this.openPage(pageId);
    await this.toggle();
    await this.expectRunning(pageId, false, "manual pause");
  }

  // Page A: given Status, Done unticked, timer paused.
  // Page B: given Status, timer paused.
  async prepare({ a = "In progress", b = "Done" } = {}) {
    for (const [pageId, status, untick] of [
      [this.b, b, false],
      [this.a, a, true],
    ]) {
      await this.openPage(pageId);
      await this.setStatus(status);
      if (untick) await this.setDone(false);
      await this.wait(1500); // let the extension react before pausing
      await this.ensurePaused(pageId);
    }
  }
}

module.exports = { Sandbox, SETTLE_MS };
