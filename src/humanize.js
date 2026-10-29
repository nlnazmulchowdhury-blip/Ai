import { jsonrepair } from 'jsonrepair';
import { extractJson } from './jsonparse.js';

// মডেল কখনো কাঁচা JSON ফিরিয়ে দেয় (থাম্ব-ট্রাঙ্কেটেডও)। ইউজার সেটা পড়তে পারে না,
// তাই ব্যবহারকারী-দেখা প্রতিটা লাইন এই ফাংশন দিয়ে যায়: ব্রেস/কী-নাম নেই, শুধু বাংলা বাক্য।

const BN_LABELS = {
  status: 'অবস্থা',
  reason: 'কারণ',
  required_details: 'আর যা জানা দরকার',
  required_details_list: 'আর যা জানা দরকার',
  required_info: 'আর যা জানা দরকার',
  required: 'আর যা জানা দরকার',
  needs: 'আর যা জানা দরকার',
  missing: 'যা নেই',
  details: 'বিস্তারিত',
  detail: 'বিস্তারিত',
  message: 'বার্তা',
  error: 'সমস্যা',
  blocker: 'আটকে আছে',
  summary: 'সারসংক্ষেপ',
  result: 'ফলাফল',
  results: 'ফলাফল',
  say: 'বলছে',
  answer: 'উত্তর',
  question: 'প্রশ্ন',
  text: 'লেখা',
  content: 'লেখা',
  output: 'ফলাফল',
  data: 'তথ্য',
  files: 'ফাইল',
  file: 'ফাইল',
  path: 'পাথ',
  url: 'লিঙ্ক',
  title: 'শিরোনাম',
  name: 'নাম',
  note: 'নোট',
  notes: 'নোট',
  steps: 'ধাপ',
  items: 'তালিকা',
  list: 'তালিকা',
  progress: 'অগ্রগতি',
  verdict: 'রায়',
  instruction: 'নির্দেশ',
  action: 'কাজ',
  done: 'যা হয়েছে',
  todo: 'যা বাকি',
  remaining: 'যা বাকি',
  next_steps: 'পরবর্তী ধাপ',
  suggestions: 'পরামর্শ',
  count: 'সংখ্যা',
  total: 'মোট',
  size: 'আকার',
  time: 'সময়',
  date: 'তারিখ',
  source: 'সূত্র',
  version: 'সংস্করণ',
  index: 'ক্রম',
  window: 'উইন্ডো',
  windows: 'উইন্ডো',
  volume: 'ভলিউম',
  brightness: 'উজ্জ্বলতা',
  verified: 'যাচাই',
  deleted: 'মুছে ফেলা',
  folder: 'ফোল্ডার',
  song: 'গান',
  artist: 'শিল্পী',
  video: 'ভিডিও',
  channel: 'চ্যানেল',
  browser: 'ব্রাউজার',
  tab: 'ট্যাব',
  active_window: 'সক্রিয় উইন্ডো',
  active_tab: 'সক্রিয় ট্যাব',
  other_tabs: 'অন্য ট্যাব',
  city: 'শহর',
  location: 'জায়গা',
  temperature: 'তাপমাত্রা',
  feels_like: 'অনুভূত হয়',
  humidity: 'আর্দ্রতা',
  condition: 'আকাশ',
  primary_source: 'মূল সূত্র',
  sources: 'সূত্র',
  target_identified: 'টার্গেট পাওয়া',
  language: 'ভাষা',
  meaning: 'অর্থ',
  heading: 'শিরোনাম',
  screenshot: 'স্ক্রিনশট',
  status_message: 'বার্তা'
};

// বটের এনভেলপের নিয়ন্ত্রণ-কী — ইউজারের সামনে এগুলো অর্থহীন
const CONTROL_KEYS = new Set(['next', 'pc', 'final', 'salvaged', 'tool', 'args', 'tools', 'ok', 'at', 'ms', 'id']);
// যাদের মান নিজেই স্বাভাবিক বাক্য — ওদের সামনে লেবেল বসালে ভাঙা শোনায়
const BARE_KEYS = new Set(['result', 'say', 'answer', 'message', 'summary', 'text', 'content', 'data', 'output']);
const PRIORITY = [
  'result', 'say', 'answer', 'message', 'summary', 'text', 'content',
  'status', 'reason', 'error', 'blocker', 'required_details', 'required_info',
  'details', 'data', 'output', 'question', 'progress'
];

const DONE_RE = /^(done|ok|okay|success(?:ful)?|complete(?:d)?|সম্পূর্ণ|সফল|ঠিক|হয়ে গেছে)$/i;
const BAD_RE = /^(fail(?:ed)?|error|rejected|ব্যর্থ|ত্রুটি|হয়নি|no)$/i;
const PART_RE = /^(incomplete|partial|pending|unsure|unclear|unknown|অসম্পূর্ণ|আংশিক|অস্পষ্ট)$/i;
const KEY_HINT_RE = /["{][^"\n]{1,40}"\s*:/;

const keyLabel = (key) => {
  const k = String(key).trim().toLowerCase().replace(/[\-\s]+/g, '_');
  if (BN_LABELS[k]) return BN_LABELS[k];
  return String(key).trim().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ');
};

const sentence = (s) => {
  const t = String(s).replace(/\s+/g, ' ').trim().replace(/[,;:\s]+$/, '');
  if (!t) return '';
  return /[.!?।]$/.test(t) ? t : `${t}।`;
};

