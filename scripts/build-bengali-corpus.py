"""ডেটাসেট -> সরল JSONL কর্পাস।

Mega-Bengali (chat-format parquet) আর IndicQA (json) থেকে প্রশ্নোত্তর জোড়া
বের করে data/knowledge/bengali-corpus.jsonl লেখে। এজেন্ট এই ফাইলটা
knowledge লেনে পড়ে। batch করে পড়া হয় — মেশিনে RAM কম।
"""

import json
import re
import sys
from pathlib import Path

import pyarrow.parquet as pq

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT_DIR = ROOT / "data" / "knowledge"
OUT = OUT_DIR / "bengali-corpus.jsonl"

MIN_IN, MAX_IN = 14, 220
MIN_OUT, MAX_OUT = 12, 420
CAP = 16000
PER_SOURCE = 9000
BAN = re.compile(r"(https?://|data:image|<\|im_start\|>|\ufffd)")
BN = re.compile(r"[\u0980-\u09ff]")
# প্রশ্নোত্তর/নির্দেশ-আকারের জোড়াই রাখা হয় — পুরো নিউজ-অনুচ্ছেদ ঢোকানো
# লম্বা প্রম্পট কর্পাসে কাজে লাগে না
ASK = re.compile(r"(\?|কী|কি|কে|কেন|কোথায়|কখন|কত|কেমন|কীভাবে|কিভাবে|বলো|ব্যাখ্যা|দাও|করো|করুন|লিখো|আছে|হয়)")

seen = set()
rows = []
per_src = {}


def clean(text):
    if not isinstance(text, str):
        return ""
    t = re.sub(r"\s+", " ", text).strip()
    if BAN.search(t):
        return ""
    return t


def add(source, instruction, output, topic=""):
    if len(rows) >= CAP:
        return
    ins = clean(instruction)
    out = clean(output)
    if not (MIN_IN <= len(ins) <= MAX_IN and MIN_OUT <= len(out) <= MAX_OUT):
        return
    if not BN.search(ins) or not BN.search(out):
        return
    if not ASK.search(ins):
        return
    if per_src.get(source, 0) >= PER_SOURCE:
        return
    key = ins.lower()
    if key in seen:
        return
    seen.add(key)
    per_src[source] = per_src.get(source, 0) + 1
    rows.append({"source": source, "q": ins, "a": out, "topic": clean(topic)[:50]})


def from_mega():
    for f in sorted((RAW / "mega_bengali").glob("*.parquet")):
        n = 0
        try:
            pf = pq.ParquetFile(f)
        except Exception as err:
            print(f"skip {f.name}: {err}", file=sys.stderr)
            continue
        before = len(rows)
        for batch in pf.iter_batches(batch_size=1500, columns=["messages", "source"]):
            for msg, src in zip(batch.column("messages").to_pylist(), batch.column("source").to_pylist()):
                n += 1
                if not msg:
                    continue
                q = a = ""
                for i, m in enumerate(msg):
                    if m.get("role") == "user" and not q:
                        q = m.get("content") or ""
                    if m.get("role") == "assistant" and q:
                        a = m.get("content") or ""
                        break
                if q and a:
                    add(f"mega:{(src or 'bn').split('/')[0][:20]}", q, a)
        print(f"{f.name}: {n} rows পড়া, {len(rows) - before} জোড়া নেওয়া")
        if len(rows) >= CAP:
            break


def from_indicqa():
    for f in sorted((RAW / "indicqa").glob("*.json")):
        try:
            doc = json.loads(f.read_text(encoding="utf-8"))
        except Exception as err:
            print(f"skip {f.name}: {err}", file=sys.stderr)
            continue
        # SQuAD-ধাঁচ: data -> [{title, paragraphs:[{context, qas:[{question, answers}]}]}]
        lang = f.stem.split(".")[-1]
        before = len(rows)
        for art in doc.get("data") or []:
            title = art.get("title") or ""
            for para in art.get("paragraphs") or []:
                for qa in para.get("qas") or []:
                    ans = qa.get("answers")
                    if isinstance(ans, list):
                        ans = " | ".join(
                            a if isinstance(a, str) else str(a.get("text", "")) for a in ans
                        )
                    add(f"indicqa:{lang}", qa.get("question"), ans, title)
        print(f"{f.name}: {len(rows) - before} জোড়া")


def main():
    # ছোট কিন্তু নির্ভুল সোর্স আগে — CAP-এর আগেই সেগুলো কর্পাসে ঢোকে
    from_indicqa()
    from_mega()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"\nমোট {len(rows)} জোড়া -> {OUT} ({OUT.stat().st_size} B)")


if __name__ == "__main__":
    main()
