// Builds data/dataset.jsonl from data/sentences.json; a rerun writes the same bytes.
import fs from "node:fs";
import path from "node:path";
import { ROOT, DATASET } from "./common.mjs";

const S = JSON.parse(fs.readFileSync(path.join(ROOT, "data/sentences.json"), "utf8"));
const splitOf = (i) => (i % 2 === 0 ? "dev" : "test");
const rows = [];
const add = (subset, label, i, text) => rows.push({ id: `${subset}-${i}`, subset, label, split: splitOf(i), text });

const FENCES = [
  "```bash\n# Install the dependencies and run the whole test suite once\nnpm ci && npm test\n```",
  "```python\n# Load the config file and print every key that is set\nfor key in config:\n    print(key, config[key])\n```",
  "```ts\n// Return the first user whose email matches, or null when nothing is found\nconst user = users.find((u) => u.email === email) ?? null;\n```",
  "```sh\n# Show the commits that are on this branch but not on main\ngit log --oneline main..HEAD\n```",
  "```yaml\n# Run the job on every pull request and cancel older runs of the same branch\non: pull_request\nconcurrency:\n  group: ci-${{ github.ref }}\n  cancel-in-progress: true\n```",
  "```json\n{\n  \"scripts\": { \"build\": \"tsc -p .\", \"lint\": \"eslint src\" }\n}\n```",
  "```sql\n-- Count the orders placed in the last seven days, grouped by status\nSELECT status, count(*) FROM orders WHERE created_at > now() - interval '7 days' GROUP BY status;\n```",
  "```go\n// Close the response body when the function returns so the connection can be reused\ndefer resp.Body.Close()\n```",
];
const JA_COMMENT_FENCES = [
  "```bash\n# 依存パッケージを入れてからテストを実行する\nnpm ci && npm test\n```",
  "```python\n# 設定ファイルを読み込んで、設定されているキーをすべて表示する\nfor key in config:\n    print(key, config[key])\n```",
  "```ts\n// メールアドレスが一致する最初のユーザーを返し、なければ null を返す\nconst user = users.find((u) => u.email === email) ?? null;\n```",
  "```sh\n# main にはなく、このブランチにだけあるコミットを表示する\ngit log --oneline main..HEAD\n```",
];
const INLINE = ["`npm run build`", "`git status`", "`src/config.ts`", "`--force-with-lease`", "`NODE_ENV=production`", "`pnpm run lint`"];
const TABLES = [
  "| step | command |\n|---|---|\n| build | npm run build |\n| test | npm test |",
  "| file | change |\n|---|---|\n| src/config.ts | add the timeout option |\n| README.md | document the option |",
  "| key | value |\n|---|---|\n| retries | 3 |\n| timeout | 30 |",
];
const QUOTE_FORMS = [
  (ja, q) => `${ja} ドキュメントには "${q}" と書かれています。`,
  (ja, q) => `ログには次のように出ていました: "${q}"\n\n${ja}`,
  (ja, q) => `${ja}\n\n> ${q}`,
];

S.ja.forEach((t, i) => add("ja", "ja", i, t));
S.en.forEach((t, i) => add("en", "drift", i, t));
S.zh.forEach((t, i) => add("zh", "drift", i, t));
S.jaWordsInEn.forEach((t, i) => add("mixed-en-ja-words", "drift", i, t));
S.enQuotes.forEach((q, i) => add("mixed-ja-en-quote", "ja", i, QUOTE_FORMS[i % QUOTE_FORMS.length](S.ja[i], q)));
S.jaShort.forEach((t, i) => add("short-ja", "ja", i, t));
S.enShort.forEach((t, i) => add("short-en", "drift", i, t));
S.zhShort.forEach((t, i) => add("short-zh", "drift", i, t));
S.jaKanjiOnly.forEach((t, i) => add("kanji-ja", "ja", i, t));
S.zhTrad.forEach((t, i) => add("kanji-zh", "drift", i, t));

S.ja.forEach((t, i) => {
  const k = (i >> 1) % 4;
  const text = k === 0 ? `${t}\n\n${FENCES[(i >> 1) % FENCES.length]}`
    : k === 1 ? `${FENCES[(i >> 1) % FENCES.length]}\n\n${t}`
    : k === 2 ? `${t} ${INLINE[(i >> 1) % INLINE.length]} を使ってください。\n\n${TABLES[(i >> 1) % TABLES.length]}`
    : `${t}\n\n${FENCES[(i >> 1) % FENCES.length]}\n\n${INLINE[(i >> 1) % INLINE.length]} も確認してください。`;
  add("code-ja", "ja", i, text);
});
S.en.slice(0, 30).forEach((t, i) => add("code-en", "drift", i, (i >> 1) % 2 === 0 ? `${t}\n\n${JA_COMMENT_FENCES[(i >> 1) % JA_COMMENT_FENCES.length]}` : `${t} ${INLINE[(i >> 1) % INLINE.length]}\n\n${TABLES[(i >> 1) % TABLES.length]}`));
S.zh.slice(0, 30).forEach((t, i) => add("code-zh", "drift", i, `${t}\n\n${FENCES[(i >> 1) % FENCES.length]}`));
for (let i = 0; i < 10; i++) add("code-only", "none", i, FENCES[(i >> 1) % FENCES.length]);

fs.writeFileSync(DATASET, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
const count = {};
for (const r of rows) count[`${r.subset} ${r.split}`] = (count[`${r.subset} ${r.split}`] ?? 0) + 1;
console.log(`${rows.length} items`, count);
