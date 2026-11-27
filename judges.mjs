// LLM and decision-model judges. Each returns { pred: "ja" | "other" | null, pJa, ... }; pred null is an error row, with `error` when the judge knows why.
const PROMPT = (text) => `Below is an AI assistant's reply to a user who asked it to answer in Japanese.\nDecide the language of the assistant's own prose, not of quoted passages, code or file names. Is that prose written in Japanese?\nAnswer exactly YES or NO.\n\n<reply>\n${text}\n</reply>`;
const SYSTEM = "You are a strict classifier. Output exactly one word: YES or NO.";
const QUESTION = {
  instructions: "The text is an AI assistant's reply to a user who asked for Japanese. Judge the language of the assistant's own prose, not of quoted passages or code.",
  true: "The assistant's own prose is written in Japanese",
  false: "The assistant's own prose is written in another language such as English or Chinese",
};
const OLLAMA = "http://localhost:11434";
const retryable = new Set([429, 500, 502, 503, 504]);

async function postJson(url, body, headers = {}, tries = 4) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(300_000) });
    if (res.ok) return res.json();
    if (!retryable.has(res.status) || attempt === tries - 1) throw new Error(`${url} -> ${res.status} ${(await res.text()).slice(0, 200)}`);
    await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
  }
}

const firstWord = (text) => /^\W*(YES|NO)\b/i.exec((text ?? "").trim())?.[1].toUpperCase() ?? null;
const fromYesNo = (word) => (word === "YES" ? "ja" : word === "NO" ? "other" : null);

function fromLogprobs(first) {
  const lp = {};
  for (const c of first.top_logprobs) lp[c.token.trim().toUpperCase()] = Math.max(lp[c.token.trim().toUpperCase()] ?? -Infinity, c.logprob);
  if (!("YES" in lp) || !("NO" in lp)) return { pred: fromYesNo(firstWord(first.token)), pJa: null };
  const pJa = 1 / (1 + Math.exp(lp.NO - lp.YES));
  return { pred: pJa >= 0.5 ? "ja" : "other", pJa };
}

const ollama = (model, think) => async (text) => {
  const res = await postJson(`${OLLAMA}/api/chat`, think
    ? { model, stream: false, think: true, messages: [{ role: "user", content: PROMPT(text) }], options: { num_predict: 8192, temperature: 0 } }
    : { model, stream: false, think: false, logprobs: true, top_logprobs: 10, messages: [{ role: "user", content: PROMPT(text) }], options: { num_predict: 1, temperature: 0 } });
  if (think) return { pred: fromYesNo(firstWord(res.message?.content)), pJa: null, outputTokens: res.eval_count };
  return fromLogprobs(res.logprobs[0]);
};

const claude = (thinking) => async (text) => {
  const res = await postJson("https://api.anthropic.com/v1/messages", {
    model: "claude-haiku-5-5", max_tokens: 16000, system: SYSTEM, messages: [{ role: "user", content: PROMPT(text) }],
    ...(thinking ? {} : { thinking: { type: "disabled" } }),
  }, { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" });
  const block = res.content.find((b) => b.type === "text");
  return { pred: fromYesNo(firstWord(block?.text)), pJa: null, outputTokens: res.usage?.output_tokens };
};

const GEMINI = "gemini-3.8-flash";
const geminiFlash = async (text) => {
  const res = await postJson(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI}:generateContent`, {
    contents: [{ role: "user", parts: [{ text: PROMPT(text) }] }], systemInstruction: { parts: [{ text: SYSTEM }] },
    generationConfig: { temperature: 0, maxOutputTokens: 1024, thinkingConfig: { thinkingLevel: "low" } },
  }, { "x-goog-api-key": process.env.GEMINI_API_KEY });
  const parts = res.candidates?.[0]?.content?.parts ?? [{}];
  return { pred: fromYesNo(firstWord(parts[0].text)), pJa: null, modelVersion: res.modelVersion };
};

const decisions = ({ model, url, keyEnv, kind }) => async (text) => {
  const key = process.env[keyEnv];
  const body = kind === "predicate"
    ? { model, input: text, questions: [{ type: "predicate", name: "q", instructions: `${QUESTION.instructions} (yes: ${QUESTION.true} / no: ${QUESTION.false})` }] }
    : kind === "gemini"
      ? { model, input: text, questions: { q: { type: "noul", instructions: QUESTION.instructions, criteria: { true_description: QUESTION.true, false_description: QUESTION.false } } } }
      : { model, state: text, questions: { q: { type: "noul", instructions: QUESTION.instructions, criteria: { true: QUESTION.true, false: QUESTION.false } } } };
  const headers = kind === "gemini" ? { "x-goog-api-key": key } : { Authorization: `Bearer ${key}` };
  const raw = await postJson(url, body, headers);
  const res = raw.result ?? raw;
  const ans = Array.isArray(res.answers) ? res.answers[0] : res.answers.q;
  const p = ans.probability ?? ans.noul;
  if (p == null) return { pred: null, pJa: null, error: `no probability in response: ${JSON.stringify(res).slice(0, 200)}` };
  return { pred: p >= 0.5 ? "ja" : "other", pJa: p, served: res.model ?? raw.model };
};

const judge = (label, version, run, keyEnv) => ({ label, version, run, keyEnv });
const decision = (label, cfg) => judge(label, cfg.model, decisions(cfg), cfg.keyEnv);

export const JUDGES = {
  "gemma4:12b": judge("gemma4:12b", "gemma4:12b (Ollama)", ollama("gemma4:12b", false), null),
  "gemma4:12b+think": judge("gemma4:12b (thinking)", "gemma4:12b (Ollama, thinking)", ollama("gemma4:12b", true), null),
  "claude-haiku-5-5": judge("claude-haiku-5-5", "claude-haiku-5-5", claude(true), "ANTHROPIC_API_KEY"),
  "claude-haiku-5-5-nothink": judge("claude-haiku-5-5 (no thinking)", "claude-haiku-5-5", claude(false), "ANTHROPIC_API_KEY"),
  [GEMINI]: judge(GEMINI, GEMINI, geminiFlash, "GEMINI_API_KEY"),
  jev: decision("jev-1.14.0", { model: "jev-1.14.0", url: "https://api.typesafe.ai/v1/systemone", keyEnv: "TYPESAFE_API_KEY", kind: "noul" }),
  "gpt-6-luna": decision("gpt-6-luna", { model: "gpt-6-luna", url: "https://api.openai.com/v1/decisions", keyEnv: "OPENAI_API_KEY", kind: "predicate" }),
  "gemini-decision-1": decision("gemini-decision-1", { model: "gemini-decision-1", url: "https://generativelanguage.googleapis.com/v1beta/decisions", keyEnv: "GEMINI_API_KEY", kind: "gemini" }),
};
