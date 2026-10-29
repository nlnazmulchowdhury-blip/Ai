// public-apis catalog: github.com/public-apis/public-apis (MIT, branch master).
//
// The repo ships no data.json and api.publicapis.org is dead, so the catalog is
// parsed out of README.md tables into data/public-apis.json. That local index is
// what answers "কোনো API লাগবে" type questions instantly — no browser, no model.

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

const CATALOG_FILE = path.join(ROOT, 'data', 'public-apis.json');
const README_URL = 'https://raw.githubusercontent.com/public-apis/public-apis/master/README.md';
const SOURCE_LABEL = 'public-apis/public-apis';

const bn = (s) => String(s || '');

// Bengali / romanized triggers -> English search terms used in the catalog.
const BN_TO_EN = {
  'আবহাওয়া': 'weather forecast temperature rain',
  'আমান': 'weather',
  'বৃষ্টি': 'rain weather forecast',
  'অনুবাদ': 'translation translate language',
  'মানচিত্র': 'map mapbox geocoding',
  'ম্যাপ': 'map geocoding',
  'ঠিকানা': 'address geocoding ip location',
  'লোকেশন': 'location geocoding ip',
  'জায়গা': 'location geocoding places',
  'সংবাদ': 'news headlines',
  'খবর': 'news headlines',
  'মুদ্রা': 'currency exchange rate',
  'টাকা': 'currency exchange money',
  'বিনিময়': 'exchange rate currency',
  'ক্রিপ্টো': 'crypto bitcoin cryptocurrency exchange',
  'বিটকয়েন': 'bitcoin crypto price',
  'শেয়ার': 'stock market finance',
  'বাজার': 'stock market finance',
  'লেনদেন': 'stock finance trading',
  'ফান্ড': 'finance fund',
  'ব্যাংক': 'finance bank',
  'ছবি': 'image picture photo placeholder',
  'ছবির': 'image picture photo',
  'ফটো': 'photo image photography',
  'ভিডিও': 'video youtube movies',
  'সিনেমা': 'movie films database',
  'মুভি': 'movie films database',
  'এনিমে': 'anime',
  'গান': 'music song lyrics',
  'সংগীত': 'music',
  'বই': 'book books',
  'লেখক': 'book author',
  'খেলা': 'sports cricket football score',
  'ক্রিকেট': 'cricket sports score',
  'ফুটবল': 'football sports score',
  'স্কোর': 'score sports match',
  'গেম': 'game comics',
  'কমিক': 'comics game',
  'খাবার': 'food recipe drink',
  'রেসিপি': 'recipe food',
  'পানীয়': 'drink beverage food',
  'চাকরি': 'job jobs hiring',
  'কাজের': 'job',
  'পরিবেশ': 'environment pollution air quality',
  'বায়ু': 'air quality environment pollution',
  'স্বাস্থ্য': 'health disease nutrition',
  'ওষুধ': 'health medicine drug pharmacy',
  'ঔষধ': 'health medicine drug',
  'রোগ': 'health disease',
  'জন্মতারিখ': 'calendar holiday date',
  'ছুটি': 'holiday calendar',
  'ক্যালেন্ডার': 'calendar holiday',
  'তারিখ': 'date calendar time',
  'সময়': 'time date',
  'ইমেল': 'email mail verification',
  'মেইল': 'email mail verification',
  'ফোন': 'phone number validation sms',
  'নম্বর': 'phone number validation',
  'এসএমএস': 'sms phone',
  // joke APIs live in Personality and Games & Comics — don't bias toward the category
  'জোক': 'joke jokes',
  'মজা': 'joke jokes fun meme',
  'হাসি': 'joke fun',
  'উক্তি': 'quote quotes',
  'কোট': 'quote',
  'কবিতা': 'poetry quote',
  'ছড়া': 'poetry',
  'শব্দকোষ': 'dictionary words definitions thesaurus',
  'অর্থ': 'dictionary definition words',
  'শব্দ': 'dictionary words',
  'বানান': 'dictionary spelling words',
  'জিপিএস': 'gps location geocoding',
  'আইপি': 'ip address geolocation',
  'ডিএনএস': 'dns security',
  'নিরাপত্তা': 'security ssl malware virus',
  'ভাইরাস': 'malware virus security',
  'পাসওয়ার্ড': 'password security generator',
  'প্রলেট': 'ssl certificate security',
  'কুরিয়ার': 'tracking shipment postal courier',
  'শিপিং': 'tracking shipment',
  'পার্সেল': 'tracking shipment postal',
  'ডাক': 'postal tracking shipment',
  'বাস': 'transportation transit bus',
  'ট্রেন': 'transit train transportation',
  'ফ্লাইট': 'flight aviation transportation',
  'উড়ান': 'flight aviation',
  'বিমান': 'flight aviation airport',
  'যান': 'transportation transit',
  'গাড়ি': 'vehicle car',
  'লিংক ছোট': 'url shortener',
  'শর্টনার': 'url shortener',
  'সংক্ষেপ': 'url shortener',
  'কোদ': 'qr code',
  'কিউআর': 'qr code',
  'বারকোড': 'barcode qr code',
  'ব্রাউজার': 'browser development tools',
  'স্ক্র্যাপ': 'scraping html development',
  'html': 'html parsing development scraping',
  'মಾರ্কডাউন': 'markdown converter development',
  'পিডিএফ': 'pdf documents',
  'ফন্ট': 'font typography art design',
  'লোগো': 'logo icon art design',
  'আইকন': 'icon art design',
  'রঙ': 'color palette hex art design',
  'কালার': 'color palette hex art design',
  'প্রতিস্থা': 'ai ml machine learning',
  'বুদ্ধিমত্তা': 'ai machine learning',
  'এআই': 'ai machine learning text generation',
  'স্পিচ': 'speech text to speech voice transcription',
  'ভাষা': 'language translation',
  'কণ্ঠ': 'voice speech text to speech',
  'ওসিআর': 'ocr image text',
  'টেক্সট': 'text analysis sentiment language',
  'ভাব': 'sentiment text analysis',
  'জাতিসংঘ': 'open data country statistics',
  'দেশ': 'country open data statistics',
  'জনসংখ্যা': 'open data statistics country',
  'পরিসংখ্যান': 'statistics open data',
  'সরকার': 'government open data',
  'পেটেন্ট': 'patent',
  'স্টোরেজ': 'cloud storage file sharing',
  'ফাইল শেয়ার': 'cloud storage file sharing',
  'সিআই': 'continuous integration build',
  'ব্লকচেইন': 'blockchain crypto',
  'ইথেরিয়াম': 'ethereum blockchain crypto',
  'ভালালিডেশন': 'validation data email phone',
  'যাচাই': 'validation email phone',
  'ওপেন ডেটা': 'open data',
  'ঘটনা': 'events concerts',
  'অনুষ্ঠান': 'events concerts',
  'ব্যবসা': 'business finance company',
  'কোম্পানি': 'business company finance',
  'অংশীদার': 'business',
  'ক্রিপ্টোগ্রাফি': 'encryption security authentication',
  'লগইন': 'authentication authorization oauth',
  'অথ': 'authentication authorization oauth jwt',
  'টোকেন': 'authentication jwt token',
  'টেস্ট ডেটা': 'test data faker dummy',
  'নকল ডেটা': 'test data dummy faker',
  'প্রোগ্রামিং': 'programming development learning',
  'শেখার': 'learning education development',
  'সাইন্স': 'science math calculation',
  'বিজ্ঞান': 'science math',
  'গণিত': 'math calculation',
  'হিসাব': 'math calculation',
  'সোশ্যাল': 'social media',
  'শপিং': 'shopping ecommerce',
  'কেনাকাটা': 'shopping ecommerce',
  'ডিভেলপমেন্ট': 'development tools testing',
  'ডেটা': 'data open data',
  'এপিআই': 'api',
  'এন্ডপয়েন্ট': 'endpoint api',
  'বেসরকারি': 'open',
  'অবহাওয়া': 'weather forecast',
  'anobad': 'translation translate',
  'onubad': 'translation translate',
  'abohawa': 'weather forecast',
  'hawa': 'weather forecast air',
  'manchitro': 'map geocoding',
  'thikana': 'address geocoding',
  'lokeshon': 'location ip geocoding',
  'khobor': 'news headlines',
  'shongbad': 'news headlines',
  'mudra': 'currency exchange rate',
  'taka': 'currency exchange money',
  'binimoy': 'exchange currency rate',
  'bazar': 'stock market finance',
  'chakri': 'job jobs hiring',
  'khela': 'sports cricket football score',
  'gaan': 'music song lyrics',
  'shonggit': 'music',
  'chobi': 'image picture photo',
  'photo': 'photo image photography',
  'video': 'video youtube movies',
  'movie': 'movie films database',
  'cinema': 'movie films database',
  'boi': 'book books',
  'jok': 'joke jokes',
  'maja': 'joke fun meme personality',
  'hobi': 'joke fun',
  'ukti': 'quote quotes',
  'kobita': 'poetry quote',
  'shobdokosh': 'dictionary words definitions',
  'artha': 'dictionary definition words meaning',
  'shobdo': 'dictionary words',
  'jips': 'gps location geocoding',
  'ip': 'ip address geolocation',
  'nirapotta': 'security ssl malware',
  'virus': 'malware virus security',
  'password': 'password security generator',
  'kurier': 'tracking shipment postal',
  'parcel': 'tracking shipment postal',
  'bus': 'transportation transit',
  'train': 'transit train transportation',
  'flight': 'flight aviation transportation',
  'udano': 'flight aviation',
  'gori': 'vehicle car',
  'qr': 'qr code',
  'barcode': 'barcode qr code',
  'font': 'font typography art design',
  'logo': 'logo icon art design',
  'icon': 'icon art design',
  'rong': 'color palette hex art design',
  'color': 'color palette hex art design',
  'ai': 'ai machine learning text generation',
  'speech': 'speech voice recognition',
  'bhasa': 'language speech text analysis',
  'kontho': 'voice speech text to speech',
  'ocr': 'ocr image text',
  'desh': 'country open data statistics',
  'jonosongkhya': 'open data statistics population',
  'porisongkhan': 'statistics open data',
  'sorkar': 'government open data',
  'storage': 'cloud storage file sharing',
  'blockchain': 'blockchain crypto',
  'valid': 'validation data email phone',
  'jachai': 'validation email phone',
  'business': 'business finance company',
  'login': 'authentication authorization oauth',
  'auth': 'authentication authorization oauth jwt',
  'token': 'authentication jwt token',
  'programming': 'programming development learning',
  'biggan': 'science math',
  'gonit': 'math calculation',
  'hisab': 'math calculation',
  'social': 'social media',
  'shopping': 'shopping ecommerce',
  'kenakata': 'shopping ecommerce',

  'bank': 'finance bank',
  'travel': 'transportation flight',
  'job': 'job jobs hiring',
  'news': 'news headlines'
};

