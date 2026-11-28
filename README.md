# Language-drift checker benchmark

Runner behind the Zenn article on this comparison. An AI assistant told to answer in Japanese sometimes answers in English or Chinese; this measures which per-turn checker catches that best, with the fewest false alarms and at what time per check.

```sh
pnpm install --ignore-scripts   # franc 6.2.0, tinyld 1.3.4
node setup.mjs                  # fastText (fasttext-numpy2-wheel 0.9.2 in .work/venv) and lid.176.ftz
node build-dataset.mjs          # data/sentences.json -> data/dataset.jsonl (deterministic)
node validate.mjs               # dataset and input-rule checks
node run.mjs rules              # character ratio, kana share, kana presence; every item, every setting
node run.mjs franc && node run.mjs tinyld && node run.mjs fasttext
ANTHROPIC_API_KEY=... node run.mjs claude-haiku-5-5                  # also: claude-haiku-5-5-nothink
GEMINI_API_KEY=... node run.mjs gemini-3.8-flash                     # also: gemini-decision-1
TYPESAFE_API_KEY=... node run.mjs jev
OPENAI_API_KEY=... node run.mjs gpt-6-luna
node run.mjs gemma4:12b && node run.mjs gemma4:12b+think             # Ollama
node summarize.mjs              # results/summary.md and summary.json
node run.mjs <judge> --missing true   # run only the items a judge has no row for, appending to its results file
```

## Definitions

- **Requested language** is Japanese. A reply is **drifted** when the main language of its own prose, after the input rule below, is not Japanese. A **mixed** reply keeps Japanese as its main language and carries a long quotation in another (`mixed-ja-en-quote`, correct), or keeps English as its main language and carries a few Japanese words (`mixed-en-ja-words`, drifted).
- **Input rule**, applied before every checker (`strip()` in `common.mjs`): fenced code, inline code, table rows and URLs are removed, nothing else. A reply with no letter left is `no target`: not scored, counted in `code-only`. Fences are backtick or tilde fences, indented or not; a URL ends at the first character that is not printable ASCII. The `-raw` variants of the rule-based checkers skip the removal to show what it buys.
- **Miss rate** = drifted replies a checker passes / drifted replies. **False-alarm rate** = correct replies it flags / correct replies. A checker that cannot tell (`undetermined`, for example text shorter than the minimum length) does not flag. A zero count carries its 95% upper bound, `1 - 0.05^(1/n)`; a non-zero count shows only the count.
- **Errors**: an external call that fails, or a decision model that returns no probability, is an error row (`pred: null`) with its reason, counted beside the rates and never as a verdict. An interrupted run is discarded and rerun.

## Data

Every text is an invented example reply in the style of a coding assistant; no real chat is used. `data/sentences.json` holds the base sentences, `build-dataset.mjs` builds the items. Subsets and what fixes their label:

| Subset | Label | Built from |
|---|---|---|
| `ja`, `en`, `zh` | correct, drifted, drifted | 60 written replies per language (Simplified Chinese for `zh`) |
| `mixed-ja-en-quote` | correct | a Japanese reply and an English quotation of 54 to 81 characters (kana share of the whole at least 0.22) |
| `mixed-en-ja-words` | drifted | an English reply with one Japanese word or phrase |
| `short-ja`, `short-en`, `short-zh` | correct, drifted, drifted | 25 replies of at most 20 characters each |
| `kanji-ja`, `kanji-zh` | correct, drifted | 60 Japanese status lines of kanji only (6 to 8 characters, and 11 to 14); 60 Traditional Chinese lines with no kana (6 to 8 characters, and 20 to 25) |
| `code-ja`, `code-en`, `code-zh` | correct, drifted, drifted | the `ja` / first 30 `en` / first 30 `zh` replies with a fenced block, inline code or a table added; after the input rule they equal their base reply, or differ by one added Japanese clause (`code-ja`), so `summarize.mjs` keeps them out of the rates and bounds and shows them in a table of their own (stripped against raw) |
| `code-only` | none | a fenced block alone, 10 items; checks that the input rule leaves nothing |

The label follows from how the item is built, not from a judge. The split is fixed by the base sentence's index (even = `dev`, odd = `test`), so a sentence and every item built from it sit on the same side. The heuristic's settings are chosen on `dev`; every rate in `results/summary.md` is measured on `test`. Judges run on `test` only.

## Checkers

| Name | What it is |
|---|---|
| character ratio | share of kana and kanji among non-space characters at least a threshold (0.1 to 0.6), with a minimum length (0, 5, 10, 20) |
| kana share | share of kana among non-space characters at least a threshold (0.02 to 0.3), same minimum lengths |
| kana presence | any kana at all |
| `franc` 6.2.0, `tinyld` 1.3.4 | npm language-ID libraries, default settings; `franc`'s `und` and `tinyld`'s empty result do not flag |
| fastText `lid.176.ftz` | `fasttext-numpy2-wheel` 0.9.2 on Python 3.13; the model's SHA-256 is printed by `setup.mjs` |
| `gemma4:12b` | Ollama, thinking off, YES when the first-token probability of `YES` is at least that of `NO`; and with thinking on, the first word decides |
| `claude-haiku-5-5` | Messages API, default thinking, and with thinking disabled |
| `jev-1.14.0`, `gpt-6-luna`, `gemini-decision-1` | decision models: YES when the probability is at least 0.5 |

`gemini-3.8-flash` (thinking level low; the verdict is the first line of the reply) and `gemini-decision-1` (Gemini Decisions API; YES when the probability is at least 0.5) ran on 2026-11-28, a day after the other checkers, once the Gemini API project had credits again; their meta lines carry that date.

## Timing

The first call of a judge run is a warm-up whose result is discarded; a failing warm-up stops the run. Each check runs alone, one item at a time, as a per-turn hook would call it. `ms` is wall-clock for one call (the judges include the network round trip; the fastText model is loaded once beforehand and its load time is not counted). Every result file starts with a `meta` line with `node`, the date and `idleBefore`, the idle share of all cores before the run; the runner refuses to start on a Node other than `.node-version` and waits for `--minidle` (default 0.75).
