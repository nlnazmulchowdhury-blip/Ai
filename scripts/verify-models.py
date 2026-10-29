"""GGUF ফাইল sha256 মিলিয়ে নামায় — ভাঙা/মিল না হলে পুরোটা আবার নামায়।

curl -C - রিজিউম HF CDN-এ রিডাইরেক্টে সাইজ মিলিয়েও ভুঁইয়া বাইট দিতে পারে,
তাই সাইজ-মিলই যথেষ্ট না — হ্যাশ মেলানো লাগে।
"""

import hashlib
import json
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
MODELS = ROOT / "models"
MAN = MODELS / "model-manifest.json"


def sha256_of(path: Path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 22), b""):
            h.update(chunk)
    return h.hexdigest()


def fetch(url: str, dest: Path, resume: bool):
    # URL শেষে বসা লাগে — -o-এর পর ভুলে ফেললে curl "no URL specified" দেয়
    cmd = ["curl", "-L"]
    if resume:
        cmd += ["-C", "-"]
    cmd += ["--retry", "10", "--retry-delay", "4", "--retry-all-errors",
            "-sS", "--fail", "-o", str(dest), url]
    print("   নামানো শুরু (resume=%s) ->" % resume, dest.name, flush=True)
    return subprocess.run(cmd).returncode


def main():
    doc = json.loads(MAN.read_text(encoding="utf-8"))
    for m in doc["models"]:
        p = MODELS / m["file"]
        want = m.get("sha256") or ""
        size = m.get("bytes") or 0
        if not want:
            print("হ্যাশ নেই, বাদ:", m["id"])
            continue
        for attempt in range(3):
            have = p.stat().st_size if p.exists() else 0
            m["localBytes"] = have   # ম্যানিফেস্ট কখনো ভুঁইয়া সাইজ ধরে রাখে না
            if have == size:
                got = sha256_of(p)
                if got == want:
                    print(f"✓ {m['id']} হ্যাশ মিলেছে ({got[:12]})")
                    m["sha_ok"] = True
                    m["downloaded"] = True
                    break
                print(f"✗ {m['id']} হ্যাশ মিলল না ({got[:12]} != {want[:12]}) — পুরোটা আবার নামানো হচ্ছে")
                m["sha_ok"] = False
                if p.exists():
                    p.unlink()
                rc = fetch(m["url"], p, resume=False)
                print(f"   refetch rc={rc}")
            else:
                print(f"… {m['id']} আধা ({have}/{size}) — রিজিউম হচ্ছে")
                fetch(m["url"], p, resume=True)
        else:
            m["sha_ok"] = False
            m["downloaded"] = False
    MAN.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("ম্যানিফেস্ট আপডেট হয়েছে")


if __name__ == "__main__":
    main()