// Bengali label shown next to an English category name.
const CAT_BN = {
  'Animals': 'প্রাণী',
  'Anime': 'এনিমে',
  'Anti-Malware': 'অ্যান্টি-ম্যালওয়্যার',
  'Art & Design': 'শিল্প ও ডিজাইন',
  'Authentication & Authorization': 'লগইন/অথেন্টিকেশন',
  'Blockchain': 'ব্লকচেইন',
  'Books': 'বই',
  'Business': 'ব্যবসা',
  'Calendar': 'ক্যালেন্ডার',
  'Cloud Storage & File Sharing': 'ক্লাউড স্টোরেজ',
  'Continuous Integration': 'সিআই/বিল্ড',
  'Cryptocurrency': 'ক্রিপ্টো',
  'Currency Exchange': 'মুদ্রা বিনিময়',
  'Data Validation': 'ডেটা যাচাই',
  'Development': 'ডেভেলপমেন্ট',
  'Dictionaries': 'শব্দকোষ',
  'Documents & Productivity': 'ডকুমেন্ট',
  'Email': 'ইমেইল',
  'Entertainment': 'বিনোদন',
  'Environment': 'পরিবেশ',
  'Events': 'ইভেন্ট',
  'Finance': 'ফাইন্যান্স',
  'Food & Drink': 'খাবার ও পানীয়',
  'Games & Comics': 'গেম ও কমিক',
  'Geocoding': 'জিওকোডিং/ম্যাপ',
  'Government': 'সরকারি',
  'Health': 'স্বাস্থ্য',
  'Jobs': 'চাকরি',
  'Machine Learning': 'মেশিন লার্নিং',
  'Music': 'সংগীত',
  'News': 'সংবাদ',
  'Open Data': 'ওপেন ডেটা',
  'Open Source Projects': 'ওপেন সোর্স',
  'Patent': 'পেটেন্ট',
  'Personality': 'মজার/ব্যক্তিত্ব',
  'Phone': 'ফোন',
  'Photography': 'ফটোগ্রাফি',
  'Programming': 'প্রোগ্রামিং',
  'Science & Math': 'বিজ্ঞান ও গণিত',
  'Security': 'নিরাপত্তা',
  'Shopping': 'শপিং',
  'Social': 'সোশ্যাল',
  'Sports & Fitness': 'খেলাধুলা',
  'Test Data': 'টেস্ট ডেটা',
  'Text Analysis': 'টেক্সট অ্যানালাইসিস',
  'Tracking': 'ট্র্যাকিং',
  'Transportation': 'যানবাহন',
  'URL Shorteners': 'URL শর্টনার',
  'Vehicle': 'যান',
  'Video': 'ভিডিও',
  'Weather': 'আবহাওয়া'
};

const AUTH_VALUE = /^(no|none|oauth|apikey|api ?key|required|cookie|basic|jwt|anonymous)$/i;
const YES_NO = /^(yes|no)$/i;

function splitRow(cells) {
  let rest = cells.slice(1);
  let tail = rest.slice(-3);
  // some README rows carry an extra trailing column (e.g. "| apiKey | Yes | No | Yes")
  if (tail.length === 3 && YES_NO.test(cleanCell(tail[0])) && AUTH_VALUE.test(cleanCell(rest[rest.length - 4]))) {
    tail = rest.slice(-4, -1);
    rest = rest.slice(0, -4);
  } else {
    rest = rest.slice(0, -3);
  }
  return { desc: cleanCell(rest.join('|')), auth: cleanCell(tail[0]), https: cleanCell(tail[1]), cors: cleanCell(tail[2]) };
}

