# -*- coding: utf-8 -*-
"""Kaggle-notebook: বাংলা কর্পাসে Qwen2.5-0.5B LoRA-ট্রেন, তারপর GGUF-এ রূপ।

দাম শূন্য — Kaggle-র বিনামূল্যে T4 (সপ্তাহে 30 ঘণ্টা)। ল্যাপটপে এই কাজ চলবে না:
ফুল ওয়েট + ব্যাকপ্রপ ৩–৪ GB চায়, এখানে ফাঁকা RAM ৩০০ MB।

চালাবার ধাপ (Kaggle-এ নতুন Notebook, Accelerator = GPU T4 x2 বা P100):
  1. `python training/make-train-set.py` — লোকাল, bn-train.jsonl + bn-val.jsonl বানাবে।
  2. দুটো ফাইল Kaggle-এ Dataset হিসেবে তোলো (নাম ধরে নিচ্ছি `bn-pc-agent-train`)।
  3. এই পুরো ফাইলটি একটি কোড সেলে পেস্ট করে Run All — শেষে working/qwen05b-bn-f16.gguf
     আর (চাইলে) Q4_K_M নামবে; নেমে আসা .gguf-টি `models/`-এ রাখো।
  4. ল্যাপটপে: `python scripts/verify-models.py` না — নতুন ফাইলের sha256 নিজে থেকে
     মিলবে না, তাই `python scripts/make-model-manifest.mjs` চালাও, তারপর
     `python sync_to_terabox.py push-models` (Terabox cookie ঠিক থাকলে)।
  5. ড্যাশবোর্ডের মডেল প্যানেলে `localModel.enabled` চালু করলে এজেন্ট এটাই চালাবে।

ট্রেন শেষে স্ক্রিপ্ট `eval`-এর ৪টি নমুনা প্রশ্ন ছাপে — বাংলা উত্তর বেরোচ্ছে কি না চোখে দেখার জন্য।
"""

import json
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

# ----------------------------------------------------------------- কনফিগ
BASE = os.environ.get("BASE_MODEL", "Qwen/Qwen2.5-0.5B-Instruct")
VAL_FRACTION = 0.02
MAX_LEN = 512          # কর্পাসের ৯৯% জোড়া এর ভেতরে — বড় করলে VRAM বাড়ে, লাভ নেই
EPOCHS = 3
BATCH = 4
GRAD_ACCUM = 8         # কার্যকর ব্যাচ ৩২
LR = 2e-4
RANK = 16
WARMUP_STEPS = 60
SEED = 20261028
QUANT = "Q4_K_M"
SAMPLE_Q = [
    "বাংলাদেশের রাজধানী কোন শহর",
    "পানির রাসায়নিক সংকেত কী",
    "ত্রিভুজের ক্ষেত্রফল কীভাবে বের করি",
    "মঙ্গল পাণ্ডের ঘটনা কোন অফিসারের কাছে পাঠানো হয়েছিল",
]

# pip — নোটবুকের প্রথম সেলেই চলে
PIP_ARGS = ["install", "-q", "-U",
            "torch==2.4.1", "transformers==4.44.2", "peft==0.12.0",
            "datasets==2.20.0", "accelerate==0.33.0", "sentencepiece", "protobuf"]


def pip_install():
    subprocess.run([sys.executable, "-m", "pip", *PIP_ARGS], check=False)


def find_data():
    """Kaggle-এ ডেটা /kaggle/input/<dataset>/ তে থাকে; ফাইলের নাম দিয়ে খোঁজো।"""
    for root in [Path("/kaggle/input"), Path("training/out"), Path(".")]:
        if not root.exists():
            continue
        for train in root.rglob("bn-train.jsonl"):
            val = train.parent / "bn-val.jsonl"
            return train, val if val.exists() else train
    raise SystemExit("bn-train.jsonl পাওয়া যায়নি — Dataset টি attach হয়েছে কি না দেখো")


def read_jsonl(path):
    with open(path, encoding="utf-8") as fh:
        return [json.loads(line) for line in fh if line.strip()]


