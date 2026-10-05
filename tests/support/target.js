// Which version of the extension a run tests. By default the working
// tree; with NTS_EXTENSION_REF=<commit> the extension folder as it was at
// that commit, unpacked to a staging folder so the checkout (and the
// tests themselves) stay as they are.

const fs = require("fs");
const path = require("path");
const { execFileSync, execSync } = require("child_process");
const { STAGE_DIR } = require("./paths");

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

function stageExtension(sha) {
  fs.rmSync(STAGE_DIR, { recursive: true, force: true });
  fs.mkdirSync(STAGE_DIR, { recursive: true });
  try {
    execSync(`git archive ${sha} ${FOLDER} | tar -x -C "${STAGE_DIR}" --strip-components=1`, {
      cwd: REPO,
      stdio: "pipe",
      shell: "/bin/bash",
    });
  } catch (_) {}
  if (!fs.existsSync(path.join(STAGE_DIR, "manifest.json"))) {
    throw new Error(`Commit ${sha} has no ${FOLDER}/manifest.json to test.`);
  }
  return STAGE_DIR;
}

module.exports = { resolveTarget, stageExtension };