function cleanCell(s) {
  return String(s || '')
    .replace(/`/g, '')
    .replace(/\*\*/g, '')
    .trim();
}

function stripUtm(url) {
  const base = String(url || '').trim();
  if (!base) return '';
  try {
    const u = new URL(base);
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|ref=|referral|src=)/i.test(k)) u.searchParams.delete(k);
    }
    return `${u.origin}${u.pathname === '/' ? '' : u.pathname}${u.search}${u.hash}`;
  } catch {
    return base;
  }
}

// README.md tables: | API | Description | Auth | HTTPS | CORS |
// Rows may carry an extra trailing pipe or a "|" inside the description,
// so the name is the first cell and auth/https/cors are the last three.
export function parseReadme(md) {
  const entries = [];
  const lines = String(md || '').split(/\r?\n/);
  let pending = '';
  let active = '';
  for (const line of lines) {
    const head = line.match(/^#{2,4}\s+(.+?)\s*$/);
    if (head) {
      pending = cleanCell(head[1]);
      active = '';
      continue;
    }
    if (/^\|?\s*API\s*\|\s*Description\s*\|/i.test(line)) {
      active = /auth/i.test(line) && /https/i.test(line) ? pending : '';
      continue;
    }
    if (!active || !line.trim().startsWith('|')) continue;
    const cells = line.split('|');
    cells.shift();
    while (cells.length && cells[cells.length - 1].trim() === '') cells.pop();
    if (cells.length < 4) continue;
    const link = cells[0].match(/\[([^\]]+)\]\(([^)]+)\)/);
    if (!link) continue;
    const { desc, auth, https, cors } = splitRow(cells);
    const name = cleanCell(link[1]);
    if (!name || !desc) continue;
    entries.push({ name, url: stripUtm(link[2]), desc, auth: auth || 'No', https: https || 'Yes', cors: cors || 'Unknown', category: active });
  }
  // the APILayer "best sellers" block uses the same table shape but sells paid APIs
  const filtered = entries.filter(
    (e) => !/apilayer\.com|utm_source=Github/i.test(e.url) && !/^apilayer\s/i.test(e.name)
  );
  const seen = new Set();
  const out = [];
  for (const e of filtered) {
    const key = `${e.category}|${e.name}|${e.url}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

let cache = null;
let cacheMtime = 0;

function readFile() {
  const st = fs.statSync(CATALOG_FILE);
  if (cache && cacheMtime === st.mtimeMs) return cache;
  try {
    const parsed = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'));
    const entries = (Array.isArray(parsed.entries) ? parsed.entries : []).map((e) => ({
      ...e,
      host: hostnameOf(e.url),
      ln: bn(e.name).toLowerCase(),
      ld: bn(e.desc).toLowerCase(),
      lc: bn(e.category).toLowerCase()
    }));
    cache = {
      updatedAt: Number(parsed.updatedAt) || 0,
      source: String(parsed.source || SOURCE_LABEL),
      entries
    };
    cacheMtime = st.mtimeMs;
    return cache;
  } catch {
    return { updatedAt: 0, source: SOURCE_LABEL, entries: [] };
  }
}

export function loadCatalog() {
  try {
    if (!fs.existsSync(CATALOG_FILE)) return { updatedAt: 0, source: SOURCE_LABEL, entries: [] };
    return readFile();
  } catch {
    return { updatedAt: 0, source: SOURCE_LABEL, entries: [] };
  }
}

export function saveCatalog(entries) {
  const payload = {
    updatedAt: Date.now(),
    source: SOURCE_LABEL,
    count: entries.length,
    categories: [ ...new Set(entries.map((e) => e.category)) ].sort(),
    entries
  };
  fs.mkdirSync(path.dirname(CATALOG_FILE), { recursive: true });
  const tmp = `${CATALOG_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload), 'utf8');
  fs.renameSync(tmp, CATALOG_FILE);
  cache = null;
  cacheMtime = 0;
  return payload;
}

export async function refreshCatalog() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const res = await fetch(README_URL, {
      signal: controller.signal,
      headers: { 'user-agent': 'pc-agent/1.0' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const md = await res.text();
    const entries = parseReadme(md);
    if (entries.length < 500) throw new Error(`টেবিল পড়া যায়নি (মাত্র ${entries.length} সারি)`);
    const saved = saveCatalog(entries);
    return { ok: true, count: saved.count, categories: saved.categories.length, updatedAt: saved.updatedAt };
  } finally {
    clearTimeout(timer);
  }
}

export function ensureCatalog() {
  const cat = loadCatalog();
  if (cat.entries.length) return Promise.resolve({ ok: true, count: cat.entries.length, cached: true });
  return refreshCatalog().catch((err) => ({ ok: false, error: err.message || String(err) }));
}

export function catalogStats() {
  const cat = loadCatalog();
  const byCat = {};
  for (const e of cat.entries) byCat[e.category] = (byCat[e.category] || 0) + 1;
  return {
    ok: true,
    count: cat.entries.length,
    categories: Object.entries(byCat)
      .map(([name, n]) => ({ name, bn: CAT_BN[name] || '', count: n }))
      .sort((a, b) => b.count - a.count),
    updatedAt: cat.updatedAt,
    source: cat.source
  };
}

function expandQuery(q) {
  const raw = bn(q).toLowerCase();
  const words = raw
    .replace(/[^a-z0-9\u0980-\u09ff ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);
  const extra = new Set();
  for (const [key, en] of Object.entries(BN_TO_EN)) {
    // Bengali triggers match as substrings (conjunct forms); latin ones need a whole word,
    // otherwise "email" would fire the "ai" entry.
    const hit = /^[a-z0-9]+$/.test(key) ? words.includes(key) : raw.includes(key);
    if (hit) for (const t of en.split(/\s+/)) extra.add(t);
  }
  const stop = new Set(['the', 'for', 'and', 'with', 'to', 'of', 'in', 'on', 'at', 'is', 'are', 'can', 'a', 'an', 'based', 'type', 'like', 'using', 'from', 'into', 'api', 'apis', 'এপিআই', 'একটা', 'একটি', 'করে', 'দাও', 'চাই', 'আছে', 'লাগবে', 'লাগে', 'what', 'which', 'know', 'list', 'give', 'need', 'want', 'there', 'about', 'from', 'using']);
  // two-letter acronyms that ARE the whole search term
  const KEEP_SHORT = new Set(['qr', 'ai', 'ip', 'ml', 'db', 'cv', 'tts', 'stt', 'ux', 'bn', 'url', 'pdf', 'seo', 'sms', 'it']);
  const terms = [...new Set([...words, ...extra])].filter((w) => (w.length > 2 || KEEP_SHORT.has(w)) && !stop.has(w));
  return { raw, terms };
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// Terms so broad they match nearly every row — kept, but at low weight.
const GENERIC = new Set(['text', 'data', 'json', 'free', 'new', 'open', 'world', 'public', 'tool', 'tools', 'language', 'image', 'images', 'video', 'file', 'files', 'web', 'site', 'search']);

// "Invoice" contains "voice" — mid-word hits must not outrank real word matches.
function wordStartRe(t) {
  return new RegExp(`(^|[^a-z0-9\u0980-\u09ff])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
}

function hit(hay, t, re) {
  if (!hay.includes(t)) return 0;
  return re.test(hay) ? 1 : 0.3;
}

// Modifier words ("auth", "free", "live") describe HOW an API works, not what it
// is — they must never beat the domain term ("weather", "translate").
const MODIFIER = new Set(['auth', 'authentication', 'authorization', 'free', 'open', 'public', 'no', 'simple', 'easy', 'fast', 'best', 'top', 'new', 'current', 'live', 'real', 'time', 'secure', 'https', 'cors', 'json']);

// Brand names are glued together (LibreTranslate, ipgeolocation), so a mid-word
// hit there still counts; descriptions are prose, so "Invoice" ≠ "voice".
function nameHit(name, t, re) {
  if (!name.includes(t)) return 0;
  return re.test(name) ? 1 : 0.7;
}

// The README table stores each project's website, so these hosts are *always*
// docs/marketplace pages — a listing there needs an account before any call, and
// must never outrank a directly callable endpoint.
const DOCS_ONLY_HOSTS = /rapidapi\.com$/i;

function scoreEntry(e, terms, raw, weight, bounds) {
  const name = e.ln || bn(e.name).toLowerCase();
  const desc = e.ld || '';
  const cat = e.lc || '';
  const host = e.host || '';
  let s = 0;
  for (const t of terms) {
    const iw = weight(t);
    const re = bounds.get(t);
    const nh = nameHit(name, t, re);
    if (name === t) s += 8 * iw;
    else if (nh) s += (name.startsWith(t) ? 5 : 4) * iw * nh;
    const cbn = bn(CAT_BN[e.category]).toLowerCase();
    const ch = hit(cat, t, re);
    if (!MODIFIER.has(t) && (cat === t || cbn === t)) s += 8 * iw;
    else if (ch) s += 3 * iw * ch;
    const dh = hit(desc, t, re);
    if (dh) s += 1.5 * iw * dh;
    const hh = hit(host, t, re);
    if (hh) s += 2 * iw * hh;
    if (t.length > 2 && bn(e.auth).toLowerCase().includes(t)) s += iw;
  }
  if (raw && name.includes(raw)) s += 6;
  if (/(no|none|open)/.test(raw) && /^no$/i.test(e.auth)) s += 1.5;
  if (DOCS_ONLY_HOSTS.test(host)) s *= 0.3;
  return s;
}

export function searchApis(query, opts = {}) {
  const cat = loadCatalog();
  if (!cat.entries.length) return [];
  const { raw, terms } = expandQuery(query);
  const limit = Math.max(1, Math.min(25, Number(opts.limit) || 8));
  const wantedRaw = bn(opts.category).trim().toLowerCase();
  const wantedCat = wantedRaw
    ? Object.entries(CAT_BN).find(([en, b]) => en.toLowerCase() === wantedRaw || b.toLowerCase() === wantedRaw)?.[0]?.toLowerCase() || wantedRaw
    : '';
  const wantFree = /(\bno\b|free|ফ্রি|বিনামূল|খরচ ছাড়া)/i.test(bn(query));
  const all = wantedCat ? cat.entries.filter((e) => e.lc === wantedCat || e.lc.includes(wantedCat)) : cat.entries;
  // IDF: "text" appears in hundreds of rows, "speech" in a handful — the rare
  // word is what the user actually means, so it must carry the ranking.
  const total = all.length;
  const df = new Map(terms.map((t) => [t, 0]));
  for (const e of all) {
    for (const t of terms) {
      if (e.ln.includes(t) || e.ld.includes(t) || e.lc.includes(t) || e.host.includes(t)) df.set(t, df.get(t) + 1);
    }
  }
  const weight = (t) => {
    const c = df.get(t) || 1;
    const w = Math.max(0.25, Math.min(1.2, Math.log10(Math.max(10, total) / c) / 2));
    if (MODIFIER.has(t)) return Math.min(w, 0.4);
    return GENERIC.has(t) ? w * 0.4 : w;
  };
  const bounds = new Map(terms.map((t) => [t, wordStartRe(t)]));
  const scored = [];
  for (const e of all) {
    let s = scoreEntry(e, terms, raw, weight, bounds);
    if (wantFree && /^no$/i.test(e.auth)) s += 3;
    if (s > 0) scored.push({ e, s });
  }
  // A query usually means one category ("অনুবাদ" = Text Analysis, not the joke
  // translator in Games & Comics) — boost the categories holding the best hits.
  const best = new Map();
  for (const { e, s } of scored) {
    const top = best.get(e.category) || [];
    top.push(s);
    top.sort((a, b) => b - a);
    best.set(e.category, top.slice(0, 3));
  }
  const ranked = [...best.entries()]
    .map(([c, arr]) => ({ c, v: arr.reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.v - a.v);
  const boost = new Map(ranked.slice(0, 2).map((r, i) => [r.c, i === 0 ? 4 : 1.5]));
  for (const r of scored) r.s += boost.get(r.e.category) || 0;
  scored.sort((a, b) => b.s - a.s || a.e.name.localeCompare(b.e.name));
  return scored.slice(0, limit).map(({ e, s }) => ({ ...e, score: Math.round(s * 10) / 10 }));
}

export function apiCategories(query = '') {
  const cat = loadCatalog();
  const set = new Map();
  for (const e of cat.entries) {
    if (!set.has(e.category)) set.set(e.category, { name: e.category, bn: CAT_BN[e.category] || '', count: 0 });
    set.get(e.category).count += 1;
  }
  const list = [...set.values()].sort((a, b) => a.name.localeCompare(b.name));
  if (!query) return list;
  const { terms } = expandQuery(query);
  return list.filter((c) => {
    const hay = `${c.name} ${c.bn}`.toLowerCase();
    return terms.some((t) => hay.includes(t));
  });
}

function bnDigits(n) {
  return String(n).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)]);
}

export function formatCatalogAnswer(query, results, opts = {}) {
  const cat = loadCatalog();
  const total = cat.entries.length;
  if (!results.length) {
    if (opts.lead) return opts.lead.trim();
    return total
      ? `public-apis ক্যাটালগে (${bnDigits(total)}টি API) "${query}" এর মিল পাইনি — অন্য শব্দে বলো, আবার খুঁজব।`
      : '';
  }
  const max = opts.max || 6;
  const shown = results.slice(0, max);
  const lines = shown.map((r, i) => {
    const label = CAT_BN[r.category];
    const head = `${bnDigits(i + 1)}. ${r.name} — ${r.category}${label ? ` (${label})` : ''}`;
    const free = /^no$/i.test(r.auth) ? ' · লগইন/কী লাগে না' : ` · Auth: ${r.auth}`;
    return `${head}\n   ${r.desc}${free}\n   ${r.url}`;
  });
  const more =
    results.length > max
      ? `\n\nআরও ${bnDigits(results.length - max)}টি মিল আছে — "আরও" বললেই বের করে দেব।`
      : '';
  const lead =
    opts.lead ??
    `তৎক্ষণাৎ খুঁজে পেয়েছি (${SOURCE_LABEL}, ${bnDigits(total)}টি API এর ভেতর) — "${query}" এর জন্য ${bnDigits(results.length)}টি মিল:\n\n`;
  const offer = opts.offer === false ? '' : `\n\nচাইলে যেকোনো একটার ডকুমেন্টেশন ব্রাউজারে খুলে দেব, বা এটা লাগিয়ে কোড লিখে দেব।`;
  return `${lead}${lines.join('\n\n')}${more}${offer}`;
}

// Instant local answer lane: API-catalog questions never touch a model or browser.
const API_WORD = /(api|apis|এপিআই|এন্ডপয়েন্ট|endpoint|end ?point|rest api|json api|ডেটা সোর্স|data source|public ?apis)/i;
const DO_NOT_HIJACK = /(ফোল্ডার|ডিলিট|মুছে|মুছু|স্ক্রিনশট|স্ক্রিন|উইন্ডো|অ্যাপ |প্রোগ্রাম ইনস্টল|গান চালাও|ভিডিও চালাও|ব্রাউজার খোল|আপলোড|ডাউনলোড|ইমেইল পাঠা|ফাইল বানা|কপি|মুভ|নাম দি|ফাইলটা|ফাইল টা|রান করো|চালাও|ইনস্টল|\.(js|ts|py|json|txt|md|html|css|csv|zip|exe|bat)\b)/i;

export function isApiQuestion(text) {
  const t = bn(text).trim();
  if (!t || t.length > 300 || t.split(/\s+/).length < 2) return false;
  if (DO_NOT_HIJACK.test(t)) return false;
  if (!API_WORD.test(t)) return false;
  const { terms } = expandQuery(t);
  return terms.length > 0 || /(list|কোন|কী|কি|দাও|চাই|লাগ|recommend|best|find|খুঁজ)/i.test(t);
}

export async function localCatalogReply(text) {
  if (!isApiQuestion(text)) return '';
  const q = text.trim();
  const [, rows] = await Promise.all([ensureCatalog(), verifyLane(q, { limit: 4 })]);
  const docs = searchApis(q, { limit: 12 });
  const live = formatLaneAnswer(q, rows);
  if (live) {
    if (!docs.length) return live;
    const tail = formatCatalogAnswer(q, docs, {
      max: 3,
      offer: false,
      lead: `\n\n— ক্যাটালগে আরও ${bnDigits(docs.length)}টি মিল (${SOURCE_LABEL}); এগুলো প্রজেক্টের ওয়েবসাইট/ডক লিঙ্ক, বেশিরভাগে ফ্রি অ্যাকাউন্ট করে কী লাগে —\n\n`
    });
    return `${live}\n\n${tail}`;
  }
  const dead = rows.filter((r) => !r.probe.ok);
  const sorry = dead.length
    ? `লেনের ${bnDigits(dead.length)}টি এন্ডপয়েন্ট এখন সাড়া দিচ্ছে না (${dead.map((r) => `${r.name}: HTTP ${r.probe.status || 'ERR'}`).join(', ')})।\n\n`
    : '';
  if (!docs.length) return `${sorry}${gapText(q).trim()}`.trim();
  return (
    `${sorry}${gapText(q)}\n\n${formatCatalogAnswer(q, docs, {
      max: 6,
      lead: `কী-ছাড়া লাইভ এন্ডপয়েন্টে মিল পাইনি, তাই ${SOURCE_LABEL} ক্যাটালগ থেকে খুঁজে দিলাম — ${bnDigits(docs.length)}টি মিল। সততার সাথে বলি: নিচের লিঙ্কগুলো প্রজেক্টের ওয়েবসাইট/ডকুমেন্টেশন, কল করার আগে বেশিরভাগে ফ্রি অ্যাকাউন্ট করে API কী নিতে হয়:\n\n`
    })}`
  );
}

export function publicEntry(e) {
  if (!e) return e;
  const { host, ln, ld, lc, ...rest } = e;
  return rest;
}

export async function catalogToolOutput(args = {}) {
  if (args.refresh === true || args.refresh === 'true') {
    const r = await refreshCatalog();
    return `ক্যাটালগ রিফ্রেশ হয়েছে — ${bnDigits(r.count)}টি API, ${bnDigits(r.categories)}টি ক্যাটাগরি (${SOURCE_LABEL})।`;
  }
  const cats = args.categories === true || args.categories === 'true';
  if (cats) {
    const list = apiCategories(bn(args.query))
      .map((c) => `${c.name}${c.bn ? ` (${c.bn})` : ''} — ${c.count}টি`)
      .join('\n');
    return list || 'ক্যাটালগে কোনো ক্যাটাগরি নেই — refresh করো।';
  }
  const query = bn(args.query || args.q || '').trim();
  if (!query) throw new Error('query খালি — কী ধরনের API খুঁজছে লিখো');
  // mode=live: only probe-verified, key-free endpoints the agent can fetch_url right now.
  if (args.live === true || args.live === 'true') {
    const rows = await verifyLane(query, { limit: Math.max(1, Number(args.limit) || 4) });
    const out = formatLaneAnswer(query, rows);
    if (out) return out;
    const dead = rows.filter((r) => !r.probe.ok);
    return dead.length
      ? `লাইভ লেনে মিল ছিল কিন্তু কোনোটি সাড়া দিচ্ছে না: ${dead.map((r) => `${r.name} (HTTP ${r.probe.status || 'ERR'})`).join(', ')}.${gapText(query)}`
      : `লাইভ লেনে "${query}" এর কী-ছাড়া এন্ডপয়েন্ট নেই — catalog mode ব্যবহার করো বা ব্রাউজার লেনে যাও.${gapText(query)}`;
  }
  const results = searchApis(query, { category: bn(args.category), limit: Number(args.limit) || 10 });
  if (!results.length) {
    const near = apiCategories(query).slice(0, 8).map((c) => c.name);
    const all = apiCategories().slice(0, 20).map((c) => c.name);
    return `ক্যাটালগে "${query}" এর মিল নেই। কাছাকাছি ক্যাটাগরি: ${near.join(', ') || '(কোনোটি না)'}\nসম্ভাব্য ক্যাটাগরি: ${all.join(', ')}${gapText(query)}`;
  }
  const rows = await verifyLane(query, { limit: 3 });
  const live = formatLaneAnswer(query, rows);
  const docs = formatCatalogAnswer(query, results, { max: 10, offer: false, lead: live ? `— ক্যাটালগের আরও মিল (ওয়েবসাইট/ডক লিঙ্ক, প্রায় সবগুলোতে কী লাগে) —\n\n` : undefined });
  return live
    ? `${live}\n\n${`কল করার নিয়ম: উপরের URL-গুলোতে সরাসরি fetch_url মারো; নিচের লিঙ্ক শুধু ডকুমেন্টেশন:\n\n`}${docs}`
    : `সাবধান: নিচের URL-গুলো প্রজেক্টের ওয়েবসাইট/ডকুমেন্টেশন, callable এন্ডপয়েন্ট না — কী লাগে কিনা ডক পড়ে দেখো, নাহয় find_api টুলে live:true পাঠাও।\n\n${docs}`;
}

// ---------------------------------------------------------------------------
// Live lane
// ---------------------------------------------------------------------------
// The README catalog only carries each project's *website* — handing those out
// reads like "the API doesn't work" because they are docs pages, not endpoints,
// and most want a key. So this lane holds callable, key-free endpoints, and every
// answer probes them for real (cached in data/api-probe.json) before replying.
// Verified working 2026-10-25 from this machine; `note` carries the gotchas.

const PROBE_FILE = path.join(ROOT, 'data', 'api-probe.json');
const PROBE_TTL = 6 * 3600e3;

const L = (name, cat, use, url, note = '') => ({ name, cat, use, url, note });

// The lane uses short, human category names; these are their Bengali labels.
const LANE_CAT_BN = {
  Translate: 'অনুবাদ',
  Dictionary: 'শব্দকোষ',
  'Text To Speech': 'টেক্সট → কথা',
  Data: 'পরিসংখ্যান',
  Currency: 'মুদ্রা বিনিময়',
  Crypto: 'ক্রিপ্টো',
  IP: 'আইপি/নেটওয়ার্ক',
  Holidays: 'ছুটি/সময়',
  Science: 'বিজ্ঞান',
  Transport: 'যানবাহন',
  Images: 'ছবি',
  Gaming: 'গেম',
  Weather: 'আবহাওয়া',
  Environment: 'পরিবেশ',
  Geocoding: 'জিওকোডিং/ম্যাপ',
  Finance: 'ফাইন্যান্স',
  News: 'সংবাদ',
  Development: 'ডেভেলপমেন্ট',
  'Open Data': 'ওপেন ডেটা',
  Entertainment: 'বিনোদন',
  Music: 'সংগীত'
};

const laneCatBn = (cat) => CAT_BN[cat] || LANE_CAT_BN[cat] || '';

const LIVE_LANE = [
  // আবহাওয়া / পরিবেশ
  L('Open-Meteo', 'Weather', 'তাপমান, বৃষ্টি, আগামী কয়েক দিনের আবহাওয়া (ঢাকার কোঅর্ডিনেট বসানো আছে)', 'https://api.open-meteo.com/v1/forecast?latitude=23.7104&longitude=90.4074&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,precipitation_sum&timezone=Asia%2FDhaka&forecast_days=3', 'latitude/longitude পাল্টে যেকোনো শহর'),
  L('wttr.in', 'Weather', 'আবহাওয়া JSON বা সহজ টেক্সটে', 'https://wttr.in/Dhaka?format=j1', 'শহরের নাম URL-তে বসাও; ?format=3 দিলে এক লাইন'),
  L('MET Norway', 'Weather', 'ফোরকাস্ট, কোনো কী ছাড়াই', 'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=23.7104&lon=90.4074', 'User-Agent হেডার বাধ্যতামূলক'),
  L('Open-Meteo Air Quality', 'Environment', 'ঢাকার বায়ুদূষণ / PM2.5 / AQI', 'https://air-quality-api.open-meteo.com/v1/air-quality?latitude=23.7104&longitude=90.4074&current=pm2_5,pm10,us_aqi'),
  L('US National Weather Service', 'Weather', 'আমেরিকার আবহাওয়া', 'https://api.weather.gov/gridpoints/TOP/31,80', 'শুধু আমেরিকা'),

  // অনুবাদ / ভাষা
  L('Google Translate (gtx)', 'Translate', 'ইংরেজি → বাংলা অনুবাদ, কী ছাড়াই', 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=bn&dt=t&q=hello%20world', 'sl/tl/q প্যারামিটার বদলাও'),
  L('Free Dictionary API', 'Dictionary', 'ইংরেজি শব্দের অর্থ, উচ্চারণ, অডিও লিঙ্ক', 'https://api.dictionaryapi.dev/api/v2/entries/en/hello'),
  L('Datamuse', 'Dictionary', 'সমার্থক শব্দ / বানান পরামর্শ', 'https://api.datamuse.com/words?rel_syn=happy&max=5'),
  L('Google TTS', 'Text To Speech', 'টেক্সট → বাংলা অডিও (mp3)', 'https://translate.google.com/translate_tts?ie=UTF-8&q=hello&tl=bn&client=tw-ob', 'q টেক্সট, tl ভাষা; আউটপুট অডিও'),

  // মানচিত্র / ভূগোল
  L('OSM Nominatim', 'Geocoding', 'ঠিকানা → ল্যাটিটিউড/লংজিটিউড', 'https://nominatim.openstreetmap.org/search?q=Dhaka&format=jsonv2&limit=2', 'User-Agent + রেট ১ রিকোয়েস্ট/সে'),
  L('OSM Nominatim Reverse', 'Geocoding', 'কোঅর্ডিনেট → ঠিকানার নাম', 'https://nominatim.openstreetmap.org/reverse?lat=23.7104&lon=90.4074&format=jsonv2'),
  L('Open-Meteo Geocoding', 'Geocoding', 'শহরের নাম → কোঅর্ডিনেট (আবহাওয়ার সাথে দারুণ জোড়)', 'https://geocoding-api.open-meteo.com/v1/search?name=Dhaka&count=3&language=en'),
  L('Zippopotam.us', 'Geocoding', 'পোস্টাল কোড → এলাকা (বাংলাদেশও কাজ করে)', 'https://api.zippopotam.us/bd/1207'),
  L('World Bank Open Data', 'Data', 'দেশভিত্তিক পরিসংখ্যান — জনসংখ্যা, GDP ইত্যাদি', 'https://api.worldbank.org/v2/country/BGD/indicator/SP.POP.TOTL?format=json&mrnev=1', 'country=BGD, indicator কোড বদলাও'),

  // টাকা / ক্রিপ্টো
  L('open.er-api', 'Currency', 'লাইভ এক্সচেঞ্জ রেট — BDT সহ', 'https://open.er-api.com/v6/latest/USD', 'BDT রেট rates.BDT ফিল্ডে'),
  L('CoinGecko', 'Crypto', 'বিটকয়েন/ইথের দাম, ২৪ ঘণ্টা পরিবর্তন', 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd,bdt&include_24hr_change=true'),
  L('Binance', 'Crypto', 'লাইভ ট্রেডিং প্রাইস (কী ছাড়াই)', 'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT', 'symbol=BTCUSDT'),
  L('Coinbase', 'Crypto', 'স্পট প্রাইস', 'https://api.coinbase.com/v2/prices/BTC-USD/spot'),
  L('Yahoo Finance chart', 'Finance', 'শেয়ার/ক্রিপ্টোর দামের চার্ট ডেটা', 'https://query1.finance.yahoo.com/v8/finance/chart/BTC-USD?interval=1d&range=5d', 'symbol=path-এ; কখনও User-Agent লাগে'),

  // আইপি / নেটওয়ার্ক
  L('ipify', 'IP', 'আমার পাবলিক আইপি', 'https://api.ipify.org?format=json'),
  L('ipwho.is', 'IP', 'যেকোনো আইপির লোকেশন/ISP', 'https://ipwho.is/8.8.8.8'),
  L('Google DNS', 'IP', 'ডোমেইনের A/MX/TXT রেকর্ড', 'https://dns.google/resolve?name=example.com&type=A'),

  // নিউজ / জানালা
  L('Hacker News (Algolia)', 'News', 'টেক নিউজ সার্চ, কী ছাড়াই', 'https://hn.algolia.com/api/v1/search?query=ai&tags=story&hitsPerPage=3'),
  L('Hacker News (Firebase)', 'News', 'সেরা গল্পের আইডি লিস্ট', 'https://hacker-news.firebaseio.com/v0/topstories.json'),
  L('GitHub Search', 'Development', 'রেপো/কোড সার্চ — ৬০ রিকোয়েস্ট/ঘণ্টা কী ছাড়াই', 'https://api.github.com/search/repositories?q=public-apis&per_page=2'),
  L('StackExchange', 'Development', 'Stack Overflow-এ ভোট অনুযায়ী প্রশ্ন', 'https://api.stackexchange.com/2.3/questions?site=stackoverflow&order=desc&sort=votes&pagesize=2'),
  L('Wikipedia (বাংলা)', 'Open Data', 'যেকোনো বিষয়ের সারাংশ বাংলায়', 'https://bn.wikipedia.org/api/rest_v1/page/summary/%E0%A6%95%E0%A6%B0%E0%A6%BE%E0%A6%9A%E0%A6%BF', 'শিরোনাম URL-এনকোড করে বসাও'),
  L('DuckDuckGo Instant Answer', 'Open Data', 'দ্রুত তথ্য (সারাংশ, সংজ্ঞা)', 'https://api.duckduckgo.com/?q=dhaka&format=json&no_html=1'),
  L('Jina Reader', 'Development', 'যেকোনো URL → পরিচ্ছন্ন মার্কডাউন টেক্সট', 'https://r.jina.ai/https://example.com', 'URL টা r.jina.ai/ এর পরে বসাও'),

  // সময় / বিজ্ঞান
  L('Nager.Date', 'Holidays', 'দেশের সরকারি ছুটির তালিকা (বাংলা নামসহ)', 'https://date.nager.at/api/v3/PublicHolidays/2026/BD'),
  L('timeapi.io', 'Holidays', 'যেকোনো টাইমজোনের এখনকার সময়', 'https://www.timeapi.io/api/Time/current/zone?timeZone=Asia/Dhaka'),
  L('USGS Earthquakes', 'Science', 'সাম্প্রতিক ভূমিকম্পের তালিকা', 'https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=2026-10-01&limit=3'),
  L('NASA APOD', 'Science', 'আজকের মহাকাশের ছবি + ব্যাখ্যা', 'https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY&count=1', 'DEMO_KEY ফ্রি, ঘণ্টায় ৩০ বার'),
  L('OpenSky', 'Transport', 'আকাশে উড়ন্ত বিমানের লাইভ পজিশন (বাংলাদেশ এলাকা)', 'https://opensky-network.org/api/states/all?lamin=20&lomin=88&lamax=26&lomax=93'),

  // মজা / মিডিয়া
  L('JokeAPI', 'Entertainment', 'জোক (safe-mode)', 'https://v2.jokeapi.dev/joke/Any?safe-mode&type=twopart&amount=2'),
  L('Official Joke API', 'Entertainment', 'এলোমেলো জোক', 'https://official-joke-api.appspot.com/random_joke'),
  L('Useless Facts', 'Entertainment', 'মজার অপ্রয়োজনীয় তথ্য', 'https://uselessfacts.jsph.pl/api/v2/facts/random'),
  L('ZenQuotes', 'Entertainment', 'অনুপ্রেরণামূলক উক্তি', 'https://zenquotes.io/api/random'),
  L('AdviceSlip', 'Entertainment', 'এলোমেলো পরামর্শ', 'https://api.adviceslip.com/advice'),
  L('Cat Fact', 'Entertainment', 'বিড়াল নিয়ে তথ্য + ছবি', 'https://catfact.ninja/fact'),
  L('TheCatAPI', 'Images', 'এলোমেলো বিড়ালের ছবি URL', 'https://api.thecatapi.com/v1/images/search'),
  L('TVMaze', 'Entertainment', 'সিরিয়াল/টিভি শো খোঁজা', 'https://api.tvmaze.com/search/shows?q=breaking+bad'),
  L('Deezer', 'Music', 'গান/অ্যালবাম সার্চ + ৩০ সেকেন্ড প্রিভিউ লিঙ্ক', 'https://api.deezer.com/search?q=arrahman&limit=2'),
  L('lyrics.ovh', 'Music', 'গানের লিরিক', 'https://api.lyrics.ovh/v1/Eminem/Lose-Yourself', 'artist/title পাথ-এ'),
  L('BaconIpsum', 'Development', 'ডেমোর জন্য লোরম আইপসাম টেক্সট', 'https://baconipsum.com/api/?type=meat-and-filler&paras=1'),
  L('PokeAPI', 'Gaming', 'পোকেমন ডেটা (টেস্টের জন্য দারুণ)', 'https://pokeapi.co/api/v2/pokemon/1'),

  // ছবি / QR
  L('goQR.me', 'Open Data', 'QR কোড ছবি — URL-টাই ছবি', 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=https://qoder.com', 'data= তে তোমার টেক্সট'),
  L('Picsum Photos', 'Images', 'র‍্যান্ডম ছবি (প্লেসহোল্ডার)', 'https://picsum.photos/400/300', '/width/height পাথ-এ'),

  // ডেভ টুল
  L('JSONPlaceholder', 'Development', 'টেস্টের জন্য ফেক POST/USER API', 'https://jsonplaceholder.typicode.com/posts/1'),
  L('DummyJSON', 'Development', 'ফেক প্রোডাক্ট/কার্ট/ইউজার API', 'https://dummyjson.com/products?limit=2'),
  L('RandomUser', 'Development', 'এলোমেলো ইউজার প্রোফাইল', 'https://randomuser.me/api/?results=1'),
  L('httpbin', 'Development', 'HTTP রিকোয়েস্ট টেস্ট', 'https://httpbin.org/get'),
  L('Agify', 'Development', 'নাম থেকে বয়স/লিঙ্গ/জাতীয়তা অনুমান', 'https://api.agify.io?name=nazmul')
];

// Where no key-free API exists, say so instead of handing out a dead link.
const LANE_GAPS = [
  { re: /(football|soccer|kolkata|bsl|cricket|match|score|খেলা|ম্যাচ|স্কোর|ফুটবল|ক্রিকেট)/i, say: 'লাইভ ফুটবল/ক্রিকেট স্কোরের কী-ছাড়া ফ্রি API প্রায় নেইই — football-data.org, API-Football, CricAPI তে ফ্রি টায়ারেও রেজিস্ট্রেশন করে কী লাগে। তাই বললে তোমার লগইন করা ব্রাউজার দিয়ে লাইভ স্কোর পেরে দিতে পারি।' },
  { re: /(bus|route|sarkarider|bdtc|train|railway|intercity|বাস|রুট|ট্রেন|ইন্টারসিটি)/i, say: 'বাংলাদেশের বাস/ট্রেন রুট (Sarkarider, BTCA) এর কোনো পাবলিক API নেই — এটার ডেটা লাগলে ওয়েবসাইট/অ্যাপ থেকে ব্রাউজার দিয়ে বের করতে হবে।' },
  { re: /(bikash|bkash|nagad|payment|টাকা পাঠাও)/i, say: 'bKash/Nagad এর ডেভ টুলকিট শুধু মার্চ্যান্ট অ্যাকাউন্টে কী দেয় — সাধারণ ইউজারের জন্য ফ্রি পাবলিক API নেই।' },
  { re: /(news|সংবাদ|নিউজ)/i, say: 'বাংলা নিউজের কী-ছাড়া নির্ভরযোগ্য API নেই (GDELT এখান থেকে ধরা দিচ্ছে না) — সংবাদ লাগলে ব্রাউজার লেনই ভালো।' }
];

let probeCache = null;
let probeCacheKey = '';

function loadProbe() {
  try {
    const stat = fs.statSync(PROBE_FILE);
    if (probeCacheKey === String(stat.mtimeMs) && probeCache) return probeCache;
    probeCacheKey = String(stat.mtimeMs);
    probeCache = JSON.parse(fs.readFileSync(PROBE_FILE, 'utf8'));
    if (!probeCache || typeof probeCache !== 'object') probeCache = {};
  } catch {
    probeCache = {};
    probeCacheKey = '';
  }
  return probeCache;
}

function saveProbe(map) {
  try {
    fs.writeFileSync(PROBE_FILE, JSON.stringify(map));
    probeCache = map;
    probeCacheKey = '';
  } catch { /* read-only data dir — cache হারালেও চলবে */ }
}

function classify(contentType, head) {
  const t = (contentType || '').toLowerCase();
  if (/^[\s<]*(<!doctype|<html|<?xml)/i.test(head)) return 'html';
  if (t.includes('json')) return 'json';
  if (t.startsWith('image/')) return 'image';
  if (t.startsWith('audio/')) return 'audio';
  if (t.startsWith('video/')) return 'video';
  if (t.includes('csv') || t.includes('text') || t.includes('markdown')) return 'text';
  return 'other';
}

/// A real GET, so the answer can promise "this works right now" instead of a docs link.
export async function probeUrl(url, { timeoutMs = 8000, force = false } = {}) {
  const cache = loadProbe();
  const hit = cache[url];
  const fresh = hit && Date.now() - hit.at < (hit.ok ? PROBE_TTL : 3600e3);
  if (fresh && !force) return hit;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const started = Date.now();
  let out;
  try {
    const r = await fetch(url, {
      signal: ac.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) PC-Agent/1.0', accept: '*/*' }
    });
    const buf = new Uint8Array(await r.arrayBuffer());
    const head = new TextDecoder().decode(buf.slice(0, 400)).replace(/\s+/g, ' ').trim();
    const ct = r.headers.get('content-type') || '';
    const kind = classify(ct, head);
    const body = kind === 'html' ? '' : head.slice(0, 200);
    // 200 but the payload says "no" ({"success":false} / "Invalid API Key") — treat as dead.
    const refused = /"(success|status)"\s*:\s*(false|"failure")|api ?key required|invalid api ?key|quota|denied/i.test(body);
    out = {
      ok: r.status >= 200 && r.status < 300 && kind !== 'html' && !refused,
      status: r.status,
      kind,
      bytes: buf.length,
      ms: Date.now() - started,
      sample: kind === 'image' || kind === 'audio' || kind === 'video' ? `(${kind} ${buf.length} bytes)` : body.slice(0, 160),
      at: Date.now()
    };
  } catch (e) {
    out = { ok: false, status: 0, kind: 'err', ms: Date.now() - started, sample: String((e && e.message) || e).slice(0, 80), at: Date.now() };
  } finally {
    clearTimeout(timer);
  }
  cache[url] = out;
  saveProbe(cache);
  return out;
}

export function searchLane(query, limit = 8) {
  const { raw, terms } = expandQuery(query);
  const scored = LIVE_LANE.map((e) => {
    const cbn = laneCatBn(e.cat).toLowerCase();
    const hay = `${e.name} ${e.cat} ${cbn} ${e.use} ${e.url}`.toLowerCase();
    const ln = e.name.toLowerCase();
    let s = 0;
    for (const t of terms) {
      const re = wordStartRe(t);
      if (ln === t || ln.includes(t)) s += 5 * nameHit(ln, t, re);
      if (e.cat.toLowerCase() === t || cbn === t) s += 8;
      else if (e.cat.toLowerCase().includes(t) || cbn.includes(t)) s += 4 * hit(`${e.cat} ${cbn}`.toLowerCase(), t, re);
      s += 2.2 * hit(e.use.toLowerCase(), t, re);
      s += 1.2 * hit(hay, t, re);
    }
    if (raw && e.use.toLowerCase().includes(raw)) s += 3;
    // A country-limited endpoint is rarely what a Bangladeshi user means.
    if (/^শুধু\s/.test(e.note)) s *= 0.35;
    return { e, s };
  })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit);
  return scored.map((x) => x.e);
}

/// Lane hits, each with a fresh probe — live ones first, dead ones kept for honesty.
export async function verifyLane(query, { limit = 4, force = false } = {}) {
  const picks = searchLane(query, Math.max(1, limit));
  const rows = await Promise.all(picks.map(async (e) => ({ ...e, probe: await probeUrl(e.url, { force }) })));
  return rows.sort((a, b) => (b.probe.ok ? 1 : 0) - (a.probe.ok ? 1 : 0));
}

function laneLine(r, i) {
  const p = r.probe;
  const mark = p.ok ? `✓ ${p.status} (${(p.ms / 1000).toFixed(1)}s)` : `✗ ${p.status || 'ERR'}`;
  const note = r.note ? `\n   দ্রষ্টব্য: ${r.note}` : '';
  const sample = p.ok && p.sample ? `\n   ডেটা: ${p.sample.slice(0, 120)}${p.sample.length > 120 ? '…' : ''}` : '';
  return `${bnDigits(i + 1)}. ${r.name} — ${r.cat}${laneCatBn(r.cat) ? ` (${laneCatBn(r.cat)})` : ''}  ${mark}\n   ${r.use}\n   ${r.url}${sample}${note}`;
}

/// Topics where no key-free API exists at all — say it instead of faking a link.
function gapText(query) {
  const say = LANE_GAPS.filter((g) => g.re.test(bn(query))).map((g) => g.say);
  return say.length ? `\n\n${say.join('\n\n')}` : '';
}

export function formatLaneAnswer(query, rows) {
  const live = rows.filter((r) => r.probe.ok);
  if (!live.length) return '';
  const lines = live.slice(0, 4).map(laneLine);
  return (
    `এখনই লাইভ কল করে যাচাই করলাম — কী/লগইন ছাড়াই এই URL-গুলোতে GET মারলেই ডেটা পাবে:\n\n` +
    `${lines.join('\n\n')}${gapText(query)}\n\n` +
    `বললেই যেকোনো একটা কল করে পুরো ফলাফল দেখিয়ে দেব, বা কোডে বসিয়ে দেব।`
  );
}

