// Runs one family of checkers over the dataset and writes results/<name>.jsonl.
// Rule-based and library checkers run on every item (the dev half tunes the heuristic); judges run on the test half only.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT, loadDataset, readJsonl, strip, hasTarget } from "./common.mjs";
import { RATIO_THRESHOLDS, RATIO_MIN_LENGTHS, KANA_SHARE_THRESHOLDS, ratio, kanaShare, kanaPresence, ratioName, kanaShareName } from "./checkers.mjs";
import { JUDGES } from "./judges.mjs";

const USAGE = "usage: node run.mjs <rules|franc|tinyld|fasttext|judge> [--split all|test] [--minidle 0.75] [--limit N] [--missing true]\n  --missing true: a judge run that skips the ids already in its results file and appends the rest";
const wanted = fs.readFileSync(path.join(ROOT, ".node-version"), "utf8").trim();
if (process.version !== `v${wanted}`) {
  console.error(`this runner needs Node ${wanted} (.node-version), running on ${process.version}`);
  process.exit(1);
}

const name = process.argv[2];
const opt = { split: undefined, minidle: "0.75", limit: undefined, missing: undefined };
for (let i = 3; i < process.argv.length; i += 2) opt[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
if (!name) { console.error(USAGE); process.exit(1); }
const isJudge = name in JUDGES;
const split = opt.split ?? (isJudge ? "test" : "all");

const cpuTimes = () => os.cpus().reduce((a, c) => ({ idle: a.idle + c.times.idle, all: a.all + Object.values(c.times).reduce((x, y) => x + y, 0) }), { idle: 0, all: 0 });
async function idleShare() {
  const a = cpuTimes();
  await new Promise((r) => setTimeout(r, 1000));
  const b = cpuTimes();
  return (b.idle - a.idle) / (b.all - a.all);
}
async function waitQuiet() {
  for (let i = 0; i < 120; i++) {
    const idle = await idleShare();
    if (idle >= Number(opt.minidle)) return idle;
  }
  throw new Error(`the machine never reached ${opt.minidle} idle in 120 s`);
}

const out = path.join(ROOT, "results", `${name.replace(/[:+]/g, "_")}.jsonl`);
const earlier = opt.missing ? readJsonl(out) : [];
const done = new Set(earlier.filter((r) => r.kind === "row").map((r) => r.id));

let items = loadDataset().filter((r) => r.label !== "none" && (split === "all" || r.split === split) && !done.has(r.id));
if (opt.limit) items = items.slice(0, Number(opt.limit));
const prepared = items.map((r) => ({ ...r, stripped: strip(r.text) })).filter((r) => hasTarget(r.stripped));

const lines = [];
const idleBefore = await waitQuiet();
const meta = { kind: "meta", checker: name, node: process.version, date: new Date().toISOString().slice(0, 10), idleBefore: Number(idleBefore.toFixed(3)), split, items: prepared.length, platform: `${os.platform()} ${os.arch()}` };
const row = (k, r, pred, ms, extra = {}) => lines.push({ kind: "row", k, id: r.id, pred, ms: Number(ms.toFixed(4)), ...extra });
const time = (fn) => { const t0 = performance.now(); const v = fn(); return [v, performance.now() - t0]; };

if (name === "rules") {
  for (const r of prepared) {
    for (const [suffix, text] of [["", r.stripped], ["-raw", r.text]]) {
      for (const t of RATIO_THRESHOLDS) for (const m of RATIO_MIN_LENGTHS) {
        const [p, ms] = time(() => ratio(text, t, m));
        row(ratioName(t, m) + suffix, r, p, ms);
      }
      for (const t of KANA_SHARE_THRESHOLDS) for (const m of RATIO_MIN_LENGTHS) {
        const [p, ms] = time(() => kanaShare(text, t, m));
        row(kanaShareName(t, m) + suffix, r, p, ms);
      }
      const [p, ms] = time(() => kanaPresence(text));
      row("kana" + suffix, r, p, ms);
    }
  }
  meta.versions = { node: process.version };
} else if (name === "franc") {
  const { franc } = await import("franc");
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, "node_modules/franc/package.json"), "utf8")).version;
  for (const r of prepared) {
    const [code, ms] = time(() => franc(r.stripped));
    row("franc", r, code === "jpn" ? "ja" : code === "und" ? "undetermined" : "other", ms, { label: code });
  }
  meta.versions = { franc: version };
} else if (name === "tinyld") {
  const { detect } = await import("tinyld");
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, "node_modules/tinyld/package.json"), "utf8")).version;
  for (const r of prepared) {
    const [code, ms] = time(() => detect(r.stripped));
    row("tinyld", r, code === "ja" ? "ja" : code === "" ? "undetermined" : "other", ms, { label: code });
  }
  meta.versions = { tinyld: version };
} else if (name === "fasttext") {
  const py = path.join(ROOT, ".work/venv/bin/python");
  const model = path.join(ROOT, ".work/lid.176.ftz");
  if (!fs.existsSync(py) || !fs.existsSync(model)) { console.error("run `node setup.mjs` first"); process.exit(1); }
  const input = prepared.map((r) => JSON.stringify({ id: r.id, text: r.stripped })).join("\n") + "\n";
  const res = spawnSync(py, [path.join(ROOT, "lid_fasttext.py"), model], { input, encoding: "utf8", maxBuffer: 1 << 28 });
  if (res.status !== 0) { console.error(res.stderr); process.exit(1); }
  const byId = new Map(prepared.map((r) => [r.id, r]));
  for (const l of res.stdout.split("\n").filter(Boolean)) {
    const p = JSON.parse(l);
    row("fasttext", byId.get(p.id), p.label === "ja" ? "ja" : "other", p.ms, { label: p.label, prob: Number(p.prob.toFixed(4)) });
  }
  const pyOut = (code) => spawnSync(py, ["-c", code], { encoding: "utf8" }).stdout.trim();
  meta.versions = { python: pyOut("import platform;print(platform.python_version())"), "fasttext-numpy2-wheel": pyOut("from importlib.metadata import version;print(version('fasttext-numpy2-wheel'))"), model: "lid.176.ftz" };
} else if (isJudge) {
  const judge = JUDGES[name];
  if (judge.keyEnv && !process.env[judge.keyEnv]) { console.error(`${judge.keyEnv} is not set`); process.exit(1); }
  if (prepared.length === 0) { console.log(`${name}: nothing to run`); process.exit(0); }
  try { await judge.run(prepared[0].stripped); } catch (e) { console.error(`warm-up call failed: ${e.message}`); process.exit(1); }
  let errors = 0;
  for (const [n, r] of prepared.entries()) {
    const t0 = performance.now();
    try {
      const res = await judge.run(r.stripped);
      const { pred, error, ...rest } = res;
      row(name, r, pred, performance.now() - t0, pred === null ? { ...rest, error: error ?? "no YES/NO answer" } : rest);
      if (pred === null) errors++;
    } catch (e) {
      errors++;
      row(name, r, null, performance.now() - t0, { error: String(e.message).slice(0, 300) });
    }
    if ((n + 1) % 50 === 0) console.error(`${name}: ${n + 1}/${prepared.length}, ${errors} errors`);
  }
  meta.versions = { judge: judge.version, label: judge.label };
  if (name.startsWith("gemma4")) {
    const get = async (p) => (await fetch(`http://localhost:11434${p}`)).json();
    meta.versions.ollama = (await get("/api/version")).version;
    meta.versions.digest = (await get("/api/tags")).models.find((m) => m.name === "gemma4:12b")?.digest;
  }
} else {
  console.error(`unknown checker ${name}\n${USAGE}`);
  process.exit(1);
}

fs.writeFileSync(out, [...earlier, meta, ...lines].map((l) => JSON.stringify(l)).join("\n") + "\n");
console.log(`${name}: ${lines.length} rows -> ${path.relative(ROOT, out)}`);
