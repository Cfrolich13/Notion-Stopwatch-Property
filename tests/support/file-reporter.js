// Writes a plain-text record of each run to tests/.runs/, named by time
// and by the extension version tested.

const fs = require("fs");
const path = require("path");
const { RUNS_DIR } = require("./paths");
const { resolveTarget } = require("./target");

const stripAnsi = (s) => s.replace(/\u001b\[[0-9;]*m/g, "");
const seconds = (ms) => `${(ms / 1000).toFixed(1)}s`;
const pad = (n) => String(n).padStart(2, "0");

class FileReporter {
  onBegin() {
    this.started = new Date();
    this.lines = [];
    this.counts = {};
    try {
      this.target = resolveTarget();
    } catch (err) {
      this.target = { slug: "unknown", label: err.message };
    }
  }

  onTestEnd(test, result) {
    this.counts[result.status] = (this.counts[result.status] || 0) + 1;
    const file = path.basename(test.location.file);
    this.lines.push(`${result.status.toUpperCase().padEnd(8)} ${file} › ${test.title} (${seconds(result.duration)})`);
    for (const error of result.errors) {
      const text = stripAnsi(error.message || error.stack || "").trim();
      this.lines.push(...text.split("\n").map((l) => `         ${l}`));
    }
  }

  onEnd(result) {
    const d = this.started;
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
    const summary = Object.entries(this.counts).map(([k, v]) => `${v} ${k}`).join(", ") || "no tests ran";
    const text = [
      `Run:       ${d.toString()}`,
      `Extension: ${this.target.label}`,
      `Result:    ${result.status} — ${summary} in ${seconds(result.duration)}`,
      "",
      ...this.lines,
      "",
    ].join("\n");
    fs.mkdirSync(RUNS_DIR, { recursive: true });
    const file = path.join(RUNS_DIR, `${stamp}_${this.target.slug}.txt`);
    fs.writeFileSync(file, text);
    console.log(`\nResults saved to ${path.relative(process.cwd(), file)}`);
  }
}

module.exports = FileReporter;
