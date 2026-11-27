// Reads results/*.jsonl and the dataset, picks each heuristic's threshold and minimum length on the dev half,
// and writes results/summary.json and results/summary.md with every rate measured on the test half.
// The code-* subsets repeat a base reply with code added; after the input rule their text is the base's
// (code-ja items that add a short Japanese clause differ by that clause), so they stay out of the rates and bounds
// and appear only in the "code" table.
import fs from "node:fs";
import path from "node:path";
import { ROOT, loadDataset, readJsonl, zeroUpperBound, median, percentile } from "./common.mjs";
import { JUDGES } from "./judges.mjs";
import { RATIO_THRESHOLDS, RATIO_MIN_LENGTHS, KANA_SHARE_THRESHOLDS, ratioName, kanaShareName } from "./checkers.mjs";

const items = new Map(loadDataset().map((r) => [r.id, r]));
const FILES = fs.readdirSync(path.join(ROOT, "results")).filter((f) => f.endsWith(".jsonl"));
const rowsByChecker = new Map();
const metas = [];
for (const f of FILES) {
  for (const l of readJsonl(path.join(ROOT, "results", f))) {
    if (l.kind === "meta") metas.push(l);
    else {
      if (!rowsByChecker.has(l.k)) rowsByChecker.set(l.k, []);
      rowsByChecker.get(l.k).push(l);
    }
  }
}

const SUBSETS = ["ja", "mixed-ja-en-quote", "short-ja", "kanji-ja", "en", "zh", "mixed-en-ja-words", "short-en", "short-zh", "kanji-zh"];
const CODE_SUBSETS = ["code-ja", "code-en", "code-zh"];
const isCode = (subset) => subset.startsWith("code-");

function score(rows, split, { code = false } = {}) {
  const bySubset = {};
  let drifted = 0, missed = 0, correct = 0, flagged = 0, errors = 0;
  for (const r of rows) {
    const it = items.get(r.id);
    if (it.split !== split || isCode(it.subset) !== code) continue;
    const s = (bySubset[it.subset] ??= { n: 0, bad: 0, errors: 0, label: it.label });
    if (r.pred === null) { s.errors++; errors++; continue; }
    s.n++;
    if (it.label === "drift") { drifted++; if (r.pred !== "other") { s.bad++; missed++; } }
    else { correct++; if (r.pred === "other") { s.bad++; flagged++; } }
  }
  return { bySubset, miss: { bad: missed, n: drifted }, falseAlarm: { bad: flagged, n: correct }, errors };
}

const rate = (c) => c.bad / c.n;
const balanced = (sc) => rate(sc.miss) + rate(sc.falseAlarm);

function pickSetting(names) {
  const grid = [];
  for (const [key, t, m] of names) {
    if (!rowsByChecker.has(key)) continue;
    const dev = score(rowsByChecker.get(key), "dev");
    if (dev.miss.n === 0 || dev.falseAlarm.n === 0) throw new Error(`${key} has no scored dev rows; run the rule-based checkers on the dev half`);
    grid.push({ key, t, m, dev });
  }
  grid.sort((a, b) => balanced(a.dev) - balanced(b.dev) || a.key.localeCompare(b.key));
  return grid;
}
const ratioGrid = pickSetting(RATIO_THRESHOLDS.flatMap((t) => RATIO_MIN_LENGTHS.map((m) => [ratioName(t, m), t, m])));
const kanaGrid = pickSetting(KANA_SHARE_THRESHOLDS.flatMap((t) => RATIO_MIN_LENGTHS.map((m) => [kanaShareName(t, m), t, m])));
const ratioChosen = ratioGrid[0];
const kanaChosen = kanaGrid[0];

