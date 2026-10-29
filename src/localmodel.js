// লোকাল GGUF মডেল লেন (llama.cpp) — ইন্টারনেট থেকে নামানো মডেল দিয়ে
// বিনা API-খরচতে বাংলা উত্তর দেয়। ইউজারের মেশিনে RAM কম (৬ GB), তাই
// চালুর আগে ফ্রি মেমোরি দেখা হয় আর নিষ্ক্রিয় থাকলে সার্ভার বন্ধ করা হয়।

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { ROOT } from './config.js';

const MODELS_DIR = path.join(ROOT, 'models');
const MANIFEST_FILE = path.join(MODELS_DIR, 'model-manifest.json');
const RUNTIME_DIR = path.join(MODELS_DIR, 'runtime', 'llama');
const SERVER_EXE = path.join(RUNTIME_DIR, 'llama-server.exe');
const STATE_LOG = path.join(ROOT, 'data', 'localmodel.log');

const PORT = 4799;
const IDLE_MS = 3 * 60 * 1000;

// প্রতিটি মডেল ধরতে চাওয়া ন্যূনতম ফ্রি RAM (MB) — কম হলে চালানো হয় না।
// ০.৫B মেপে দেখা: লোডে ~৫০০ MB ফ্রি RAM খরচ হয়, peak RSS ৩৯৮ MB (ওজন mmap,
// KV ক্যানভাস ২০৪৮ টোকেনে মাত্র ~১৩ MB) — তাই ফ্লোর = ফাইল MB + ~৩৫০ MB হেডরুম।
const RAM_FLOOR = { '0.5b': 800, '1.5b': 1500, '3b': 2400 };

let proc = null;
let loaded = '';
let lastUse = 0;
let idleTimer = null;
let startError = '';

function log(line) {
  try {
    fs.appendFileSync(STATE_LOG, `[${new Date().toISOString()}] ${line}\n`, 'utf8');
  } catch {
    /* লগ না লিখলেও চলবে */
  }
}

export function freeMemMB() {
  return Math.round(os.freemem() / 1048576);
}

export function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
  } catch {
    return { models: [] };
  }
}

export function writeManifest(doc) {
  fs.mkdirSync(MODELS_DIR, { recursive: true });
  fs.writeFileSync(MANIFEST_FILE, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  return doc;
}

// মডেলের আকার/ছোট-লেবেল দেখে RAM ফ্লোর বেছে নেওয়া হয়
function floorFor(name, bytes) {
  if (/0[.]5b/.test(name)) return RAM_FLOOR['0.5b'];
  if (/1[.]5b/.test(name)) return RAM_FLOOR['1.5b'];
  if (/3b/.test(name)) return Math.max(RAM_FLOOR['3b'], 0);
  const gb = bytes / 1073741824;
  return Math.round(900 + gb * 1300);
}

export function localModelStatus() {
  const manifest = readManifest();
  const models = (manifest.models || []).map((m) => {
    const local = path.join(MODELS_DIR, m.file);
    let size = 0;
    try {
      size = fs.statSync(local).size;
    } catch {
      size = 0;
    }
    return {
      id: m.id,
      label: m.label,
      params: m.params,
      file: m.file,
      expected: m.bytes,
      present: size > 0 && Math.abs(size - (m.bytes || size)) < 1024,
      localBytes: size,
      runsLocally: size > 0 && freeMemMB() >= floorFor(m.file, size),
      needsFreeMB: floorFor(m.file, size),
      cloudOnly: Boolean(m.cloud_only),
      terabox: m.terabox_path || '',
    };
  });
  return {
    runtime: fs.existsSync(SERVER_EXE),
    runtimeDir: RUNTIME_DIR,
    running: Boolean(proc),
    loaded,
    port: PORT,
    pid: proc?.pid || 0,
    freeMemMB: freeMemMB(),
    models,
    error: startError,
    idleStopSec: Math.round(IDLE_MS / 1000),
  };
}

async function waitReady(timeoutMs = 120000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(3000) });
      if (r.ok) return true;
    } catch {
      /* উঠতে দেরি হলে অপেক্ষা */
    }
    await new Promise((res) => setTimeout(res, 900));
  }
  return false;
}

