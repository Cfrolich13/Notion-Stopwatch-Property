// Notion Task Stopwatch — background service worker
// Handles the actual write to the Notion API so the content script never
// needs to hold the integration token in page context.

const NOTION_VERSION = "2022-06-28";

function toDashedId(id) {
  // Notion's API wants page ids in dashed UUID form.
  if (id.includes("-")) return id;
  return id.replace(
    /^(.{8})(.{4})(.{4})(.{4})(.{12})$/,
    "$1-$2-$3-$4-$5"
  );
}

async function saveTimeToNotion(pageId, minutes) {
  const { notionToken, propertyName } = await chrome.storage.local.get([
    "notionToken",
    "propertyName",
  ]);

  if (!notionToken) {
    throw new Error("No Notion token set. Click the extension icon to add one.");
  }

  const prop = propertyName && propertyName.trim() ? propertyName.trim() : "Time Spent (min)";
  const dashedId = toDashedId(pageId);

  const res = await fetch(`https://api.notion.com/v1/pages/${dashedId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${notionToken}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_VERSION,
    },
    body: JSON.stringify({
      properties: {
        [prop]: { number: minutes },
      },
    }),
  });

  let data = {};
  try {
    data = await res.json();
  } catch (_) {
    // ignore parse errors, handled below via res.ok
  }

  if (!res.ok) {
    const message =
      data && data.message
        ? data.message
        : `Notion API request failed (${res.status})`;
    throw new Error(message);
  }

  return { success: true };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "NTS_SAVE_TIME") {
    saveTimeToNotion(msg.pageId, msg.minutes)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ error: err.message }));
    return true; // keep the message channel open for the async response
  }
  return false;
});
