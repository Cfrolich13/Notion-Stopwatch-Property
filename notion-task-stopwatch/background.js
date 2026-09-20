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

async function saveTimeToNotion(pageId, minutes) {
  const { propertyName } = await chrome.storage.local.get("propertyName");
  const prop = propertyName && propertyName.trim() ? propertyName.trim() : "Time Spent (min)";
  return patchPageProperties(pageId, { [prop]: { number: minutes } });
}

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