export function stopLocalModel(reason = 'manual') {
  if (!proc) return { ok: true, running: false };
  const p = proc;
  proc = null;
  loaded = '';
  clearInterval(idleTimer);
  idleTimer = null;
  try {
    p.kill('SIGTERM');
  } catch {
    /* মরা প্রসেসে SIGTERM দিতে গেলে ESRCH */
  }
  log(`stop (${reason})`);
  return { ok: true, running: false };
}

export async function startLocalModel(modelId = '') {
  if (proc && (!modelId || loaded === modelId)) return { ok: true, running: true, loaded };
  const st = localModelStatus();
  if (!st.runtime) return { ok: false, error: 'llama.cpp রানটাইম নেই — models/runtime/llama/llama-server.exe' };
  const pick = st.models.find((m) => (modelId ? m.id === modelId : m.present && m.runsLocally && !m.cloudOnly));
  if (!pick) return { ok: false, error: modelId ? `মডেল নেই: ${modelId}` : 'চলানোর মতো মডেল/জায়গা নেই' };
  if (!pick.present) return { ok: false, error: `${pick.file} নামানো হয়নি` };
  if (!pick.runsLocally) {
    return { ok: false, error: `RAM কম — ${pick.id} চালাতে কমপক্ষে ${pick.needsFreeMB} MB ফাঁকা দরকার (এখন ${st.freeMemMB} MB)` };
  }
  stopLocalModel('restart');
  startError = '';
  const gguf = path.join(MODELS_DIR, pick.file);
  const ctx = pick.params >= 3 ? 1536 : 2048;
  const args = ['-m', gguf, '--host', '127.0.0.1', '--port', String(PORT), '-c', String(ctx), '-t', String(Math.max(2, os.cpus().length - 1)), '-ngl', '0', '--no-webui'];
  log(`start ${pick.id} ctx=${ctx}`);
  proc = spawn(SERVER_EXE, args, { cwd: RUNTIME_DIR, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  proc.stderr?.on('data', (b) => {
    const t = String(b).trim();
    if (t) startError = t.slice(0, 300);
  });
  proc.on('exit', () => {
    log(`exit ${pick.id}`);
    proc = null;
    loaded = '';
    clearInterval(idleTimer);
    idleTimer = null;
  });
  const ready = await waitReady();
  if (!ready) {
    stopLocalModel('not-ready');
    return { ok: false, error: `সার্ভার ${PORT} পোর্টে ওঠেনি: ${startError || 'time out'}` };
  }
  loaded = pick.id;
  lastUse = Date.now();
  clearInterval(idleTimer);
  idleTimer = setInterval(() => {
    if (proc && Date.now() - lastUse > IDLE_MS) stopLocalModel('idle');
  }, 20000);
  return { ok: true, running: true, loaded };
}

// মডেল নিজে না চালিয়েও একটা ছোট নির্দেশের উত্তর নেওয়া — RAM ফাঁকা না থাকলে নান
export async function askLocalModel(prompt, { modelId = '', system = '', maxTokens = 160, temperature = 0.4 } = {}) {
  const started = await startLocalModel(modelId);
  if (!started.ok) return { ok: false, error: started.error };
  lastUse = Date.now();
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: [
          ...(system ? [{ role: 'system', content: system }] : []),
          { role: 'user', content: String(prompt).slice(0, 4000) },
        ],
        max_tokens: maxTokens,
        temperature,
      }),
      signal: AbortSignal.timeout(180000),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
    const j = await res.json();
    const text = String(j?.choices?.[0]?.message?.content || '').trim();
    lastUse = Date.now();
    if (!text) return { ok: false, error: 'খালি উত্তর' };
    return { ok: true, text, model: loaded, ms: j?.usage ? undefined : undefined };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

export function localModelEnabled(cfg) {
  return Boolean(cfg?.settings?.localModel?.enabled);
}
