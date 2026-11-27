// Shared pieces: paths, dataset loading, the one input rule every checker sees, and the rate helpers.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const DATASET = path.join(ROOT, "data/dataset.jsonl");

export function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

export const loadDataset = () => readJsonl(DATASET);

export function strip(text) {
  return text
    .replace(/^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*\1[ \t]*$/gm, " ")
    .replace(/^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*$/m, " ")
    .replace(/`[^`\n]*`/g, " ")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("|"))
    .join("\n")
    .replace(/https?:\/\/[\x21-\x7e]+/g, " ")
    .trim();
}

export const hasTarget = (stripped) => /[\p{L}]/u.test(stripped);

export const KANA = /[\u3040-\u30ff\u31f0-\u31ff\uff66-\uff9f]/u;
export const HAN = /[\u3400-\u4dbf\u4e00-\u9fff]/u;

// 95% upper bound of the true rate after n trials with no event: 1 - 0.05^(1/n).
export const zeroUpperBound = (n) => 1 - Math.pow(0.05, 1 / n);

export const median = (xs) => {
  const v = [...xs].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
export const percentile = (xs, q) => {
  const v = [...xs].sort((a, b) => a - b);
  return v[Math.min(v.length - 1, Math.ceil(q * v.length) - 1)];
};
