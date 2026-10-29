// Self-learning: durable lessons extracted from task failures.
//
// A "lesson" is a short Bengali instruction tied to a signature
// (tool + error code + path shape). When a task fails, learnFromTask()
// records the failure; buildPrompt() in the orchestrator injects the
// matching lessons into every later task so bots stop repeating the
// same mistake. Bots can also write richer lessons via learn_lesson.

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

const LESSONS_FILE = path.join(ROOT, 'data', 'lessons.json');
const MAX_LESSONS = 60;

export function loadLessons() {
  try {
    const parsed = JSON.parse(fs.readFileSync(LESSONS_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLessons(list) {
  try {
    fs.mkdirSync(path.dirname(LESSONS_FILE), { recursive: true });
    fs.writeFileSync(LESSONS_FILE, JSON.stringify(list, null, 2), 'utf8');
  } catch {
    /* best-effort */
  }
}

function uid() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function addLesson({ signature, tool = '', code = '', lesson, keywords = [], sourceTask = '' }) {
  const list = loadLessons();
  const now = Date.now();
  const existing = list.find((l) => l.signature === signature);
  if (existing) {
    existing.count += 1;
    existing.at = now;
    existing.lesson = lesson;
    existing.keywords = keywords;
    existing.sourceTask = sourceTask || existing.sourceTask;
    list.sort((a, b) => b.at - a.at);
    saveLessons(list);
    return existing;
  }
  const entry = { id: uid(), signature, tool, code, lesson, keywords, sourceTask, at: now, count: 1 };
  list.push(entry);
  list.sort((a, b) => b.at - a.at);
  saveLessons(list.slice(0, MAX_LESSONS));
  return entry;
}

export function matchLessons(text, limit = 6) {
  const list = loadLessons();
  if (!list.length) return [];
  const t = String(text || '').toLowerCase();
  return list
    .map((l) => {
      let score = 0;
      for (const k of l.keywords || []) {
        if (k && t.includes(String(k).toLowerCase())) score += 3;
      }
      if (l.tool && t.includes(String(l.tool).toLowerCase())) score += 2;
      if (l.code && t.includes(String(l.code).toLowerCase())) score += 1;
      return { l, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.l.at - a.l.at)
    .slice(0, limit)
    .map((x) => x.l);
}

// Standard lessons per tool error code; a task that hits one of these
// records the generalized rule, so the next task gets warned in advance.
const CODE_LESSONS = {
  NOTFOUND: () =>
    `টুল "নেই" (NOTFOUND) বলেছিল — পাথ ভুল ছিল বা ফাইল/ফোল্ডার আগেই নেই। কাজ শুরুর আগে list_dir দিয়ে আসল পাথ যাচাই করো; Windows পাথ সবসময় forward slash-এ (C:/Users/...) লেখো।`,
  PROTECTED: () =>
    `নিরাপত্তা-সুরক্ষিত পাথ ছোঁয়া যায় না (PROTECTED)। সিস্টেম ফোল্ডার, হোম, ডেস্কটপ বা ড্রাইভ রুট নিজেই মুছতে/লিখতে চেয়ো না — শুধু ভেতরের নির্দিষ্ট ফাইল/ফোল্ডার নিয়ে কাজ করো।`,
  BUSY: () =>
    `ফাইল/ফোল্ডার অন্য অ্যাপে খোলা ছিল (BUSY)। ওই অ্যাপ বন্ধ করে আবার চেষ্টা করো, জোর করে দাবি কোরো না।`,
  ARGS: () => `টুল কল আর্গুমেন্ট ছাড়া পাঠানো হয়েছিল (ARGS) — প্রতিটি টুল কলের args ভরাট থাকতে হবে।`,
  FAILED: () =>
    `যাচাইয়ে ব্যর্থ হয়েছে (FAILED) — "হয়ে গেছে" বলার আগে টুলের ফলাফল দেখো; ব্যর্থ হলে সত্যিই আবার চেষ্টা করো।`,
  LOGIN: () =>
    `সাইটে লগইন ছিল না (LOGIN) — লগইন ছাড়া ওই প্রোভাইডার থেকে উত্তর আসে না; কাজটা অন্য প্রোভাইডারের বটে পাঠাও বা ইউজারকে লগইন করতে বলো।`,
  TIMEOUT: () => `উত্তর সময়মতো আসেনি (TIMEOUT) — অপ্রয়োজনীয় লম্বা প্রম্পট দিও না, সংক্ষিপ্ত নির্দেশ দাও।`,
  COMPOSER: () =>
    `চ্যাট বক্স পাওয়া যায়নি (COMPOSER) — পেজ লোড হতে দাও; লগইন থাকলে আবার চেষ্টা করো।`
};

function pathKey(text) {
  const m = String(text || '').match(/([A-Za-z]:[\\/][^\s'"']+|Desktop\/[^\s'"']+|workspace\/[^\s'"']+)/);
  return m ? m[1].replace(/[\\/]+$/, '').toLowerCase() : '';
}

export function learnFromTask(task) {
  const turns = Array.isArray(task?.turns) ? task.turns : [];
  const failures = [];
  for (const turn of turns) {
    if (turn.kind !== 'tool' || !Array.isArray(turn.results)) continue;
    for (const res of turn.results) {
      if (res && res.ok === false) {
        failures.push({
          tool: String(res.tool || ''),
          code: String(res.code || '').toUpperCase() || 'ERROR',
          error: String(res.error || res.output || '').slice(0, 220)
        });
      }
    }
  }
  if (!failures.length) return [];
  const added = [];
  for (const f of failures) {
    const template = CODE_LESSONS[f.code];
    const lesson = template ? template() : `"${f.tool}" টুল ব্যর্থ হয়েছিল (${f.code}): ${f.error} — এই ভুল আর কোরো না; অন্য পথে কাজ শেষ করো।`;
    const entry = addLesson({
      signature: `${f.tool || 'tool'}:${f.code}:${pathKey(f.error)}`,
      tool: f.tool,
      code: f.code,
      lesson,
      keywords: [f.tool, f.code.toLowerCase()].filter(Boolean),
      sourceTask: task.id || ''
    });
    if (!added.some((a) => a.id === entry.id)) added.push(entry);
  }
  return added;
}

export function lessonsForUi() {
  return loadLessons().slice(0, 12).map((l) => ({
    id: l.id,
    tool: l.tool,
    code: l.code,
    lesson: l.lesson,
    count: l.count,
    wins: l.wins || 0,
    at: l.at,
    sourceTask: l.sourceTask
  }));
}

// ওই টুল দিয়ে কোনো কাজ সফল হলে পাঠে "✓ পরে সফল" যোগ হয় —
// বট জানে আগের ভুলের পর কোন পথে গেলে কাজ হয়েছে।
export function noteOutcome(task) {
  if (!task || task.status !== 'done') return;
  const list = loadLessons();
  if (!list.length) return;
  const tools = new Set();
  for (const turn of task.turns || []) {
    if (turn.kind !== 'tool') continue;
    for (const r of turn.results || []) {
      if (r?.tool && r.ok !== false) tools.add(String(r.tool));
    }
  }
  if (!tools.size) return;
  let touched = false;
  for (const l of list) {
    if (l.tool && tools.has(String(l.tool))) {
      l.wins = (l.wins || 0) + 1;
      touched = true;
    }
  }
  if (touched) saveLessons(list);
}
