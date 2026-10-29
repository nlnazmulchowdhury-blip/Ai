// বাংলা কর্পাস-ভিত্তিক লোকাল জ্ঞান-লেন।
//
// ইন্টারনেট থেকে নামানো (Mega-Bengali / IndicQA) এবং এজেন্ট নিজে শেখা (local-learned)
// প্রশ্নোত্তর জোড়া JSONL থেকে পড়ে, ইনভার্টেড ইনডেক্স বানিয়ে মিল খুঁজে দেয়।
// দল/মডেল চালু করার আগে এই ব্লকটা বটের প্রম্পটে বসে, তাই উত্তরে বাংলা ভাষার
// ধরন আর আগে পাওয়া তথ্য দুটোই বিনা API-খরচতে ব্যবহার হয়।

import fs from 'node:fs';
import path from 'node:path';

import { ROOT } from './config.js';

const KN_DIR = path.join(ROOT, 'data', 'knowledge');
const CORPUS_FILE = path.join(KN_DIR, 'bengali-corpus.jsonl');
const LEARNED_FILE = path.join(KN_DIR, 'local-learned.jsonl');
const MAX_ROWS = 16000;
const MAX_LEARNED = 1200;

// বাংলা সাফিক্স কাটা — "বইগুলো" আর "বই" এক টোকেনে দাঁড়ায়
const SUFFIXES = [
  'গুলো', 'গুলি', 'গুলা', 'সমূহ', 'দিগের', 'মধ্যে', 'থেকে', 'পর্যন্ত', 'সহ', 'আবার',
  'রা', 'রে', 'রি', 'য়ে', 'য়', 'ে', 'ো', 'া', 'ী', 'ি', 'ু', 'এ', 'ও', 'কে', 'তে',
  'দে', 'নে', 'হয়', 'ছিল', 'চ্ছে', 'বে', 'বা', 'হি',
];

// \p{M} রাখা দরকার — বাংলা মাত্রা (া ি ী ে ো ্) ফেললে "রাজধানী" টুকে "রাজধ" + "ন" হয়ে ভেঙে যায়
const squeeze = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ');

export function tokenize(text) {
  const out = [];
  for (const raw of squeeze(text).split(/\s+/)) {
    if (raw.length < 3) continue;
    let w = raw;
    for (const s of SUFFIXES) {
      if (w.length - s.length >= 3 && w.endsWith(s)) {
        w = w.slice(0, w.length - s.length);
        break;
      }
    }
    out.push(w);
  }
  return [...new Set(out)];
}

let index = null;

function readJsonl(file, limit) {
  const rows = [];
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return rows;
  }
  for (const line of text.split('\n')) {
    if (rows.length >= limit) break;
    const t = line.trim();
    if (!t) continue;
    try {
      const r = JSON.parse(t);
      if (r.q && r.a) rows.push(r);
    } catch {
      /* ভাঙা লাইন এড়িয়ে চলি */
    }
  }
  return rows;
}

function build() {
  const rows = [...readJsonl(LEARNED_FILE, MAX_LEARNED), ...readJsonl(CORPUS_FILE, MAX_ROWS)].slice(0, MAX_ROWS + MAX_LEARNED);
  const map = new Map();
  for (let i = 0; i < rows.length; i++) {
    const toks = tokenize(`${rows[i].q} ${rows[i].topic || ''}`);
    rows[i].toks = toks;
    for (const t of toks) {
      let list = map.get(t);
      if (!list) map.set(t, (list = []));
      if (list.length < 200) list.push(i);
    }
  }
  index = { rows, map, at: Date.now() };
  return index;
}

function ensure() {
  if (index) return index;
  return build();
}

export function reloadKnowledge() {
  index = null;
  return ensure();
}

