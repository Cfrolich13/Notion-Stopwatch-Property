// Settings popup. Everything persists to chrome.storage.local, which the
// content script watches via storage.onChanged — no reload needed.

const tokenInput = document.getElementById("token");
const propertyInput = document.getElementById("property");
const statusPropertyInput = document.getElementById("statusProperty");
const doneCheckboxPropertyInput = document.getElementById("doneCheckboxProperty");
const excludeInput = document.getElementById("exclude");
const saveBtn = document.getElementById("save");
const status = document.getElementById("status");

async function load() {
  const {
    notionToken,
    propertyName,
    statusPropertyName,
    doneCheckboxPropertyName,
    excludePatterns,
  } = await chrome.storage.local.get([
    "notionToken",
    "propertyName",
    "statusPropertyName",
    "doneCheckboxPropertyName",
    "excludePatterns",
  ]);
  if (notionToken) tokenInput.value = notionToken;
  propertyInput.value = propertyName || "Time Spent (min)";
  statusPropertyInput.value = statusPropertyName || "";
  doneCheckboxPropertyInput.value = doneCheckboxPropertyName || "";
  excludeInput.value = Array.isArray(excludePatterns) ? excludePatterns.join("\n") : "";
}

saveBtn.addEventListener("click", async () => {
  const notionToken = tokenInput.value.trim();
  const propertyName = propertyInput.value.trim() || "Time Spent (min)";
  // Empty = that automation is off.
  const statusPropertyName = statusPropertyInput.value.trim();
  const doneCheckboxPropertyName = doneCheckboxPropertyInput.value.trim();
  const excludePatterns = excludeInput.value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  await chrome.storage.local.set({
    notionToken,
    propertyName,
    statusPropertyName,
    doneCheckboxPropertyName,
    excludePatterns,
  });

  status.textContent = "Saved.";
  status.style.color = "#2f7d4f";
  setTimeout(() => (status.textContent = ""), 2000);
});

load();
