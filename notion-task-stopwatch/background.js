// Notion Task Stopwatch — background service worker
// The only code that calls the Notion API, so the integration token never
// enters page context and we don't depend on Notion's CORS policy.

// Required header; responses follow this version. Only page GET/PATCH are
// used here, which no version since 2022-06-28 has broken.
const NOTION_VERSION = "2026-03-11";

// URLs carry undashed ids; the API expects dashed UUIDs.
function toDashedId(id) {
  if (id.includes("-")) return id;
  return id.replace(
    /^(.{8})(.{4})(.{4})(.{4})(.{12})$/,
    "$1-$2-$3-$4-$5"
  );
}

async function getNotionToken() {
  const { notionToken } = await chrome.storage.local.get("notionToken");
  if (!notionToken) {
    throw new Error("No Notion token set. Click the extension icon to add one.");
  }
  return notionToken;
}

async function patchPageProperties(pageId, propertiesPayload) {
  const notionToken = await getNotionToken();
  const dashedId = toDashedId(pageId);

  const res = await fetch(`https://api.notion.com/v1/pages/${dashedId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${notionToken}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_VERSION,
    },
    body: JSON.stringify({ properties: propertiesPayload }),
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

async function getPage(pageId) {
  const notionToken = await getNotionToken();
  const dashedId = toDashedId(pageId);

  const res = await fetch(`https://api.notion.com/v1/pages/${dashedId}`, {
    headers: {
      Authorization: `Bearer ${notionToken}`,
      "Notion-Version": NOTION_VERSION,
    },
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

  return data;
}

// Overwrites (never increments) with the running total, so Reset-then-retime
// can't double-count. Default name must match popup.js / content.js.
async function saveTimeToNotion(pageId, minutes) {
  const { propertyName } = await chrome.storage.local.get("propertyName");
  const prop = propertyName && propertyName.trim() ? propertyName.trim() : "Time Spent (min)";
  return patchPageProperties(pageId, { [prop]: { number: minutes } });
}

// GET first: the PATCH payload shape differs for Status vs. Select properties.
async function setStatusInProgress(pageId, statusPropertyName) {
  const page = await getPage(pageId);
  const prop = page.properties && page.properties[statusPropertyName];

  if (!prop) {
    throw new Error(`Status property "${statusPropertyName}" not found on this page.`);
  }

  let payload;
  if (prop.type === "status") {
    payload = { [statusPropertyName]: { status: { name: "In progress" } } };
  } else if (prop.type === "select") {
    payload = { [statusPropertyName]: { select: { name: "In progress" } } };
  } else {
    throw new Error(
      `Unsupported property type for auto status update: "${prop.type}".`
    );
  }

  return patchPageProperties(pageId, payload);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "NTS_SAVE_TIME") {
    saveTimeToNotion(msg.pageId, msg.minutes)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ error: err.message }));
    return true; // keep the message channel open for the async response
  }
  if (msg && msg.type === "NTS_SET_STATUS_IN_PROGRESS") {
    setStatusInProgress(msg.pageId, msg.statusPropertyName)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }
  return false;
});
