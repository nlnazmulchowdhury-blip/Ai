#!/usr/bin/env python3
"""কর্পাস + এজেন্টের নিজের শেখা জোড়া থেকে Kaggle-চলানো ট্রেনিং-সেট বানায়।

আউটপুট: training/out/bn-train.jsonl, bn-val.jsonl (Alpaca ধাঁচ: instruction/output)
ব্যবহার: python training/make-train-set.py
"""
from __future__ import annotations

import json
import random
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "training" / "out"
SOURCES = [ROOT / "data" / "knowledge" / "bengali-corpus.jsonl",
           ROOT / "data" / "knowledge" / "local-learned.jsonl"]
SEED = 20261028
VAL_FRACTION = 0.02

# এক-লাইনের নির্দেশ + খুব ছোট/খুব লম্বা উত্তর মডেলকে খারাপ অভ্যাস শেখায়
MIN_Q, MAX_Q = 8, 400
MIN_A, MAX_A = 3, 700
JUNK_A = re.compile(r"^(জানি না|বুঝতে পারছি না|আমি একটি (এআই|AI)|দুঃখিত)", re.I)
BN = re.compile(r"[\u0980-\u09ff]")


def clean(text):
    return re.sub(r"\s+", " ", str(text or "")).strip()


def load_rows():
    rows, seen = [], set()
    for path in SOURCES:
        if not path.exists():
            print(f" (বাদ) {path.name} নেই")
            continue
        with path.open(encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except ValueError:
                    continue
                q, a = clean(rec.get("q")), clean(rec.get("a"))
                if not (MIN_Q <= len(q) <= MAX_Q and MIN_A <= len(a) <= MAX_A):
                    continue
                if JUNK_A.match(a) or q == a or not BN.search(q + a):
                    # দুটোর একটিতেও বাংলা অক্ষর না থাকলে সেটি কর্পাসের ইংরেজি শার্ডের নোইজ
                    continue
                key = re.sub(r"[^\w\u0980-\u09ff]", "", q.lower())
                if key in seen:
                    continue
                seen.add(key)
                rows.append({"instruction": q, "input": "", "output": a,
                             "meta": {"source": rec.get("source", "?")}})
    return rows


def main():
    rows = load_rows()
    if not rows:
        print("কোনো জোড়া বাকি নেই — কর্পাস তৈরি হয়েছে কি না দেখো")
        return 1
    random.Random(SEED).shuffle(rows)
    n_val = max(1, int(len(rows) * VAL_FRACTION))
    parts = {"val": rows[:n_val], "train": rows[n_val:]}
    OUT.mkdir(parents=True, exist_ok=True)
    for name, part in parts.items():
        dest = OUT / f"bn-{name}.jsonl"
        with dest.open("w", encoding="utf-8") as fh:
            for r in part:
                fh.write(json.dumps({k: v for k, v in r.items() if k != "meta"},
                                    ensure_ascii=False) + "\n")
        print(f"{dest.relative_to(ROOT)}: {len(part)} জোড়া, {dest.stat().st_size/1048576:.2f} MB")
    by_src = {}
    for r in rows:
        s = str(r["meta"]["source"]).split(":")[0]
        by_src[s] = by_src.get(s, 0) + 1
    print("স্রোত:", json.dumps(by_src, ensure_ascii=False))
    print("পরের ধাপ: এই দুই ফাইল Kaggle-এ Dataset হিসেবে তুলে training/kaggle-qlora.py নোটবুকে চালাও")
    return 0


if __name__ == "__main__":
    sys.exit(main())
