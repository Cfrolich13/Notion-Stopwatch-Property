// Test-only content script, loaded before content.js in the staged copy
// of the extension (see target.js). Both share one isolated world, so this
// can slow down content.js's timer-state reads: a page switch then lands
// mid-await on purpose instead of by luck. Off unless a test sets
// DELAY_KEY (from the extension page, via sandbox.setStorageDelay).

(function () {
  const DELAY_KEY = "nts_test_storage_delay_ms";
  const local = chrome.storage.local;
  const get = local.get.bind(local);
  let delayMs = 0;

  get(DELAY_KEY).then((v) => (delayMs = Number(v[DELAY_KEY]) || 0));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[DELAY_KEY]) delayMs = Number(changes[DELAY_KEY].newValue) || 0;
  });

  // Settings reads stay fast; only per-page state is held back. The value
  // is read before the wait, so the caller gets what was stored then.
  local.get = async (keys, ...rest) => {
    const result = await get(keys, ...rest);
    if (delayMs && typeof keys === "string" && keys.startsWith("nts_state_")) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
    return result;
  };
})();
