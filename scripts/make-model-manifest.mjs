// HuggingFace থেকে GGUF-এর exact size/sha256/lfs-oid নিয়ে manifest বানায়।
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const FILES = [
  { id: 'qwen25-0.5b', label: 'ছোট মস্তিষ্ক (০.৫B)', params: 0.5, repo: 'Qwen2.5-0.5B-Instruct-GGUF', file: 'qwen2.5-0.5b-instruct-q4_k_m.gguf', role: 'লোকাল লেন: সহজ বাংলা প্রশ্নোত্তর, RAM কম লাগে' },
  { id: 'qwen25-1.5b', label: 'মাঝারি মস্তিষ্ক (১.৫B)', params: 1.5, repo: 'Qwen2.5-1.5B-Instruct-GGUF', file: 'qwen2.5-1.5b-instruct-q4_k_m.gguf', role: 'ফাঁকা সময়ে ভালো উত্তর, RAM বেশি চায়' },
  { id: 'qwen25-3b', label: 'বড় মস্তিষ্ক (৩B)', params: 3, repo: 'Qwen2.5-3B-Instruct-GGUF', file: 'qwen2.5-3b-instruct-q4_k_m.gguf', role: 'Terabox-এ ভাণ্ডার; এই ল্যাপটপে RAM-এর অভাবে সাধারণত চলে না' },
];

const out = [];
for (const f of FILES) {
  const url = `https://huggingface.co/api/models/Qwen/${f.repo}/tree/main?recursive=true`;
  const res = await fetch(url);
  const j = await res.json();
  const e = (Array.isArray(j) ? j : []).find((x) => x.path === f.file) || {};
  const local = path.join(ROOT, 'models', f.file);
  let localBytes = 0;
  try {
    localBytes = fs.statSync(local).size;
  } catch {}
  out.push({
    id: f.id,
    label: f.label,
    params: f.params,
    quant: 'Q4_K_M',
    file: f.file,
    repo: `Qwen/${f.repo}`,
    url: `https://huggingface.co/Qwen/${f.repo}/resolve/main/${f.file}`,
    bytes: e.size || 0,
    sha256: (e.lfs?.oid || e.sha || '').slice(0, 64),
    localBytes,
    downloaded: localBytes === e.size,
    cloud_only: f.params >= 3,
    purpose: f.role,
    terabox_path: `/terabox/Ai/PC-Agent/models/${f.file}`,
    license: 'apache-2.0',
  });
  console.log(f.file, e.size, 'local', localBytes, (e.lfs?.oid || '').slice(0, 12));
}

const MANIFEST = path.join(ROOT, 'models', 'model-manifest.json');
// আগের ম্যানিফেস্টে হাতে লেখা অংশ আছে (runtime.measured, corpus, training, upload) —
// পুরোটা ওভাররাইট করলে মাপা তথ্যগুলো মুছে যেত, তাই পুরনোটি পড়ে মেপে নেওয়া ফিল্ডটাই বদলানো হয়
const prev = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : {};
const prevModel = Object.fromEntries((prev.models || []).map((m) => [m.id, m]));
for (const m of out) {
  const old = prevModel[m.id] || {};
  if (!m.bytes || !m.sha256) {
    // HF-এর API ধরতে না পারলে আগের যাচাই-করা সংখ্যাগুলোই থাকে — নইলে শূন্য লিখে
    // 'ডাউনলোড হয়নি' দেখাত
    m.bytes = old.bytes || m.bytes;
    m.sha256 = old.sha256 || m.sha256;
    m.downloaded = m.localBytes === m.bytes;
  }
  m.cloud_only = m.params >= 3 ? true : !!old.cloud_only;
  m.sha_ok = !!m.sha256 && old.sha256 === m.sha256 && m.localBytes === m.bytes;
}

const doc = {
  schema: 'pc-agent/models@1',
  at: new Date().toISOString(),
  runtime: prev.runtime || {
    name: 'llama.cpp',
    build: 'b11946',
    variant: 'bin-win-cpu-x64',
    path: 'models/runtime/llama/llama-server.exe',
    endpoint: 'http://127.0.0.1:4799',
  },
  datasets: prev.datasets || [
    {
      id: 'mega-bengali-instructions',
      repo: 'AI4BD/Mega-Bengali-Instructions',
      kind: 'parquet shards',
      url: 'https://huggingface.co/datasets/AI4BD/Mega-Bengali-Instructions',
      local_dir: 'data/raw/mega_bengali',
      converted: 'data/knowledge/bengali-corpus.jsonl',
      purpose: 'বাংলা নির্দেশ-উত্তর জোড়া — কর্পাস রিট্রিভাল লেন',
      license: 'ODC-BY / CC-BY (repo README)',
    },
    {
      id: 'indicqa',
      repo: 'ai4bharat/IndicQA',
      kind: 'json',
      url: 'https://huggingface.co/datasets/ai4bharat/IndicQA',
      local_dir: 'data/raw/indicqa',
      converted: 'data/knowledge/bengali-corpus.jsonl',
      purpose: 'বাংলা/হিন্দি প্রশ্নোত্তর',
      license: 'CC BY 4.0',
    },
  ],
  models: out,
  corpus: prev.corpus,
  training: prev.training,
  upload: prev.upload || { target: '/terabox/Ai/PC-Agent/models', via: 'AList raw PUT /api/fs/put', status: 'pending' },
};
for (const key of ['corpus', 'training']) if (!doc[key]) delete doc[key];
fs.writeFileSync(MANIFEST, JSON.stringify(doc, null, 2) + '\n', 'utf8');
console.log('manifest লেখা হয়েছে');
