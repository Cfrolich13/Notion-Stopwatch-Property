const tokenInput = document.getElementById("token");
const propertyInput = document.getElementById("property");
const excludeInput = document.getElementById("exclude");
const saveBtn = document.getElementById("save");
const status = document.getElementById("status");

async function load() {
  const { notionToken, propertyName, excludePatterns } = await chrome.storage.local.get([
    "notionToken",
    "propertyName",
    "excludePatterns",
  ]);
  if (notionToken) tokenInput.value = notionToken;
  propertyInput.value = propertyName || "Time Spent (min)";
  excludeInput.value = Array.isArray(excludePatterns) ? excludePatterns.join("\n") : "";
}

saveBtn.addEventListener("click", async () => {
  const notionToken = tokenInput.value.trim();
  const propertyName = propertyInput.value.trim() || "Time Spent (min)";
  const excludePatterns = excludeInput.value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  await chrome.storage.local.set({ notionToken, propertyName, excludePatterns });

  status.textContent = "Saved.";
  status.style.color = "#2f7d4f";
  setTimeout(() => (status.textContent = ""), 2000);
});

load();
