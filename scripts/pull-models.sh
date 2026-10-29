#!/usr/bin/env bash
# রিজিউম-সহ তিনটা Qwen GGUF নামায়; প্রতিবার লগে লাইন যোগ হয়
cd "$(dirname "$0")/.." || exit 1
log=models/download.log
base=https://huggingface.co/Qwen
set -a
files=(
  "Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf"
  "Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf"
  "Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf"
)
for f in "${files[@]}"; do
  name=$(basename "$f")
  echo "[$(date +%H:%M:%S)] START $name" >> "$log"
  curl -L -C - --retry 12 --retry-delay 4 --retry-all-errors -sS --fail \
    -o "models/$name" "$base/$f" 2>>"$log"
  rc=$?
  size=$(stat -c %s "models/$name" 2>/dev/null || echo 0)
  echo "[$(date +%H:%M:%S)] DONE $name rc=$rc bytes=$size" >> "$log"
done
echo "[$(date +%H:%M:%S)] ALL-FINISHED" >> "$log"
