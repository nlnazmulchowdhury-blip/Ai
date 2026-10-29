// Terabox (AList-এর মধ্য দিয়ে) রাখা "action data" — ইউজারের নির্দেশ এখানে মিললে
// দল/মডেল ছাড়াই এক ধাপে কাজটি হয়ে যায়। রিমোট ডেটা না পাওয়া লোকাল ক্যাশে থেকে পড়া হয়।
import fs from 'node:fs';
import path from 'node:path';

import { ROOT, DATA_DIR } from './config.js';
import { readTeraboxJson, teraboxSession } from './teraboxweb.js';

const REMOTE_FILE = 'actions.json';
const CACHE_FILE = path.join(DATA_DIR, 'actions-cache.json');
const LOCAL_FILE = path.join(DATA_DIR, 'actions.json');
const FRESH_MS = 10 * 60 * 1000;

let env = null;
function readEnv() {
  if (env) return env;
  env = {};
  try {
    for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#') || !t.includes('=')) continue;
      const i = t.indexOf('=');
      env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    }
  } catch {
    env = {};
  }
  return env;
}

export function teraboxConfig() {
  const e = readEnv();
  return {
    url: (e.ALIST_URL || 'http://localhost:5244').replace(/\/+$/, ''),
    token: e.ALIST_TOKEN || '',
    root: (e.TERABOX_PATH || '/terabox/Ai/PC-Agent').replace(/\/+$/, '')
  };
}

async function alistReadJson(cfg, timeoutMs = 25000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${cfg.url}/api/fs/get`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: cfg.token },
      body: JSON.stringify({ path: `${cfg.root}/${REMOTE_FILE}` }),
      signal: ac.signal
    });
    const body = await res.json();
    if (body.code !== 200) throw new Error(body.message || `code ${body.code}`);
    const raw = body.data?.raw_url;
    if (!raw) throw new Error('কোনো download URL নেই');
    const dl = await fetch(raw, {
      headers: { authorization: cfg.token, 'user-agent': 'Mozilla/5.0' },
      signal: ac.signal
    });
    if (!dl.ok) throw new Error(`download HTTP ${dl.status}`);
    return JSON.parse(await dl.text());
  } finally {
    clearTimeout(timer);
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function normalizeDoc(doc) {
  if (!doc) return [];
  return Array.isArray(doc) ? doc : Array.isArray(doc.actions) ? doc.actions : [];
}

let store = { at: 0, source: 'none', actions: [], error: '' };

export async function loadActions({ force = false } = {}) {
  const now = Date.now();
  if (!force && store.actions.length && now - store.at < FRESH_MS) return store;
  const cfg = teraboxConfig();
  if (cfg.token) {
    try {
      const doc = await alistReadJson(cfg);
      store = { at: now, source: 'terabox', actions: normalizeDoc(doc), error: '' };
      try {
        fs.writeFileSync(CACHE_FILE, JSON.stringify(doc, null, 2), 'utf8');
      } catch {
        /* ক্যাশ লেখা ব্যর্থ হলেও চলবে */
      }
      return store;
    } catch (err) {
      store.error = err.message || String(err);
    }
  }
  // AList ছাড়া পথ: শুধু টেরাবক্সে লগইন করা সেশন থেকেই ডেটা পড়া
  if (teraboxSession()?.cookie) {
    try {
      const doc = await readTeraboxJson(REMOTE_FILE);
      if (doc) {
        store = { at: now, source: 'terabox-web', actions: normalizeDoc(doc), error: store.error };
        try {
          fs.writeFileSync(CACHE_FILE, JSON.stringify(doc, null, 2), 'utf8');
        } catch {
          /* ignore */
        }
        return store;
      }
    } catch (err) {
      store.error = `web: ${err.message || err}`;
    }
  }
  const doc = readJson(CACHE_FILE) || readJson(LOCAL_FILE);
  store = {
    at: now,
    source: doc ? (readJson(CACHE_FILE) ? 'cache' : 'local') : 'none',
    actions: normalizeDoc(doc),
    error: store.error
  };
  return store;
}

const squeeze = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]/gu, '');

// ইউজারের নির্দেশে সবচেয়ে লম্বা মিলটাই জিতে — "ইউটিউবে গান বাজাও"-তে
// "youtube"-এর চেয়ে "গান বাজাও" রেকর্ডটিই বেশি নির্দিষ্ট
export function matchAction(prompt, actions = store.actions) {
  const hay = squeeze(prompt);
  if (hay.length < 2) return null;
  let best = null;
  for (const rec of actions) {
    if (rec.disabled) continue;
    if ((rec.not || []).some((t) => hay.includes(squeeze(t)))) continue;
    for (const term of rec.match || []) {
      const needle = squeeze(term);
      if (needle.length >= 2 && hay.includes(needle) && (!best || needle.length > best.score)) {
        best = { rec, score: needle.length };
      }
    }
  }
  return best ? best.rec : null;
}

// রিমোট রেকর্ডের "code" ফিল্ড শুধু নথি — সেটি কখনো চালানো হয় না।
// চলে শুধু এই শ্বেত-তালিকার টুল, বাকি action লুকালে স্বাভাবিক দল-প্রবাহ চলা।
const REMOTE_TOOLS = {
  open_browser: 'open_url',
  open_url: 'open_url',
  open_app: 'open_path',
  play_youtube: 'youtube_play',
  search_youtube: 'youtube_search'
};

export function actionTool(rec) {
  if (!rec) return null;
  const tool = REMOTE_TOOLS[rec.action];
  if (!tool) return null;
  const args = rec.args || {};
  if (tool === 'open_url') {
    const url = rec.url || args.url || '';
    if (!/^https?:\/\//i.test(url)) return null;
    return { tool, args: { url } };
  }
  if (tool === 'open_path') {
    const target = rec.path || args.path || '';
    if (!target) return null;
    return { tool, args: { path: target } };
  }
  return { tool, args: { query: args.query ?? rec.query ?? '' } };
}

export async function lookupAction(prompt) {
  const st = await loadActions();
  return { record: matchAction(prompt, st.actions), source: st.source, count: st.actions.length, error: st.error };
}

export function teraboxStatus() {
  const cfg = teraboxConfig();
  const web = teraboxSession();
  return {
    configured: Boolean(cfg.token || web?.cookie),
    mode: cfg.token ? 'alist' : web?.cookie ? 'web' : 'local',
    webLogin: Boolean(web?.cookie),
    webRoot: web?.root || '',
    url: cfg.url,
    path: `${cfg.root}/${REMOTE_FILE}`,
    source: store.source,
    actions: store.actions.length,
    ageMs: store.at ? Date.now() - store.at : null,
    error: store.error
  };
}