const checkers = [];
const add = (label, key) => {
  const rows = rowsByChecker.get(key);
  if (!rows) return;
  const noCode = rows.filter((r) => items.get(r.id).split === "test" && !isCode(items.get(r.id).subset));
  const ms = noCode.map((r) => r.ms);
  checkers.push({ key, label, ...score(rows, "test"), code: score(rows, "test", { code: true }), medianMs: median(ms), p95Ms: percentile(ms, 0.95), n: noCode.length });
};
add(`character ratio (kana+kanji share >= ${ratioChosen.t}, min ${ratioChosen.m} chars)`, ratioChosen.key);
add("character ratio, same setting, code not removed", ratioChosen.key + "-raw");
add(`kana share (kana share >= ${kanaChosen.t}, min ${kanaChosen.m} chars)`, kanaChosen.key);
add("kana share, same setting, code not removed", kanaChosen.key + "-raw");
add("kana presence", "kana");
add("kana presence, code not removed", "kana-raw");
const metaOf = (checker) => metas.find((m) => m.checker === checker);
for (const lib of ["franc", "tinyld"]) add(`${lib} ${metaOf(lib)?.versions[lib]}`, lib);
add("fastText lid.176", "fasttext");
for (const name of new Set(metas.filter((m) => m.versions?.judge).map((m) => m.checker))) add(JUDGES[name].label, name);

const pct = (x) => `${(100 * x).toFixed(1)}%`;
const cell = (s) => (s && s.n ? `${pct(rate(s))} (${s.bad}/${s.n}${s.bad === 0 ? `, <${pct(zeroUpperBound(s.n))}` : ""})` : "-");

const md = [];
md.push("# Summary (test half only)\n");
md.push(`Settings chosen on the dev half: ${ratioChosen.key} (dev miss ${pct(rate(ratioChosen.dev.miss))}, false alarm ${pct(rate(ratioChosen.dev.falseAlarm))}); ${kanaChosen.key} (dev miss ${pct(rate(kanaChosen.dev.miss))}, false alarm ${pct(rate(kanaChosen.dev.falseAlarm))})\n`);
md.push("| checker | miss rate (drifted passes) | false-alarm rate (correct flagged) | errors | median ms | p95 ms |\n|---|---|---|---|---|---|");
for (const c of checkers) md.push(`| ${c.label} | ${cell(c.miss)} | ${cell(c.falseAlarm)} | ${c.errors} | ${c.medianMs.toFixed(3)} | ${c.p95Ms.toFixed(3)} |`);
md.push("\n## Per subset (miss rate on drifted subsets, false-alarm rate on correct ones)\n");
md.push(`| checker | ${SUBSETS.join(" | ")} |\n|---|${SUBSETS.map(() => "---").join("|")}|`);
for (const c of checkers) md.push(`| ${c.label} | ${SUBSETS.map((s) => cell(c.bySubset[s])).join(" | ")} |`);
md.push("\n## Code subsets (the same replies with code, inline code or a table added)\n");
md.push(`| checker | ${CODE_SUBSETS.join(" | ")} |\n|---|${CODE_SUBSETS.map(() => "---").join("|")}|`);
for (const c of checkers) md.push(`| ${c.label} | ${CODE_SUBSETS.map((s) => cell(c.code.bySubset[s])).join(" | ")} |`);
md.push("\n## Heuristic grids on the dev half (miss + false alarm, lower is better)\n");
md.push("| setting | miss | false alarm | sum |\n|---|---|---|---|");
for (const g of [...ratioGrid, ...kanaGrid]) md.push(`| ${g.key} | ${cell(g.dev.miss)} | ${cell(g.dev.falseAlarm)} | ${balanced(g.dev).toFixed(3)} |`);

fs.writeFileSync(path.join(ROOT, "results/summary.md"), md.join("\n") + "\n");
const setting = (g) => ({ key: g.key, threshold: g.t, minLength: g.m });
fs.writeFileSync(path.join(ROOT, "results/summary.json"), JSON.stringify({ chosen: { ratio: setting(ratioChosen), kanaShare: setting(kanaChosen) }, devGrids: Object.fromEntries([...ratioGrid, ...kanaGrid].map((g) => [g.key, g.dev])), checkers, metas }, null, 1) + "\n");
console.log(md.slice(0, 3 + checkers.length + 2).join("\n"));
