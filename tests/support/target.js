// Which version of the extension a run tests. By default the working
// tree; with NTS_EXTENSION_REF=<commit> the extension folder as it was at
// that commit. Either way it's copied to a staging folder, so the checkout
// (and the tests themselves) stay as they are and the test-only
// slow-storage shim can be added.

const fs = require("fs");
const path = require("path");
const { execFileSync, execSync } = require("child_process");
const { STAGE_DIR, EXTENSION_DIR } = require("./paths");

const REPO = path.resolve(__dirname, "../..");
const FOLDER = "notion-task-stopwatch";
const git = (...args) => execFileSync("git", args, { cwd: REPO, encoding: "utf8" }).trim();

function resolveTarget() {
  const ref = (process.env.NTS_EXTENSION_REF || "").trim();
  if (!ref) {
    const dirty = git("status", "--porcelain", "--", FOLDER) !== "";
    const head = git("rev-parse", "--short", "HEAD");
    return {
      sha: null,
      slug: "working-tree",
      label: `working tree (HEAD ${head}${dirty ? ", with uncommitted extension changes" : ""})`,
    };
  }
  let sha;
  try {
    sha = git("rev-parse", "--verify", "--short", `${ref}^{commit}`);
  } catch (_) {
    throw new Error(`NTS_EXTENSION_REF="${ref}" is not a commit in this repo.`);
  }
  return { sha, slug: sha, label: `commit ${sha} "${git("log", "-1", "--format=%s", sha)}"` };
}

// sha null stages the working tree, uncommitted changes included.
function stageExtension(sha) {
  fs.rmSync(STAGE_DIR, { recursive: true, force: true });
  if (sha) {
    fs.mkdirSync(STAGE_DIR, { recursive: true });
    try {
      execSync(`git archive ${sha} ${FOLDER} | tar -x -C "${STAGE_DIR}" --strip-components=1`, {
        cwd: REPO,
        stdio: "pipe",
        shell: "/bin/bash",
      });
    } catch (_) {}
  } else {
    fs.cpSync(EXTENSION_DIR, STAGE_DIR, { recursive: true });
  }
  const manifestPath = path.join(STAGE_DIR, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Commit ${sha} has no ${FOLDER}/manifest.json to test.`);
  }

  fs.copyFileSync(path.join(__dirname, "slow-storage.js"), path.join(STAGE_DIR, "slow-storage.js"));
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.content_scripts[0].js.unshift("slow-storage.js");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  return STAGE_DIR;
}

module.exports = { resolveTarget, stageExtension };
