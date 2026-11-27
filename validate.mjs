// Checks the dataset and the input rule: the examples of the spec, subset sizes, labels, and that no sentence sits on both sides of the split.
import { loadDataset, strip, hasTarget } from "./common.mjs";

const problems = [];
const fail = (msg) => problems.push(msg);
const rows = loadDataset();

const ids = new Set();
for (const r of rows) {
  if (ids.has(r.id)) fail(`duplicate id ${r.id}`);
  ids.add(r.id);
  if (!["ja", "drift", "none"].includes(r.label)) fail(`${r.id}: label ${r.label}`);
  if (!["dev", "test"].includes(r.split)) fail(`${r.id}: split ${r.split}`);
}

const bySubset = {};
for (const r of rows) (bySubset[r.subset] ??= []).push(r);
const expectLabel = { ja: "ja", en: "drift", zh: "drift", "mixed-ja-en-quote": "ja", "mixed-en-ja-words": "drift", "short-ja": "ja", "short-en": "drift", "short-zh": "drift", "kanji-ja": "ja", "kanji-zh": "drift", "code-ja": "ja", "code-en": "drift", "code-zh": "drift", "code-only": "none" };
for (const [subset, label] of Object.entries(expectLabel)) {
  const list = bySubset[subset] ?? [];
  if (list.length < 10) fail(`subset ${subset} has ${list.length} items`);
  if (list.some((r) => r.label !== label)) fail(`subset ${subset} holds a label other than ${label}`);
  for (const split of ["dev", "test"]) if (!list.some((r) => r.split === split)) fail(`subset ${subset} has no ${split} item`);
}
for (const subset of Object.keys(bySubset)) if (!(subset in expectLabel)) fail(`unexpected subset ${subset}`);

for (const r of rows) {
  const index = Number(r.id.slice(r.id.lastIndexOf("-") + 1));
  if (r.split !== (index % 2 === 0 ? "dev" : "test")) fail(`${r.id}: split ${r.split} does not follow its base sentence's index`);
}

const expect = (what, got, want) => got !== want && fail(`strip: ${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
expect("fence removed", strip("日本語の説明です。\n\n```py\nprint('hi')\n```"), "日本語の説明です。");
expect("inline code removed", strip("Use `日本語` here.").replace(/\s+/g, " "), "Use here.");
expect("table row removed", strip("説明です。\n| a | b |\n|---|---|\n| 1 | 2 |"), "説明です。");
expect("url removed", strip("see https://example.com/a?b=1 now").replace(/\s+/g, " "), "see now");
expect("unclosed fence removed", strip("説明\n```sh\nls"), "説明");
expect("url followed by Japanese", strip("設定方法はhttps://example.com/docsを参照してください。"), "設定方法は を参照してください。".replace(" を", " を"));
expect("indented fence removed", strip("English reply.\n\n  - step\n    ```sh\n    # 日本語のコメント\n    ls\n    ```"), "English reply.\n\n  - step");
expect("tilde fence removed", strip("English reply.\n~~~sh\n# 日本語\n~~~"), "English reply.");
if (hasTarget(strip("```sh\nls\n```"))) fail("a code-only reply must have no target");
for (const r of bySubset["code-only"] ?? []) if (hasTarget(strip(r.text))) fail(`${r.id}: code-only item has a target`);

if (problems.length) {
  console.error(problems.map((p) => `- ${p}`).join("\n"));
  process.exit(1);
}
console.log(`ok: ${rows.length} items, ${Object.keys(bySubset).length} subsets`);
