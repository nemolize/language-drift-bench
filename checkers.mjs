// The rule-based checkers. Each takes the text it is given and returns "ja" (a reply in Japanese, not drifted),
// "other" (drifted), or "undetermined" (the checker could not tell; counted as not flagged).
import { KANA, HAN } from "./common.mjs";

export const RATIO_THRESHOLDS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
export const RATIO_MIN_LENGTHS = [0, 5, 10, 20];
export const KANA_SHARE_THRESHOLDS = [0.02, 0.05, 0.1, 0.2, 0.3];

export function ratio(text, threshold, minLength) {
  const chars = [...text.replace(/\s/gu, "")];
  if (chars.length === 0 || chars.length < minLength) return "undetermined";
  const share = chars.filter((c) => KANA.test(c) || HAN.test(c)).length / chars.length;
  return share >= threshold ? "ja" : "other";
}

export function kanaShare(text, threshold, minLength) {
  const chars = [...text.replace(/\s/gu, "")];
  if (chars.length === 0 || chars.length < minLength) return "undetermined";
  return chars.filter((c) => KANA.test(c)).length / chars.length >= threshold ? "ja" : "other";
}

export function kanaPresence(text) {
  return KANA.test(text) ? "ja" : "other";
}

export function ratioName(threshold, minLength) {
  return `ratio-${threshold}-${minLength}`;
}

export const kanaShareName = (threshold, minLength) => `kanashare-${threshold}-${minLength}`;