function inline(value, depth = 0) {
  if (value == null || value === false) return '';
  if (value === true) return 'হ্যাঁ';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    const parts = value.map((v) => inline(v, depth + 1)).filter(Boolean);
    if (depth >= 2 && parts.length > 6) return `${parts.slice(0, 6).join(', ')} ইত্যাদি`;
    return parts.join(', ');
  }
  if (typeof value === 'object') {
    return Object.entries(value)
      .filter(([k]) => !CONTROL_KEYS.has(String(k).trim().toLowerCase()))
      .map(([k, v]) => {
        const text = inline(v, depth + 1);
        if (!text) return '';
        return BARE_KEYS.has(String(k).trim().toLowerCase()) ? text : `${keyLabel(k)} ${text}`;
      })
      .filter(Boolean)
      .join(', ');
  }
  return String(value);
}

// {"status":"অসম্পূর্ণ"} → পূর্ণ বাক্য, কারণ এক শব্দ ইউজারের কিছু বলে না
function statusPhrase(value) {
  const t = String(value ?? '').trim();
  if (!t) return '';
  if (DONE_RE.test(t)) return '✓ কাজটা সম্পন্ন হয়েছে';
  if (BAD_RE.test(t)) return '✗ কাজটা হয়নি';
  if (PART_RE.test(t)) return '⚠ কাজটা অসম্পূর্ণ';
  return `অবস্থা: ${t}`;
}

function renderObject(obj) {
  const all = Object.keys(obj).map((k) => ({ key: k, low: String(k).trim().toLowerCase() }));
  const envelope = all.some(({ low }) => low === 'say' || low === 'pc' || low === 'next')
    || Object.prototype.hasOwnProperty.call(obj, 'final');
  const skip = new Set(CONTROL_KEYS);
  if (envelope) skip.add('task');
  const keys = all.filter(({ low }) => !skip.has(low));
  const ordered = [
    ...PRIORITY.map((p) => keys.find(({ low }) => low === p)).filter(Boolean),
    ...keys.filter(({ low }) => !PRIORITY.includes(low))
  ];
  const lines = [];
  for (const { key, low } of ordered) {
    const text = inline(obj[key]);
    if (!text) continue;
    if (low === 'status') lines.push(statusPhrase(text));
    else lines.push(BARE_KEYS.has(low) ? text : `${keyLabel(key)}: ${text}`);
  }
  // শুধু {"ok":true}/{"ok":false} — বাকি কিছু নেই
  if (!lines.length && Object.prototype.hasOwnProperty.call(obj, 'ok')) {
    lines.push(statusPhrase(obj.ok === false ? 'failed' : 'done'));
  }
  return lines.filter(Boolean).map(sentence).join(' ');
}

function scrub(s) {
  return String(s)
    .replace(/```[a-z]*/gi, ' ')
    .replace(/[{}[\]]/g, ' ')
    .replace(/["“”‘’]/g, '')
    .replace(/^[,\s:;]+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// কিছুতেই না পড়লে: কী-নাম আর ব্রেস কেটে বাকি লেখাটাই রেখো
function stripJsonish(raw) {
  return String(raw)
    .replace(/"[^"\n]{1,48}"\s*:/g, ' ')
    .replace(/"[^"\n]{0,48}$/g, '')
    .replace(/[{}[\],]/g, ' ')
    .replace(/"/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function findJsonSpan(s) {
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i += 1) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return [start, i];
    }
  }
  // বন্ধ ব্রেস নেই (কাটা উত্তর) — বাকি পুরোটাই ব্লব
  return [start, s.length - 1];
}

function parseLooseAny(raw) {
  const direct = extractJson(raw);
  if (direct) return direct;
  for (const slice of [raw.slice(raw.indexOf('{')), raw.replace(/^[\s\S]*?```(?:json)?\s*/i, '')]) {
    if (!slice.trim()) continue;
    try {
      const repaired = JSON.parse(jsonrepair(slice));
      if (repaired && typeof repaired === 'object') return repaired;
    } catch {
      /* truncated beyond repair — stripJsonish handles it */
    }
  }
  return null;
}

export function looksJsonish(text) {
  const raw = String(text || '');
  if (!/[{}]/.test(raw)) return false;
  if (/```[\s\S]*[{]/.test(raw)) return true;
  return KEY_HINT_RE.test(raw);
}

/** যেকোনো ইউজার-দেখা লেখাকে সমতল বাংলা বাক্যে বদলায়। JSON না থাকলে অপরিবর্তিত রাখে। */
export function humanText(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return '';
  // খালি/শুধু-ব্রেস JSON → বলার কিছু নেই, কলারই ফallback বসাবে
  if (!/[a-z\u0980-\u09ff]/i.test(raw)) return '';
  if (!looksJsonish(raw)) return raw;
  const span = findJsonSpan(raw);
  const before = span ? scrub(raw.slice(0, span[0])) : '';
  const after = span ? scrub(raw.slice(span[1] + 1)) : '';
  const blob = span ? raw.slice(span[0], span[1] + 1) : raw;
  const parsed = parseLooseAny(blob);
  const body = parsed
    ? scrub(renderObject(parsed))
    : KEY_HINT_RE.test(blob)
      ? scrub(stripJsonish(blob))
      : scrub(blob);
  const joined = [before, body, after].filter(Boolean).join(' ');
  if (joined) return sentence(joined);
  return 'মডেলের উত্তরটি পড়ার মতো অবস্থায় ছিল না — ফলাফল নোটে জমা আছে।';
}
