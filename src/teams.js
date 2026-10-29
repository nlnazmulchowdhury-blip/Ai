import crypto from 'node:crypto';
import { loadConfig, saveConfig, findAccount } from './config.js';
import { askProvider } from './providers.js';
import { extractJson } from './jsonparse.js';
import { TOOL_HELP } from './pctools.js';
import { tokens } from './memory.js';

const MAX_TEAMS = 12;
const MAX_WORKERS = 5;
const MIN_SHARED = 2;
const MAX_KEYS = 20;
const PROVIDERS = ['gemini', 'chatgpt'];

// একই ধরনের কাজের জন্য একটাই দল — শব্দের মিল দিয়ে দল চেনা হয়।
// তিন স্তরে মিল: (১) ক্রিয়া/বিশেষ্যের সমার্থক রূপ এক ক্যানন-শব্দে ভাঁজ করা হয়
// (খোল/খুলো/খোলো/ওপেন/যাও→open, সাউন্ড/আওয়াজ/ভলিউম→volume), (২) বানান এদিক-ওদিক হলে
// অক্ষর-জোড়ের মিল দিয়ে ধরা হয় (নোপ্যাড≈নোটপ্যাড), (৩) কাজের উদ্দেশ্য (plan.summary)-এর
// শব্দও দলের কী-তে বসে, তাই পরের বার ভিন্ন ভাষায় বললেও সেই দলই মিলবে।
const FOLD = new Map();
const VERB_CANON = new Set();
for (const [canon, forms] of Object.entries({
  open: ['ওপেন', 'খোল', 'খোলো', 'খুলো', 'খুলে', 'খুলুন', 'খোলা', 'খুলতে', 'চালু', 'জ্বালাও', 'যাও', 'যান', 'যাবো', 'যেতে', 'যেয়ে', 'যাই'],
  play: ['চালাও', 'চালালে', 'চালানো', 'বাজাও', 'বাজানো', 'প্লে', 'শোনো', 'শুনতে', 'শুনুন'],
  make: ['বানাও', 'বানাই', 'বানিয়ে', 'তৈরি', 'খাড়া'],
  write: ['লেখো', 'লিখো', 'লিখুন', 'লিখে', 'লিখতে'],
  find: ['খোঁজো', 'খুঁজো', 'খোজো', 'সার্চ', 'খুঁজে'],
  del: ['মুছো', 'মুছে', 'মুছুন', 'ডিলিট', 'ডিলেট'],
  say: ['বলো', 'বলুন', 'বলে', 'বলতে'],
  show: ['দেখাও', 'দেখান', 'দেখাই', 'দেখে', 'দেখতে'],
  level: ['বাড়াও', 'বাড়ান', 'বাড়িয়ে', 'বাড়বে', 'বেশি', 'কমাও', 'কমান', 'কমিয়ে', 'কমবে', 'up', 'down']
})) {
  VERB_CANON.add(canon);
  for (const form of forms) FOLD.set(form, canon);
}

// সমার্থ্য বিশেষ্য — একই জিনিস নানা নামে ডাকে (ভলিউম/সাউন্ড/আওয়াজ)
for (const [canon, forms] of Object.entries({
  volume: ['সাউন্ড', 'আওয়াজ', 'অডিও', 'শব্দ', 'ভলিউম', 'ভল্যুম', 'ভলুম'],
  window: ['উইন্ডো', 'জানালা'],
  browser: ['ব্রাউজার', 'ক্রোম', 'গুগলক্রোম', 'এজ', 'ফায়ারফক্স'],
  song: ['গান', 'সংগীত', 'মিউজিক', 'ট্র্যাক', 'ট্রাক'],
  news: ['খবর', 'নিউজ', 'সংবাদ'],
  image: ['ছবি', 'ইমেজ', 'ফটো', 'স্ক্রিনশট'],
  video: ['ভিডিও', 'ক্লিপ']
})) {
  for (const form of forms) FOLD.set(form, canon);
}

