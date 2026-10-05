const path = require("path");
const fs = require("fs");

const EXTENSION_DIR = path.resolve(__dirname, "../../notion-task-stopwatch");
// Dedicated browser profile: keeps the Notion login and the extension's
// settings between runs. Git-ignored — it contains secrets.
const PROFILE_DIR = path.resolve(__dirname, "../.profile");
const LOCAL_FILE = path.resolve(__dirname, "../.local.json");
// Where an older commit's copy of the extension is unpacked for a run.
const STAGE_DIR = path.resolve(__dirname, "../.ext");
// One text file per test run.
const RUNS_DIR = path.resolve(__dirname, "../.runs");
const DEFAULT_URL = "https://app.notion.com/";

function readLocal() {
  try {
    return JSON.parse(fs.readFileSync(LOCAL_FILE, "utf8"));
  } catch (_) {
    return {};
  }
}

function writeLocal(data) {
  fs.writeFileSync(LOCAL_FILE, JSON.stringify(data, null, 2) + "\n");
}

// Same launch settings for setup and tests, so the profile stays readable
// by both (cookie encryption depends on the keychain flags Playwright sets).
function launchOptions(extensionDir = EXTENSION_DIR) {
  return {
    channel: "chromium",
    headless: false,
    viewport: { width: 1500, height: 850 },
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
    ],
  };
}

module.exports = {
  EXTENSION_DIR,
  PROFILE_DIR,
  LOCAL_FILE,
  STAGE_DIR,
  RUNS_DIR,
  DEFAULT_URL,
  readLocal,
  writeLocal,
  launchOptions,
};
