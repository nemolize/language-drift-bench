"""fastText language identification (lid.176) over a JSONL of {"id", "text"}.

Usage: python lid_fasttext.py <model.ftz> < input.jsonl > output.jsonl
"""
import json
import sys
import time

import fasttext

model = fasttext.load_model(sys.argv[1])
for line in sys.stdin:
    row = json.loads(line)
    text = " ".join(row["text"].split())
    t0 = time.perf_counter()
    labels, probs = model.predict(text, k=1)
    ms = (time.perf_counter() - t0) * 1000
    label = labels[0].removeprefix("__label__")
    print(json.dumps({"id": row["id"], "label": label, "prob": float(probs[0]), "ms": ms}))