// সবচেয়ে বেশি শব্দ-ওজন মিলে যাওয়া জোড়াগুলো ফেরত দেয়।
// idf-ওজন + প্রশ্নের কভারেজ দুটোই ধরা হয়, নাহলে ৩ শব্দের প্রশ্নে
// একটা মিলেই পুরো নিউজ-অনুচ্ছেদ ভেসে আসত।
export function lookupKnowledge(text, limit = 5) {
  const ix = ensure();
  const q = tokenize(text);
  if (!q.length || !ix.rows.length) return [];
  // idf-ওজন: শব্দ যত দুর্লভ মিল তত দামি। কর্পাসে না-থাকা শব্দের সামান্য ওজন ধরা হয়,
  // নাহলে "কী/বলো"-র মতো সাধারণ শব্দে পুরো কর্পাস মিলে যেত।
  const weightOf = (t) => {
    const list = ix.map.get(t);
    return list && list.length ? 1 / (1 + Math.log(1 + list.length)) : 0.12;
  };
  const total = q.reduce((sum, t) => sum + weightOf(t), 0);
  const scores = new Map();
  const matched = new Map();
  for (const t of q) {
    const list = ix.map.get(t);
    if (!list) continue;
    const weight = weightOf(t);
    for (const i of list) {
      scores.set(i, (scores.get(i) || 0) + weight);
      matched.set(i, (matched.get(i) || 0) + 1);
    }
  }
  // rel = মিলে যাওয়া শব্দগুলো প্রশ্নের মোট ওজনের কত অংশ — absolute থ্রেশহোল্ড দিলে
  // "ত্রিভুজের ক্ষেত্রফল"-এর মতো সাধারণ-শব্দের প্রশ্ন বাদ পড়ত, কারণ ওজন ছোট হলেও মিল আসল।
  return [...scores.entries()]
    .map(([i, s]) => ({ i, s, cov: (matched.get(i) || 0) / q.length, rel: s / total }))
    .filter((x) => x.cov >= 0.34 && x.rel >= 0.5)
    .sort((a, b) => b.s * (0.5 + b.cov) - a.s * (0.5 + a.cov))
    .slice(0, limit)
    .map((x) => ({ ...ix.rows[x.i], score: Number((x.s * (0.5 + x.cov)).toFixed(3)) }));
}

// নিজে শেখা জোড়া কর্পাসে যোগ হয় — প্রতি সফল উত্তরে কর্পাস বড় হয়
export function learnPair({ q, a, source = 'agent', topic = '' }) {
  const question = String(q || '').slice(0, 600).replace(/\s+/g, ' ').trim();
  const answer = String(a || '').slice(0, 900).replace(/\s+/g, ' ').trim();
  if (question.length < 12 || answer.length < 12) return null;
  fs.mkdirSync(KN_DIR, { recursive: true });
  const rec = { source, topic: String(topic || '').slice(0, 60), q: question, a: answer, at: Date.now() };
  fs.appendFileSync(LEARNED_FILE, JSON.stringify(rec) + '\n', 'utf8');
  pruneLearned();
  if (index) {
    index.rows.push(rec);
    for (const t of tokenize(`${rec.q} ${rec.topic}`)) {
      let list = index.map.get(t);
      if (!list) index.map.set(t, (list = []));
      if (list.length < 200) list.push(index.rows.length - 1);
    }
  }
  return rec;
}

// ফাইল বড় হতে থাকলে পুরনোগুলোর জায়গা ছাড়ে — কর্পাস অনির্দিষ্টভাবে ফুলে যাবে না
function pruneLearned() {
  let size = 0;
  try {
    size = fs.statSync(LEARNED_FILE).size;
  } catch {
    return;
  }
  if (size < 4 * 1024 * 1024) return;
  const keep = fs.readFileSync(LEARNED_FILE, 'utf8').split('\n').filter(Boolean).slice(-MAX_LEARNED);
  fs.writeFileSync(LEARNED_FILE, keep.join('\n') + '\n', 'utf8');
  index = null;
}

export function knowledgeStatus() {
  const ix = ensure();
  const size = (f) => {
    try {
      return fs.statSync(f).size;
    } catch {
      return 0;
    }
  };
  const sources = new Map();
  for (const r of ix.rows) sources.set(String(r.source || '?').split(':')[0], (sources.get(String(r.source || '?').split(':')[0]) || 0) + 1);
  return {
    pairs: ix.rows.length,
    terms: ix.map.size,
    bytes: size(CORPUS_FILE) + size(LEARNED_FILE),
    sources: Object.fromEntries(sources),
    built: Boolean(index),
  };
}

// বটের প্রম্পটে বসার বাংলা রেফারেন্স ব্লক
export function knowledgeBlock(text, limit = 4) {
  const hits = lookupKnowledge(text, limit);
  if (!hits.length) return '';
  return `\nলোকাল জ্ঞান-কর্পাস (ইন্টারনেটের বাংলা ডেটা + আগে শেখা উত্তর; মেলে ব্যবহার করো, মেলে না মানে ভুল—নিজের চোখে যাচাই করো):\n${hits
    .map((h) => `- [${h.source}] ${h.q}\n  → ${String(h.a).slice(0, 300)}`)
    .join('\n')}\n`;
}