// ল্যাটিন ↔ বাংলা দ্বৈত বানান — বাংলায় সেভ করা দল ল্যাটিনে বললেও চিনতে হবে
// (সেভ করা keyword "ইউটিউব", পরের বার বললেন "youtube" — অক্ষর মিলে না বলে দল নতুন বানানো হচ্ছিল)
for (const [canon, forms] of Object.entries({
  youtube: ['youtube', 'yt', 'ইউটিউব', 'িউটিউব', 'য়ুটিউব', 'ইউটুউব'],
  facebook: ['facebook', 'fb', 'ফেসবুক', 'ফেসবুকে', 'ফেসবুকের'],
  instagram: ['instagram', 'ইনস্টাগ্রাম', 'ইন্সটাগ্রাম', 'ইনস্টা'],
  google: ['google', 'গুগল'],
  whatsapp: ['whatsapp', 'হোয়াটসঅ্যাপ', 'হোয়াটসএ্যাপ'],
  netflix: ['netflix', 'নেটফ্লিক্স', 'নেটফ্লিक्स'],
  notepad: ['notepad', 'নোটপ্যাড', 'নটপ্যাড', 'নোপ্যাড'],
  calculator: ['calculator', 'ক্যালকুলেটর', 'ক্যালকুলেটার', 'হিসাব'],
  song: ['music', 'song', 'গান', 'গানের'],
  image: ['image', 'photo', 'picture', 'screenshot'],
  video: ['video'],
  browser: ['browser', 'chrome', 'edge', 'firefox'],
  window: ['window']
})) {
  for (const form of forms) FOLD.set(form, canon);
}

// "দল/টিম" জাতীয় শব্দ মিল হিসেবে চলে না — প্রায় সব দলের নামেই আছে
const META_WORDS = new Set(['দল', 'দলের', 'দলে', 'টিম', 'টিমের', 'টিমে', 'গ্রুপ', 'গ্রুপের', 'গ্রুপে']);

export function normWords(text) {
  const out = [];
  for (const w of tokens(text)) if (!META_WORDS.has(w)) out.push(FOLD.get(w) || w);
  return [...new Set(out)];
}

// অক্ষর-জোড়ের মিল (Dice): একই শব্দের বানান-রূপ ধরে (নোপ্যাড/নোটপ্যাড, ফেসবুক/ফেসবুকে)
const SIM_MIN = 0.62;
const gramCache = new Map();
function grams(word) {
  if (gramCache.has(word)) return gramCache.get(word);
  const c = [...word];
  const set = new Set();
  for (let i = 0; i < c.length - 1; i += 1) set.add(c[i] + c[i + 1]);
  if (c.length === 1) set.add(c[0]);
  gramCache.set(word, set);
  return set;
}
function dice(a, b) {
  const A = grams(a);
  const B = grams(b);
  let n = 0;
  for (const g of A) if (B.has(g)) n += 1;
  return (2 * n) / (A.size + B.size);
}

// বিভেক্তি/বানান-সহ্য মিল: ছোট শব্দে কেবল হুবহু মিল, লম্বা শব্দে রূপান্তরও মিল
function wordSame(a, b) {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  if (a.startsWith(b) || b.startsWith(a)) return true;
  return dice(a, b) >= SIM_MIN;
}

function sharedWords(query, keys) {
  let shared = 0;
  let content = 0;
  for (const q of query) {
    for (const k of keys) {
      if (!wordSame(q, k)) continue;
      shared += 1;
      if (!VERB_CANON.has(q) && !VERB_CANON.has(k)) content += 1;
      break;
    }
  }
  return { shared, content };
}

export function teamSig(prompt) {
  const words = normWords(prompt).sort();
  if (!words.length) return '';
  return crypto.createHash('sha1').update(words.join(' ')).digest('hex').slice(0, 8);
}

