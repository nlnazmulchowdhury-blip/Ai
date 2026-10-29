import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const WORKSPACE = path.join(ROOT, 'workspace');
export const PROFILE_DIR = path.join(ROOT, 'profiles');
export const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

for (const dir of [DATA_DIR, WORKSPACE, PROFILE_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

export const EXAMPLE_TASK =
  'আজকের ঢাকার আবহাওয়া ও ডলার-টাকার রেট এক জায়গায় JSON আকারে সংগ্রহ করো, তারপর সেই ডেটা workspace/report.json ফাইলে লিখে দাও এবং সংক্ষেপে রিপোর্ট করো।';

export const DEFAULT_CONFIG = {
  settings: {
    defaultStartBot: 'router',
    autoTeam: true,
    maxTurns: 12,
    replyTimeoutSec: 240,
    maxConcurrentTasks: 1,
    openBrowserOnStart: false,
    hiddenBrowser: true,
    // কোন লেন দিয়ে চলবে: 'api' = শুধু API, 'web' = শুধু ফ্রি ওয়েব AI (ChatGPT/জেমিনি),
    // 'both' (ডিফল্ট) = আগে API, না চললে সঙ্গে সঙ্গে ওয়েব। preferApi পুরনো ফিল্ড,
    // নিচের নরমালাইজেশনে routeMode থেকেই বানানো হয়।
    routeMode: 'both',
    preferApi: true,
    // লোকাল GGUF মডেল (models/*.gguf + llama.cpp) — RAM কম লাগায় ডিফল্ট বন্ধ;
    // চালু করলে সরাসরি প্রশ্নের উত্তর দলে যাওয়ার আগেই লোকালি দেয়।
    localModel: { enabled: false, modelId: 'qwen25-0.5b' },
    geminiApiKey: '',
    geminiApiModel: 'gemini-3.8-flash',
    openaiApiKey: '',
    openaiApiModel: 'gpt-4o-mini',
    openaiBaseUrl: 'https://api.openai.com/v1',
    deepseekApiKey: '',
    deepseekApiModel: 'deepseek-chat',
    customApis: []
  },
  accounts: [
    {
      id: 'main',
      name: 'প্রধান অ্যাকাউন্ট',
      browser: 'chrome',
      profile: 'profiles/main'
    }
  ],
  groups: [
    { id: 'forge', name: 'দল নির্মাণ', boss: 'boss-forge' },
    { id: 'route', name: 'রাউটিং', boss: 'boss-route' },
    { id: 'intake', name: 'তথ্য সংগ্রহ', boss: 'boss-intake' },
    { id: 'think', name: 'বিশ্লেষণ', boss: 'boss-think' },
    { id: 'act', name: 'PC এক্সিকিউশন', boss: 'boss-act' }
  ],
  bots: [
    {
      id: 'builder',
      name: 'নির্মাতা',
      group: 'forge',
      provider: 'gemini',
      account: 'main',
      role: 'worker',
      system:
        'তুমি দল নির্মাতা। বসের পরিকল্পনা দেখে নতুন কাজের জন্য একজন কর্মী এবং তার বসের নাম ও সিস্টেম প্রম্পট লেখো। প্রম্পট হবে বাংলায়, নির্দিষ্ট এবং শুধু এই কাজের জন্য — সাধারণ বয়ান নয়। কর্মীর প্রম্পটে বলো সে এই কাজের একমাত্র কর্মী, নিজেই টুল দিয়ে কাজ শেষ করবে, অনুমোদন চাইবে না, শেষে final:true দেবে। বসের প্রম্পটে বলো সে কর্মীর টুল ফলাফল, পাথ ও সত্যতা যাচাই করবে এবং ভুল হলে সংশোধনী দেবে।'
    },
    {
      id: 'boss-forge',
      name: 'বস · দল নির্মাণ',
      group: 'forge',
      provider: 'chatgpt',
      account: 'main',
      role: 'boss',
      system:
        'তুমি দল নির্মাণ গ্রুপের বস। নতুন কাজ পড়ে ঠিক করো এর জন্য কেমন কর্মী দরকার, কী কী দক্ষতা ও টুল লাগবে, আর তার বস কী কী যাচাই করবে। সংক্ষিপ্ত ও কাজভিত্তিক পরিকল্পনা দাও — নিজে কাজ করো না।'
    },
    {
      id: 'router',
      name: 'রাউটার',
      group: 'route',
      provider: 'chatgpt',
      account: 'main',
      system:
        'তুমি টাস্ক রাউটার। ইউজারের কাজ বুঝে ঠিক করো পরের ধাপে কোন বট কাজ করবে। তথ্য আনতে হলে researcher, পাওয়া তথ্য বিশ্লেষণ বা সিদ্ধান্ত নিতে হলে analyst, PC-তে ফাইল/কমান্ড চালাতে হলে maker। নিজে লম্বা উত্তর লিখো না, শুধু সঠিক বটকে স্পষ্ট নির্দেশ দাও। সব কাজ শেষ হলে final:true দিয়ে সংক্ষিপ্ত ফলাফল দাও।'
    },
    {
      id: 'researcher',
      name: 'রিসার্চার',
      group: 'intake',
      provider: 'gemini',
      account: 'main',
      system:
        'তুমি তথ্য-সংগ্রাহক। দরকারি তথ্য আনতে search_web এবং fetch_url টুল ব্যবহার করো। আবহাওয়ার জন্য https://wttr.in/Dhaka?format=j1 আর কারেন্সি রেটের জন্য https://open.er-api.com/v6/latest/USD সরাসরি fetch_url দিয়ে আনা যায়। টুলের ফলাফল থেকে আসল মান (তাপমাত্রা, অবস্থা, রেট) তুলে result-এ JSON হিসেবে দাও, শুধু URL লিখে থামো না। মূল উৎস URL আলাদা ফিল্ডে রাখো। নিজে থেকে সিদ্ধান্ত নিও না, পরের ধাপে analyst-কে দাও।'
    },
    {
      id: 'analyst',
      name: 'অ্যানালিস্ট',
      group: 'think',
      provider: 'deepseek',
      account: 'main',
      system:
        'তুমি বিশ্লেষক। ইনপুট JSON পড়ে বুঝে ঠিক করো কোন বটের কাছে কী নির্দেশ যাবে। প্রয়োজনে result-এ নিজের বিশ্লেষণ দাও। ডেটা অসম্পূর্ণ হলে researcher-কে আবার পাঠাও।'
    },
    {
      id: 'maker',
      name: 'মেকার',
      group: 'act',
      provider: 'gemini',
      account: 'main',
      system:
        'তুমি PC এক্সিকিউটর। শুধু কথা বলে "লেখা হচ্ছে" বলো না — আসলে pc-তে টুল কল করো (write_file, make_dir, list_dir, read_file, run_command, fetch_url)। ফাইল লিখতে write_file আর ফোল্ডার বানাতে make_dir কল করা বাধ্যতামূলক; টুল কল ছাড়া কাজ হয় না। কোনো অনুমোদনের অপেক্ষা না করে সরাসরি কাজ শেষ করো। Windows পাথ forward slash দিয়ে লেখো; ডেস্কটপে বানাতে হলে "Desktop/নাম" লেখো (এতে ব্যবহারকারীর আসল ডেস্কটপ, OneDrive-সহ, ধরা হবে), JSON-এর ভেতরে ডাবল কোট এড়াও। কাজ শেষে final:true দিয়ে কী করলে তা result-এ লেখো।'
    },
    {
      id: 'boss-route',
      name: 'বস · রাউটিং',
      group: 'route',
      provider: 'chatgpt',
      account: 'main',
      role: 'boss',
      system:
        'তুমি রাউটিং গ্রুপের বস। রাউটার ঠিক বটকে ঠিক কাজে পাঠাচ্ছে কি না, ধাপের ক্রম ঠিক কি না তা যাচাই করো। ভুল বটে পাঠালে বা কাজ না এগোলে স্পষ্ট সংশোধনী নির্দেশ দাও।'
    },
    {
      id: 'boss-intake',
      name: 'বস · সংগ্রহ',
      group: 'intake',
      provider: 'gemini',
      account: 'main',
      role: 'boss',
      system:
        'তুমি তথ্য সংগ্রহ গ্রুপের বস। রিসার্চারের তথ্য আসল টুল ফলাফল থেকে এসেছে কি না, ডেটা ফাঁকা বা বানানো কি না, উৎস ঠিক আছে কি না যাচাই করো। দুর্বল হলে সঠিক নির্দেশ দাও।'
    },
    {
      id: 'boss-think',
      name: 'বস · বিশ্লেষণ',
      group: 'think',
      provider: 'chatgpt',
      account: 'main',
      role: 'boss',
      system:
        'তুমি বিশ্লেষণ গ্রুপের বস। অ্যানালিস্টের বিশ্লেষণ ইনপুট ডেটার সাথে মিলছে কি না, সিদ্ধান্ত যুক্তিসঙ্গত কি না যাচাই করো। ভুল সিদ্ধান্তে সংশোধনী দাও।'
    },
    {
      id: 'boss-act',
      name: 'বস · এক্সিকিউশন',
      group: 'act',
      provider: 'gemini',
      account: 'main',
      role: 'boss',
      system:
        'তুমি PC এক্সিকিউশন গ্রুপের বস। মেকারের টুল কল সফল হয়েছে কি না, পাথ/কমান্ড সঠিক কি না, শুধু কথা বলে কাজ এড়িয়ে যাচ্ছে কি না যাচাই করো। ব্যর্থ হলে সঠিক টুল ও পাথের নির্দেশ দাও।'
    }
  ]
};

export function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    const cfg = JSON.parse(raw);
    return normalizeConfig(cfg);
  } catch {
    saveConfig(DEFAULT_CONFIG);
    return structuredClone(DEFAULT_CONFIG);
  }
}

