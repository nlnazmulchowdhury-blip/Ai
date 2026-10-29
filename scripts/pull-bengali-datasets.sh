#!/usr/bin/env bash
# ইন্টারনেট থেকে বাংলা ট্রেইনিং ডেটা নামানোর রিজিউম-সহ স্ক্রিপ্ট।
cd "$(dirname "$0")/.." || exit 1
mkdir -p data/raw/mega_bengali data/raw/indicqa
log=data/datasets-download.log

pull() {
  local out="$1" url="$2"
  echo "[$(date +%H:%M:%S)] START $(basename "$out")" >>"$log"
  curl -L -C - --retry 10 --retry-delay 4 --retry-all-errors -sS --fail -o "$out" "$url" 2>>"$log"
  local rc=$?
  echo "[$(date +%H:%M:%S)] DONE $(basename "$out") rc=$rc bytes=$(stat -c %s "$out" 2>/dev/null || echo 0)" >>"$log"
}

MB="https://huggingface.co/datasets/AI4BD/Mega-Bengali-Instructions/resolve/main/data"
for i in 00000 00001 00002 00003 00004 00005 00006 00007 00008 00009; do
  pull "data/raw/mega_bengali/train-${i}-of-00010.parquet" "$MB/train-${i}-of-00010.parquet"
done

IQ="https://huggingface.co/datasets/ai4bharat/IndicQA/resolve/main/data"
for lang in bn hi; do
  pull "data/raw/indicqa/indicqa.${lang}.json" "$IQ/indicqa.${lang}.json"
done

echo "[$(date +%H:%M:%S)] ALL-FINISHED" >>"$log"