export function matchSavedTeam(cfg, prompt) {
  const q = normWords(prompt);
  if (q.length < MIN_SHARED) return null;
  const qVerbs = q.filter((w) => VERB_CANON.has(w));
  const cands = [];
  for (const g of cfg.groups) {
    const keySource = [...(Array.isArray(g.keywords) ? g.keywords : []), g.purpose || '', g.name || ''];
    const kw = normWords(keySource.join(' '));
    if (!kw.length) continue;
    const { shared, content } = sharedWords(q, kw);
    // অন্তত একটি আসল বস্তু-শব্দ (নোটপ্যাড/ফেসবুক) আর মোট ২টি মিল না থাকলে এটা অন্য কাজ
    if (shared < MIN_SHARED || content < 1) continue;
    // ক্রিয়া ঠিক ভিন্ন (খোলা বনাম মুছে ফেলা) → বস্তু এক হলেও আলাদা কাজ, ২টি বস্তু-শব্দ লাগবে
    const gVerbs = kw.filter((w) => VERB_CANON.has(w));
    const verbClash = qVerbs.length > 0 && gVerbs.length > 0 && !qVerbs.some((v) => gVerbs.includes(v));
    if (verbClash && content < 2) continue;
    cands.push({ group: g, shared, content });
  }
  if (!cands.length) return null;
  cands.sort(
    (a, b) =>
      b.content - a.content ||
      b.shared - a.shared ||
      (b.group.lastUsed || 0) - (a.group.lastUsed || 0) ||
      (b.group.uses || 0) - (a.group.uses || 0)
  );
  return cands[0];
}

// দলের কর্মী/বস থেকে task.team-এর দৃশ্য বানায়; দল না থাকলে null
export function teamView(group, cfg, preferId = '') {
  if (!group) return null;
  const workers = cfg.bots.filter((b) => b.group === group.id && b.role !== 'boss');
  const boss = cfg.bots.find((b) => b.group === group.id && b.role === 'boss');
  if (!workers.length || !boss) return null;
  const lead = workers.find((w) => w.id === (preferId || group.leadId)) || workers[0];
  return {
    groupId: group.id,
    groupName: group.name,
    workerId: lead.id,
    workerName: lead.name,
    workers: workers.map((w, i) => ({ id: w.id, name: w.name, provider: w.provider, lead: i === 0 })),
    bossId: boss.id,
    bossName: boss.name
  };
}

export function touchGroup(groupId, prompt) {
  const cfg = loadConfig();
  const g = cfg.groups.find((x) => x.id === groupId);
  if (!g) return 0;
  g.uses = (g.uses || 0) + 1;
  g.lastUsed = Date.now();
  g.keywords = [...new Set([...(g.keywords || []), ...normWords(prompt)])].slice(0, MAX_KEYS);
  saveConfig(cfg);
  return g.uses;
}

// সেভ করা দল মিললে কাজটি সেই দলেই বসে যায় — কোনো প্রোভাইডার ডাকা হয় না
export function reuseSavedTeam(task, hooks) {
  const cfg = loadConfig();
  const found = matchSavedTeam(cfg, task.prompt);
  if (!found) return null;
  let group = found.group;
  let view = teamView(group, cfg);
  if (!view) {
    repairGroup(group.id, task.prompt);
    const fresh = loadConfig();
    group = fresh.groups.find((g) => g.id === group.id);
    view = teamView(group, fresh);
    if (!view) return null;
  }
  const uses = touchGroup(group.id, task.prompt);
  task.team = { ...view, uses };
  task.startBot = view.workerId;
  teamTurn(task, hooks, {
    stage: 'ready',
    botName: 'দল ব্যবস্থাপনা',
    say: `সেভ করা দল আবার ব্যবহার হলো: ${view.groupName} — ${view.workers.length} জন কর্মী (${view.workers.map((w) => w.name).join(', ')}), বস ${view.bossName}। এটি ${uses}তমবার, নতুন দল বানানো হয়নি।`,
    detail: `মিল: ${found.shared}টি শব্দ, ${Math.round(found.coverage * 100)}%`,
    ms: 0
  });
  hooks.broadcast('config', loadConfig());
  return task.team;
}