export function saveConfig(cfg) {
  const next = normalizeConfig(cfg);
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

export function normalizeConfig(cfg) {
  const base = structuredClone(DEFAULT_CONFIG);
  const out = {
    settings: { ...base.settings, ...(cfg?.settings || {}) },
    accounts: Array.isArray(cfg?.accounts) && cfg.accounts.length ? cfg.accounts : base.accounts,
    groups: Array.isArray(cfg?.groups) && cfg.groups.length ? cfg.groups : base.groups,
    bots: Array.isArray(cfg?.bots) && cfg.bots.length ? cfg.bots : base.bots
  };
  const accountIds = new Set(out.accounts.map((a) => a.id));
  const groupIds = new Set(out.groups.map((g) => g.id));
  out.settings.customApis = (Array.isArray(cfg?.settings?.customApis) ? cfg.settings.customApis : [])
    .slice(0, 20)
    .map((a, i) => ({
      id: String(a?.id || `api-${i + 1}`).slice(0, 40),
      name: String(a?.name || `API ${i + 1}`).slice(0, 40),
      baseUrl: String(a?.baseUrl || '').replace(/\/+$/, '').slice(0, 300),
      key: String(a?.key || '').slice(0, 300),
      model: String(a?.model || '').slice(0, 100)
    }))
    .filter((a) => a.baseUrl && a.key);
  const validProviders = new Set([
    'gemini',
    'chatgpt',
    'deepseek',
    'duckai',
    ...out.settings.customApis.map((a) => `custom-${a.id}`)
  ]);
  out.accounts = out.accounts.map((a) => ({
    id: String(a.id),
    name: a.name || String(a.id),
    browser: a.browser === 'edge' ? 'edge' : 'chrome',
    profile: a.profile || `profiles/${a.id}`
  }));
  out.bots = out.bots.map((b) => ({
    id: String(b.id),
    name: b.name || String(b.id),
    group: groupIds.has(b.group) ? b.group : out.groups[0].id,
    provider: validProviders.has(b.provider) ? b.provider : 'gemini',
    account: accountIds.has(b.account) ? b.account : out.accounts[0].id,
    role: b.role === 'boss' ? 'boss' : 'worker',
    system: String(b.system || ''),
    ...(b.ephemeral ? { ephemeral: true, taskId: String(b.taskId || '') } : {})
  }));
  out.groups = out.groups.map((g) => ({
    id: String(g.id),
    name: g.name || String(g.id),
    boss: String(g.boss || ''),
    ...(g.ephemeral ? { ephemeral: true, taskId: String(g.taskId || '') } : {}),
    // দল চেনার তথ্য — এগুলো না থাকলে প্রতিবার নতুন দল বানাতে হবে
    ...(g.purpose ? { purpose: String(g.purpose).slice(0, 240) } : {}),
    ...(g.leadId ? { leadId: String(g.leadId) } : {}),
    ...(Array.isArray(g.keywords) && g.keywords.length
      ? { keywords: g.keywords.map((w) => String(w).slice(0, 30)).filter(Boolean).slice(0, 20) }
      : {}),
    ...(Number(g.uses) > 0 ? { uses: Math.min(99999, Math.trunc(Number(g.uses))) } : {}),
    ...(Number(g.lastUsed) > 0 ? { lastUsed: Number(g.lastUsed) } : {}),
    ...(Number(g.createdAt) > 0 ? { createdAt: Number(g.createdAt) } : {})
  }));
  ensureForgeCrew(out, base);
  out.groups = out.groups.filter((g) => out.bots.some((b) => b.group === g.id));
  for (const group of out.groups) {
    const boss = out.bots.find((b) => b.id === group.boss && b.role === 'boss' && b.group === group.id);
    if (!boss) group.boss = out.bots.find((b) => b.role === 'boss' && b.group === group.id)?.id || null;
    if (!boss && !group.boss) delete group.boss;
  }
  const startBot = out.bots.find((b) => b.id === out.settings.defaultStartBot && b.role !== 'boss' && b.group !== 'forge');
  if (!startBot) {
    out.settings.defaultStartBot = out.bots.find((b) => b.role !== 'boss' && b.group !== 'forge')?.id || 'router';
  }
  out.settings.autoTeam = out.settings.autoTeam !== false;
  out.settings.maxTurns = clampInt(out.settings.maxTurns, 3, 30, 12);
  out.settings.replyTimeoutSec = clampInt(out.settings.replyTimeoutSec, 30, 900, 240);
  out.settings.maxConcurrentTasks = clampInt(out.settings.maxConcurrentTasks, 1, 3, 1);
  out.settings.hiddenBrowser = out.settings.hiddenBrowser !== false;
  // পুরনো config-এ শুধু preferApi থাকে — সেখান থেকে মোড পড়া, নাহলে 'both'।
  // (raw থেকে নেওয়া, নাহলে ডিফল্টের 'both' পুরনো preferApi:false-কে চেপে যাবে)
  const raw = cfg?.settings || {};
  out.settings.routeMode = ['api', 'web', 'both'].includes(raw.routeMode)
    ? raw.routeMode
    : raw.preferApi === false
      ? 'web'
      : 'both';
  out.settings.preferApi = out.settings.routeMode !== 'web';
  out.settings.localModel = {
    enabled: raw.localModel?.enabled === true,
    modelId: String(raw.localModel?.modelId || 'qwen25-0.5b').slice(0, 40),
  };
  return out;
}

function ensureForgeCrew(out, base) {
  if (!out.groups.some((g) => g.id === 'forge')) {
    out.groups.unshift(structuredClone(base.groups.find((g) => g.id === 'forge')));
  }
  for (const id of ['builder', 'boss-forge']) {
    if (!out.bots.some((b) => b.id === id)) {
      out.bots.push(structuredClone(base.bots.find((b) => b.id === id)));
    }
  }
  const forge = out.groups.find((g) => g.id === 'forge');
  if (forge && !forge.boss) forge.boss = 'boss-forge';
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function findBot(cfg, id) {
  return cfg.bots.find((b) => b.id === id) || null;
}

export function findAccount(cfg, id) {
  return cfg.accounts.find((a) => a.id === id) || cfg.accounts[0] || null;
}

export function resolveProfile(account) {
  const dir = path.resolve(ROOT, account.profile || `profiles/${account.id}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
