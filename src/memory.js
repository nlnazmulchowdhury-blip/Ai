import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT } from './config.js';

const MEMORY_FILE = path.join(ROOT, 'data', 'memory.json');

const STOP = new Set([
  'করে', 'করা', 'করো', 'কর', 'একটা', 'একটি', 'আর', 'এবং', 'এই', 'ও', 'এ', 'কে', 'কি', 'যে', 'সে',
  'তা', 'থেকে', 'জন্য', 'সাথে', 'আমি', 'তুমি', 'আমাকে', 'আমার', 'তোমার', 'দাও', 'দিয়ে', 'হয়',
  'হবে', 'হয়েছে', 'এখন', 'তারপর', 'একবার', 'নতুন', 'ভালো', 'ভাল', 'প্লিজ', 'গিয়ে', 'একটু',
  'the', 'and', 'for', 'with', 'this', 'that', 'you', 'your', 'please', 'can', 'will', 'from'
]);

function tokens(text) {
  const words = String(text || '').toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) || [];
  return [...new Set(words)].filter((w) => w.length >= 2 && !STOP.has(w));
}

// দল মিলিয়ে দেখার কাজেও একই শব্দভাণ্ডার দরকার (src/teams.js)
export { tokens };

function norm(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function similarity(a, b) {
  if (!a.length || !b.length) return 0;
  const set = new Set(b);
  let hit = 0;
  for (const word of a) if (set.has(word)) hit += 1;
  return hit / Math.min(a.length, b.length);
}

function idFor(prompt) {
  return crypto.createHash('sha1').update(norm(prompt).slice(0, 220)).digest('hex').slice(0, 12);
}

function noteWords(note) {
  const fromPrompt = tokens(note.prompt);
  return fromPrompt.length ? fromPrompt : Array.isArray(note.keywords) ? note.keywords : [];
}

export function loadNotes() {
  try {
    const parsed = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveNotes(notes) {
  try {
    fs.mkdirSync(path.dirname(MEMORY_FILE), { recursive: true });
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(notes.slice(0, 80), null, 2), 'utf8');
  } catch {
    /* ignore */
  }
}

export function findRelevant(prompt, limit = 3) {
  const query = tokens(prompt);
  if (!query.length) return [];
  const scored = [];
  for (const note of loadNotes()) {
    const words = noteWords(note);
    if (!words.length) continue;
    const exact = norm(note.prompt) === norm(prompt) ? 1 : 0;
    const score = exact || similarity(query, words);
    if (score >= 0.5) {
      scored.push({ ...note, score: Number(score.toFixed(2)) });
    }
  }
  scored.sort((a, b) => b.score - a.score || (b.lastUsed || b.createdAt || 0) - (a.lastUsed || a.createdAt || 0));
  return scored.slice(0, limit);
}

function collectTools(task) {
  const tools = [];
  for (const turn of task.turns || []) {
    if (turn.kind !== 'tool') continue;
    for (const result of turn.results || []) {
      tools.push({
        tool: String(result.tool || ''),
        ok: result.ok !== false,
        code: String(result.code || (result.ok === false ? 'ERROR' : '')).toUpperCase(),
        output: String(result.output || result.error || '').slice(0, 320)
      });
      if (tools.length >= 8) return tools;
    }
  }
  return tools;
}

export function rememberTask(task, usedIds = []) {
  if (!task || !['done', 'error'].includes(task.status)) return null;
  const tools = collectTools(task);
  // মডেল "হয়ে গেছে" লিখেও যদি ওই কাজের সব টুল ফেল করে, নোটটি ব্যর্থ হিসেবেই জমা হয় —
  // নাহলে পরেরবার বট সেই ✗ পথটাকেই ✓ ধরে বেরোয় (ভলিউমের সেট-অডিওডিভাইস গল্প এভাবেই ছড়ায়)
  const allToolsFailed = tools.length > 0 && tools.every((t) => t.ok === false);
  const outcome = task.status === 'done' && !allToolsFailed ? 'ok' : 'fail';
  const result =
    outcome === 'ok'
      ? typeof task.result === 'string'
        ? task.result
        : JSON.stringify(task.result || '')
      : '';
  const error =
    outcome === 'fail'
      ? String(
          task.error ||
            (allToolsFailed
              ? `টুলগুলো ব্যর্থ: ${tools.map((t) => t.tool).join(', ')} — মডেল সফল বলে লিখলেও কোনো টুলই চলেনি`
              : 'কাজটি ব্যর্থ হয়েছে')
        ).slice(0, 400)
      : '';
  if (outcome === 'ok' && !String(result).trim()) return null;

  const notes = loadNotes();
  const words = tokens(task.prompt);
  const now = Date.now();
  const target =
    notes.find((n) => n.id === idFor(task.prompt)) ||
    notes.find((n) => similarity(words, noteWords(n)) >= 0.8);
  const id = target?.id || idFor(task.prompt);
  const entry = {
    id,
    title: task.team?.groupName || String(task.prompt || '').slice(0, 60),
    prompt: String(task.prompt || '').slice(0, 400),
    keywords: words.slice(0, 24),
    result: String(result).slice(0, 3000),
    outcome,
    error,
    tools,
    okCount: (target?.okCount || 0) + (outcome === 'ok' ? 1 : 0),
    failCount: (target?.failCount || 0) + (outcome === 'fail' ? 1 : 0),
    team: task.team?.groupName || '',
    createdAt: target?.createdAt || now,
    lastUsed: now,
    hits: target?.hits || 0,
    uses: (target?.uses || 0) + 1
  };
  const next = [entry, ...notes.filter((n) => n.id !== id)].map((n) =>
    usedIds.includes(n.id) ? { ...n, hits: (n.hits || 0) + 1 } : n
  );
  saveNotes(next);
  return entry;
}

export function deleteNote(id) {
  const notes = loadNotes();
  const next = notes.filter((n) => n.id !== id);
  saveNotes(next);
  return notes.length !== next.length;
}

export function notesForUi(limit = 20) {
  return loadNotes()
    .slice(0, limit)
    .map((n) => ({
      id: n.id,
      title: n.title,
      prompt: n.prompt,
      result: String(n.result || '').slice(0, 1200),
      outcome: n.outcome || 'ok',
      error: n.error || '',
      okCount: n.okCount || 0,
      failCount: n.failCount || 0,
      tools: (n.tools || []).slice(0, 5),
      createdAt: n.createdAt,
      lastUsed: n.lastUsed,
      hits: n.hits || 0,
      uses: n.uses || 0
    }));
}