function clip(text, max) {
  const s = String(text || '');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function pickProvider(value, fallback) {
  const key = String(value || '').toLowerCase();
  return PROVIDERS.includes(key) ? key : fallback;
}

function teamTurn(task, hooks, turn) {
  task.turns.push({ kind: 'team', at: Date.now(), ...turn });
  hooks.broadcast('task', task);
}

async function askJson(cfg, bot, prompt) {
  const options = { account: findAccount(cfg, bot.account), timeoutSec: cfg.settings.replyTimeoutSec };
  let text = '';
  try {
    const raw = await askProvider(bot.provider, prompt, options);
    text = raw.text || '';
    const parsed = extractJson(text);
    if (parsed) return { parsed, text };
  } catch (err) {
    return { error: err, text };
  }
  try {
    const raw = await askProvider(
      bot.provider,
      `${prompt}\n\nতোমার আগের উত্তরটি বৈধ JSON ছিল না। এখন শুধু একটি বৈধ JSON অবজেক্ট দাও — কোনো ভূমিকা, ব্যাখ্যা, কোড ফেন্স বা অতিরিক্ত লেখা ছাড়া।`,
      options
    );
    return { parsed: extractJson(raw.text), text: raw.text || text };
  } catch (err) {
    return { error: err, text };
  }
}

function bossPrompt(task) {
  return `তুমি "বস · দল নির্মাণ" — নতুন কাজের জন্য দল বানানোর বস। তোমার কাজ এই কাজটি ভালোভাবে করার জন্য একজন বসের অধীনে কতজন কর্মী লাগবে এবং কার দায়িত্ব কী হবে তা ঠিক করা। নিজে কাজ করো না, কোড লিখো না।

নতুন কাজ:
${clip(task.prompt, 1500)}

উপলব্ধ AI: gemini, chatgpt (deepseek এখন বন্ধ — বেছে নিও না)।
${TOOL_HELP}

শুধু একটি JSON অবজেক্ট দাও, কোনো markdown নয়:
{"summary":"কাজটি এক বাক্যে","workers":[{"role":"১ম কর্মীর নির্দিষ্ট দায়িত্ব","skills":["দক্ষতা"],"provider":"gemini"},{"role":"২য় কর্মীর নির্দিষ্ট দায়িত্ব","skills":["দক্ষতা"],"provider":"chatgpt"}],"approach":"কর্মীরা ধাপে ধাপে কী করবে","bossChecks":["বস কী যাচাই করবে"],"bossProvider":"chatgpt"}

নিয়ম:
- কাজটি একজনই সহজে করতে পারলে workers-এ ঠিক একজন রাখো। সত্যিই আলাদা আলাদা ভাগে ভাগ করা গেলেই ২–${MAX_WORKERS} জন কর্মী রাখো (যেমন: তথ্য খোঁজা, ফাইল/PC কাজ, লেখা/বিশ্লেষণ)।
- অকারণে কর্মী বাড়িও না; প্রত্যেকের দায়িত্ব আলাদা ও স্পষ্ট হবে, একই কাজ দুজনকে দিও না।
- প্রথম কর্মী দলনেতা — পুরো কাজ শেষ করা তার দায়িত্ব; দরকার হলে সে অন্য কর্মীদের কাছে অংশ পাঠাবে।
- কাজের ধরন বুঝে provider বেছে নাও (তথ্য/ফাইল/টুলের কাজে gemini, লেখা/বিশ্লেষণে chatgpt)।
- সংক্ষিপ্ত রাখো; বড় সাধারণ পরিকল্পনা নয়, এই কাজের নির্দিষ্ট পরিকল্পনা দাও।
- JSON-এর মানের ভিতরে ডাবল-কোট (") ব্যবহার করো না; প্রয়োজনে একক কোট ব্যবহার করো।`;
}

function builderPrompt(task, plan) {
  return `তুমি "নির্মাতা" — দল নির্মাণ গ্রুপের কর্মী। বসের পরিকল্পনা দেখে নতুন দলের চূড়ান্ত নকশা (নাম + সিস্টেম প্রম্পট) বানাও। নিজে কাজটি করো না।

নতুন কাজ:
${clip(task.prompt, 1500)}

বসের পরিকল্পনা:
${JSON.stringify(plan || {}, null, 2).slice(0, 2500)}

শুধু একটি JSON অবজেক্ট দাও, কোনো markdown নয়:
{"teamName":"সংক্ষিপ্ত বাংলা দলনাম","workers":[{"name":"১ম কর্মীর নাম","system":"তার সিস্টেম প্রম্পট","provider":"gemini"},{"name":"২য় কর্মীর নাম","system":"তার সিস্টেম প্রম্পট","provider":"chatgpt"}],"boss":{"name":"বসের নাম","system":"বসের সিস্টেম প্রম্পট"}}

নিয়ম:
- বসের পরিকল্পনার workers-এ যতজন আছে ঠিক ততজন কর্মী দাও, একই ক্রমে। পরিকল্পনায় একজন থাকলে একজনই দাও।
- system হবে বাংলায় ২–৪ বাক্য, এই নির্দিষ্ট কাজের সাথে সম্পর্কিত — সাধারণ বয়ান নয়।
- প্রথম কর্মী দলনেতা: সে নিজে টুল কল করে কাজ শুরু করবে (দরকারি টুলের নামসহ), দরকার হলে next দিয়ে অন্য কর্মীকে অংশ পাঠাবে, আর পুরো কাজ শেষ হলে final:true দেবে।
- বাকি কর্মীদের system-এ লেখো: তাদের নির্দিষ্ট অংশ শেষ করে result-এ ফলাফল রেখে next দিয়ে দলনেতাকে ফেরত দেবে; পুরো কাজের final:true দেবে না।
- বসের system-এ লেখো সে কী যাচাই করবে: টুল সফল হয়েছে কি না, পাথ/কমান্ড ঠিক কি না, তথ্য বানানো কি না, কাজ অসম্পূর্ণ কি না, এবং final কেবল দলনেতা দিয়েছে কি না।
- JSON স্কিমা, উদাহরণ বা লম্বা নির্দেশনা system-এ লিখো না।
- system-এর ভিতরে ডাবল-কোট (") ব্যবহার করো না; প্রয়োজনে একক কোট ব্যবহার করো।
- teamName ৪ শব্দের মধ্যে, কর্মীর নাম ও বসের নাম ছোট রাখো।`;
}

const HELPER_SYSTEM =
  'তুমি এই দলের সহকারী কর্মী। দলনেতা বা বস যে অংশটি দিয়েছেন শুধু সেটিই টুল দিয়ে শেষ করো, অনুমোদন চাইবে না। নিজের অংশ শেষ হলে result-এ আসল ফলাফল রেখে next দিয়ে দলনেতাকে ফেরত দাও; পুরো কাজের final:true দিও না। টুলের ফলাফলে যা নেই তা বানিয়ে লিখো না।';

function fallbackTeam() {
  return {
    teamName: 'কাজের দল',
    workers: [
      {
        name: 'কর্মী · কাজ',
        system:
          'তুমি এই কাজের দলনেতা ও প্রধান কর্মী। নিজেই টুল কল করে (fetch_url, search_web, write_file, make_dir, read_file, list_dir, run_command) কাজটি শুরু থেকে শেষ করো। অনুমোদন চাইবে না। কাজ শেষ হলে final:true দিয়ে আসল ফলাফল result-এ দাও। টুলের ফলাফলে যা নেই তা বানিয়ে লিখো না।',
        provider: 'gemini'
      }
    ],
    boss: {
      name: 'বস · যাচাই',
      system:
        'তুমি এই কাজের বস। কর্মীর টুল ফলাফল, পাথ, তথ্যের সত্যতা আর কাজ সম্পূর্ণ হয়েছে কি না যাচাই করো। শুধু কথা বলে কাজ এড়ালে বা তথ্য বানালে স্পষ্ট সংশোধনী নির্দেশ দাও।'
    },
    bossProvider: 'chatgpt'
  };
}

function normalizeTeam(task, plan, spec, fallbackBossProvider) {
  const fallback = fallbackTeam();
  const boss = spec?.boss && typeof spec.boss === 'object' ? spec.boss : {};
  const specWorkers = Array.isArray(spec?.workers) ? spec.workers : [];
  const legacyWorker = spec?.worker && typeof spec.worker === 'object' ? [spec.worker] : [];
  const planWorkers = Array.isArray(plan?.workers) ? plan.workers : [];
  const source = specWorkers.length ? specWorkers : legacyWorker;
  const count = Math.min(MAX_WORKERS, Math.max(1, source.length || planWorkers.length || 1));
  const workers = [];
  for (let i = 0; i < count; i += 1) {
    const sw = source[i] && typeof source[i] === 'object' ? source[i] : {};
    const pw = planWorkers[i] && typeof planWorkers[i] === 'object' ? planWorkers[i] : {};
    const system = String(sw.system || '').trim();
    const roleHint = pw.role ? ` এই কাজে তোমার নির্দিষ্ট দায়িত্ব: ${clip(pw.role, 220)}।` : '';
    workers.push({
      name: clip(sw.name || (i === 0 ? fallback.workers[0].name : `কর্মী ${i + 1}`), 26),
      system:
        system.length >= 30
          ? clip(system, 1400)
          : i === 0
            ? `${fallback.workers[0].system}${roleHint}`
            : `${HELPER_SYSTEM}${roleHint}`,
      provider: pickProvider(sw.provider || pw.provider || plan?.workerProvider, 'gemini')
    });
  }
  return {
    teamName: clip(spec?.teamName || fallback.teamName, 46),
    workers,
    boss: {
      name: clip(boss.name || fallback.boss.name, 26),
      system: String(boss.system || '').trim().length >= 30 ? clip(boss.system, 1400) : fallback.boss.system
    },
    bossProvider: pickProvider(boss.provider || plan?.bossProvider, fallbackBossProvider)
  };
}

function registerTeam(task, team, planText = '') {
  const cfg = loadConfig();
  const sig = teamSig(task.prompt);
  const groupId = sig ? `team-${sig}` : `team-${task.id}`;
  const workerIds = team.workers.map((_, i) => `tw-${groupId.slice(5)}-${i + 1}`);
  const bossId = `tb-${groupId.slice(5)}`;
  const created = Date.now();
  const prev = cfg.groups.find((g) => g.id === groupId);

  const ephemeral = cfg.groups.filter((g) => (g.ephemeral || g.id.startsWith('team-')) && g.id !== groupId);
  const keep = new Set(
    ephemeral
      .sort((a, b) => (b.uses || 0) - (a.uses || 0) || (b.lastUsed || b.createdAt || 0) - (a.lastUsed || a.createdAt || 0))
      .slice(0, MAX_TEAMS - 1)
      .map((g) => g.id)
  );
  keep.add(groupId);
  cfg.groups = cfg.groups.filter((g) => !(g.ephemeral || g.id.startsWith('team-')) || keep.has(g.id));
  const groupIds = new Set(cfg.groups.map((g) => g.id));
  cfg.bots = cfg.bots.filter((b) => !b.ephemeral || groupIds.has(b.group));

  cfg.groups = cfg.groups.filter((g) => g.id !== groupId);
  cfg.bots = cfg.bots.filter((b) => b.group !== groupId);
  cfg.groups.push({
    id: groupId,
    name: team.teamName,
    boss: bossId,
    leadId: workerIds[0],
    ephemeral: true,
    taskId: task.id,
    purpose: clip(task.prompt, 220),
    // বসের পরিকল্পনার এক লাইনি উদ্দেশ্যও কী-তে বসে — পরের বার অন্য ভাষায় বললেও এই দলই মিলবে
    keywords: [...new Set([...normWords(task.prompt), ...normWords(planText)])].slice(0, MAX_KEYS),
    uses: (prev?.uses || 0) + 1,
    lastUsed: created,
    createdAt: prev?.createdAt || created
  });
  cfg.bots.push(
    ...team.workers.map((worker, i) => ({
      id: workerIds[i],
      name: worker.name,
      group: groupId,
      provider: worker.provider,
      account: cfg.accounts[0]?.id || 'main',
      role: 'worker',
      ephemeral: true,
      taskId: task.id,
      system: worker.system
    })),
    {
      id: bossId,
      name: team.boss.name,
      group: groupId,
      provider: team.bossProvider,
      account: cfg.accounts[0]?.id || 'main',
      role: 'boss',
      ephemeral: true,
      taskId: task.id,
      system: team.boss.system
    }
  );
  return { cfg: saveConfig(cfg), groupId, workerIds, workerId: workerIds[0], bossId };
}

// যাচাই: কোনো গ্রুপে বস বা কর্মী না থাকলে নিজেই বানায় (প্রোভাইডার ডাকা লাগে না)
export function repairGroup(groupId, reason = '') {
  const cfg = loadConfig();
  const group = cfg.groups.find((g) => g.id === groupId);
  if (!group) return null;
  const created = [];
  const now = Date.now();
  const account = cfg.accounts[0]?.id || 'main';
  const workers = cfg.bots.filter((b) => b.group === groupId && b.role !== 'boss');
  const boss = cfg.bots.find((b) => b.group === groupId && b.role === 'boss');
  if (!boss) {
    const id = `b-repair-${groupId}-${now.toString(36)}`;
    cfg.bots.push({
      id,
      name: `বস · ${clip(group.name, 20)}`,
      group: groupId,
      provider: 'chatgpt',
      account,
      role: 'boss',
      system: `তুমি "${group.name}" গ্রুপের বস। তোমার কাজ কর্মীর কাজ যাচাই করা, নিজে কাজ করা নয়। টুলের ফলাফল, পাথ/কমান্ডের সত্যতা, তথ্য বানানো হয়েছে কি না, কাজ অসম্পূর্ণ আছে কি না আর final শুধু দলনেতা দিয়েছে কি না — সব দেখো। ভুল পেলে verdict "fix" দিয়ে নির্দিষ্ট সংশোধনী নির্দেশ দাও; ঠিক থাকলে "ok" দাও।${reason ? ` এই গ্রুপের কাজের ধরন: ${clip(reason, 200)}।` : ''}`
    });
    group.boss = id;
    created.push(`বস "${clip(group.name, 20)}" বানানো হয়েছে`);
  }
  if (!workers.length) {
    const id = `w-repair-${groupId}-${now.toString(36)}`;
    cfg.bots.push({
      id,
      name: `কর্মী · ${clip(group.name, 20)}`,
      group: groupId,
      provider: 'gemini',
      account,
      role: 'worker',
      system: `তুমি "${group.name}" গ্রুপের দলনেতা কর্মী। বস বা ইউজার যে কাজ দিয়েছে নিজে টুল কল করে (fetch_url, search_web, write_file, make_dir, read_file, list_dir, run_command) শুরু থেকে শেষ করো, অনুমোদন চাইবে না। কাজ শেষ হলে final:true দিয়ে আসল ফলাফল result-এ দাও। টুলের ফলাফলে যা নেই তা বানিয়ে লিখো না।`
    });
    created.push(`কর্মী "${clip(group.name, 20)}" বানানো হয়েছে`);
  }
  if (!created.length) return null;
  saveConfig(cfg);
  return { created, bossId: group.boss || '' };
}

export async function provisionTeam(task, hooks) {
  // আগের বার একই ধরনের কাজের দল সেভ আছে কি না — থাকলে সেটাই, নতুন বানানো হবে না
  const reused = reuseSavedTeam(task, hooks);
  if (reused) return loadConfig();
  let cfg = loadConfig();
  const forgeBoss = cfg.bots.find((b) => b.group === 'forge' && b.role === 'boss');
  const builder = cfg.bots.find((b) => b.group === 'forge' && b.role !== 'boss');
  let plan = null;
  let spec = null;

  if (forgeBoss) {
    const started = Date.now();
    hooks.setStatus(forgeBoss.id, 'busy');
    hooks.broadcast('status', hooks.statuses());
    try {
      const result = await askJson(cfg, forgeBoss, bossPrompt(task));
      plan = result.parsed || null;
      const failure = result.error
        ? `বসের পরিকল্পনা হলো না: ${result.error.message || result.error}`
        : 'বসের পরিকল্পনা পড়া যায়নি — নির্মাতা নিজেই দল বানাবে।';
      teamTurn(task, hooks, {
        stage: plan ? 'plan' : 'error',
        botId: forgeBoss.id,
        botName: forgeBoss.name,
        provider: forgeBoss.provider,
        say: plan ? String(plan.summary || 'দলের পরিকল্পনা ঠিক হয়েছে।') : failure,
        detail: plan ? JSON.stringify(plan, null, 2).slice(0, 3000) : clip(result.text, 1500),
        ms: Date.now() - started
      });
    } catch (err) {
      teamTurn(task, hooks, {
        stage: 'error',
        botId: forgeBoss.id,
        botName: forgeBoss.name,
        provider: forgeBoss.provider,
        say: `বসের পরিকল্পনা হলো না: ${err.message || err}`,
        ms: Date.now() - started
      });
    } finally {
      hooks.setStatus(forgeBoss.id, 'idle');
      hooks.broadcast('status', hooks.statuses());
    }
  }

  if (builder) {
    const started = Date.now();
    hooks.setStatus(builder.id, 'busy');
    hooks.broadcast('status', hooks.statuses());
    try {
      const result = await askJson(cfg, builder, builderPrompt(task, plan));
      spec = result.parsed || null;
      if (spec) {
        const names = (Array.isArray(spec.workers) ? spec.workers : spec.worker ? [spec.worker] : [])
          .map((w) => String(w?.name || '').trim())
          .filter(Boolean);
        teamTurn(task, hooks, {
          stage: 'build',
          botId: builder.id,
          botName: builder.name,
          provider: builder.provider,
          say: `নকশা তৈরি: ${names.length || 1} জন কর্মী${names.length ? ` (${names.join(', ')})` : ''} + বস "${spec.boss?.name || 'বস'}" (${spec.teamName || 'কাজের দল'})`,
          detail: JSON.stringify(spec, null, 2).slice(0, 3000),
          ms: Date.now() - started
        });
      } else {
        const reason = result.error ? result.error.message || result.error : 'উত্তর বৈধ JSON ছিল না';
        teamTurn(task, hooks, {
          stage: 'error',
          botId: builder.id,
          botName: builder.name,
          provider: builder.provider,
          say: `কর্মী তৈরি করা যায়নি: ${reason} — ডিফল্ট দল ব্যবহার হচ্ছে।`,
          detail: clip(result.text, 2000),
          ms: Date.now() - started
        });
      }
    } catch (err) {
      teamTurn(task, hooks, {
        stage: 'error',
        botId: builder.id,
        botName: builder.name,
        provider: builder.provider,
        say: `কর্মী তৈরি করা যায়নি: ${err.message || err} — ডিফল্ট দল ব্যবহার হচ্ছে।`,
        ms: Date.now() - started
      });
    } finally {
      hooks.setStatus(builder.id, 'idle');
      hooks.broadcast('status', hooks.statuses());
    }
  }

  const team = normalizeTeam(task, plan, spec, plan ? 'chatgpt' : builder?.provider || 'gemini');
  const registered = registerTeam(task, team, `${plan?.summary || ''} ${team.workers.map((w) => w.name).join(' ')}`);
  cfg = registered.cfg;
  const group = cfg.groups.find((g) => g.id === registered.groupId);
  const workers = registered.workerIds
    .map((id) => cfg.bots.find((b) => b.id === id))
    .filter(Boolean);
  const boss = cfg.bots.find((b) => b.id === registered.bossId);

  task.team = {
    groupId: registered.groupId,
    groupName: group?.name || team.teamName,
    workerId: registered.workerId,
    workerName: workers[0]?.name || team.workers[0].name,
    workers: workers.map((w, i) => ({ id: w.id, name: w.name, provider: w.provider, lead: i === 0 })),
    bossId: registered.bossId,
    bossName: boss?.name || team.boss.name
  };
  task.startBot = registered.workerId;
  teamTurn(task, hooks, {
    stage: 'ready',
    botId: builder?.id || 'builder',
    botName: builder?.name || 'নির্মাতা',
    provider: builder?.provider,
    say: `নতুন দল তৈরি: বস ${task.team.bossName} (${task.team.bossId}) — ${workers.length} জন কর্মী: ${task.team.workers.map((w) => `${w.name} (${w.id})`).join(', ')}`,
    detail: spec ? JSON.stringify(team, null, 2) : 'বস/নির্মাতার উত্তর পাওয়া যায়নি — ডিফল্ট দল ব্যবহার হয়েছে।',
    ms: 0
  });
  hooks.broadcast('config', cfg);
  return cfg;
}