def main():
    pip_install()
    import torch
    from datasets import Dataset
    from peft import LoraConfig, get_peft_model
    from transformers import (AutoModelForCausalLM, AutoTokenizer,
                              DataCollatorForSeq2Seq, Trainer, TrainingArguments)

    train_path, val_path = find_data()
    train_rows, val_rows = read_jsonl(train_path), read_jsonl(val_path)
    if VAL_FRACTION and not val_rows:
        cut = max(1, int(len(train_rows) * VAL_FRACTION))
        train_rows, val_rows = train_rows[:-cut], train_rows[-cut:]
    print(f"ট্রেন {len(train_rows)} জোড়া | যাচাই {len(val_rows)} জোড়া | বেস {BASE}")

    tok = AutoTokenizer.from_pretrained(BASE)
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token

    def encode(row):
        """শুধু উত্তরের টোকেনেই লস — প্রশ্নের ঘরগুলো -100, তাই মডেল প্রশ্ন মুখস্থ করে না।"""
        msgs = [{"role": "user", "content": row["instruction"]},
                {"role": "assistant", "content": row["output"]}]
        full = tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=False)
        prompt = tok.apply_chat_template(msgs[:-1], tokenize=False, add_generation_prompt=True)
        ids = tok(full, truncation=True, max_length=MAX_LEN)["input_ids"]
        plen = min(len(ids), len(tok(prompt, add_special_tokens=False)["input_ids"]))
        labels = [-100] * plen + ids[plen:]
        return {"input_ids": ids, "attention_mask": [1] * len(ids), "labels": labels}

    ds = Dataset.from_list(train_rows).map(encode, remove_columns=train_rows[0].keys())
    vs = Dataset.from_list(val_rows).map(encode, remove_columns=val_rows[0].keys())

    model = AutoModelForCausalLM.from_pretrained(BASE, torch_dtype=torch.float16,
                                                 device_map=None)
    model.config.use_cache = False
    model = get_peft_model(model, LoraConfig(
        r=RANK, lora_alpha=2 * RANK, lora_dropout=0.05, bias="none",
        task_type="CAUSAL_LM",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                        "gate_proj", "up_proj", "down_proj"]))
    model.print_trainable_parameters()

    args = TrainingArguments(
        output_dir="qwen05b-bn-lora", num_train_epochs=EPOCHS,
        per_device_train_batch_size=BATCH, gradient_accumulation_steps=GRAD_ACCUM,
        per_device_eval_batch_size=2, learning_rate=LR, lr_scheduler_type="cosine",
        warmup_steps=WARMUP_STEPS, fp16=True, gradient_checkpointing=True,
        logging_steps=20, eval_strategy="steps", eval_steps=200,
        save_strategy="steps", save_steps=400, save_total_limit=2,
        report_to="none", seed=SEED, dataloader_num_workers=2)

    # Trainer-এর প্রথম পজিশনাল আর্গুমেন্ট model — args আগে দিলে TypeError
    hist = Trainer(model=model, args=args, train_dataset=ds, eval_dataset=vs,
                   data_collator=DataCollatorForSeq2Seq(tok, model=model, padding=True)).train()
    losses = [round(float(l), 4) for l in (hist.training_loss or [])]
    print("শেষ train_loss:", losses[-1] if losses else "?",
          "| eval:", hist.metrics.get("eval_loss"))

    merged = Path("merged")
    model.merge_and_unload().save_pretrained(merged, safe_serialization=True)
    tok.save_pretrained(merged)

    # ---- মডেলটি কী শিখেছে — চোখে দেখার নমুনা
    gpu_model = AutoModelForCausalLM.from_pretrained(merged, torch_dtype=torch.float16).to("cuda").eval()
    for q in SAMPLE_Q:
        msgs = [{"role": "user", "content": q}]
        prompt = tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True)
        enc = tok(prompt, return_tensors="pt").to("cuda")
        out = gpu_model.generate(**enc, max_new_tokens=96, do_sample=False,
                                 eos_token_id=tok.eos_token_id)
        # টোকেন-সংখ্যা দিয়ে কেটো — প্রম্পটের অক্ষর-দৈর্ঘ্য দিয়ে কাটলে পুরো কথাটিই ছাপা হতো
        answer = tok.decode(out[0][enc["input_ids"].shape[1]:],
                            skip_special_tokens=True).strip()
        print("প্রশ্ন:", q, "\n  উত্তর:", answer[:400], flush=True)
    del gpu_model
    torch.cuda.empty_cache()

    # ---- GGUF (f16) — llama.cpp-এর pure-python কনভার্টার, Kaggle-তেই চলে
    if not Path("llama.cpp").exists():
        subprocess.run(["git", "clone", "--depth", "1",
                        "https://github.com/ggml-org/llama.cpp"], check=False)
    f16 = Path("qwen05b-bn-f16.gguf")
    subprocess.run([sys.executable, "llama.cpp/convert_hf_to_gguf.py", str(merged),
                    "--outfile", str(f16), "--outtype", "f16"], check=False)

    # ---- Q4_K_M — Kaggle-তে llama.cpp বিল্ড করে নিই (ল্যাপটপেও হবে, নিচে কমান্ড ছাপা হয়)
    quant = Path(f"qwen05b-bn-{QUANT.lower()}.gguf")
    if shutil.which("cmake"):
        subprocess.run(["cmake", "-S", "llama.cpp", "-B", "llama.cpp/build",
                        "-DGGML_CUDA=OFF", "-DCMAKE_BUILD_TYPE=Release"], check=False)
        subprocess.run(["cmake", "--build", "llama.cpp/build", "--config", "Release",
                        "-j", "4", "--target", "llama-quantize"], check=False)
        exe = "llama.cpp/build/bin/llama-quantize"
        if Path(exe).exists() and f16.exists():
            subprocess.run([exe, str(f16), str(quant), QUANT], check=False)

    with zipfile.ZipFile("qwen05b-bn-model.zip", "w", zipfile.ZIP_DEFLATED) as zf:
        for p in [quant if quant.exists() else f16]:
            if p.exists():
                zf.write(p, p.name)
    print("\nনামাবার ফাইল: qwen05b-bn-model.zip")
    print("ল্যাপটপে কোয়ান্টাইজ করতে হলে (runtime এখানেই আছে):")
    print("  models/runtime/llama/llama-quantize.exe qwen05b-bn-f16.gguf "
          f"models/qwen05b-bn-{QUANT.lower()}.gguf {QUANT}")
    print("তারপর: python scripts/make-model-manifest.mjs && python sync_to_terabox.py push-models")
    shutil.rmtree("llama.cpp", ignore_errors=True)


if __name__ == "__main__":
    main()
