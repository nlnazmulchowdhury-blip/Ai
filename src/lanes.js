// লেন রাউটার — মালিকের নিয়ম: API চললে টেক্সটের কাজ শুধু API-তেই হবে, জেমিনি/ChatGPT-এর
// ওয়েব ট্যাব খোলে না। API না থাকলে বা বিকল হলে তখনই ফ্রি ওয়েব লেন কাজ করে।
// একই স্বাস্থ্য-টেবিল চেট ফাস্ট লেন (server.js) আর কর্মী-বট (providers.js) দুজনেই ব্যাবহার করে,
// তাই ব্যর্থ কী বারবার ট্রাই করে সময় নষ্ট হয় না।
import { loadConfig } from './config.js';

export class LaneError extends Error {}

// laneId → { fails, ok, cooldownUntil, lastError, lastMs, code }
const health = new Map();
const h = (id) => {
  if (!health.has(id)) health.set(id, { fails: 0, ok: 0, cooldownUntil: 0, lastError: '', lastMs: 0, code: '' });
  return health.get(id);
};

const readyNow = (id) => Date.now() >= (h(id).cooldownUntil || 0);
const cool = (id, ms, err = '') => {
  const e = h(id);
  e.fails += 1;
  e.cooldownUntil = Date.now() + ms;
  e.lastError = String(err.message || err).slice(0, 160);
  e.code = String(err.code || '').slice(0, 20);
};
const warm = (id, ms) => {
  const e = h(id);
  e.ok += 1;
  e.fails = 0;
  e.cooldownUntil = 0;
  e.lastError = '';
  e.code = '';
  e.lastMs = ms;
};

// ব্যানড/ভুল কী দীর্ঘcooldown, রेट-লিমিট/নেট মাঝারি — ১০ মিনিট ধরে একই কীতে ৩০ সেকেন্ড নষ্ট হতো
const cooldownFor = (err) => {
  const code = String(err?.code || '');
  const msg = String(err?.message || err || '').toLowerCase();
  if (/401|403|denied|invalid token|banned|quota|no_key|unsupported/i.test(code + ' ' + msg)) return 600_000;
  if (/429|rate|limit|timeout|econn|etimedout|socket|fetch failed|network/i.test(code + ' ' + msg)) return 120_000;
  return 90_000;
};

// settings থেকে API লেনের তালিকা (ক্রম = অগ্রাধিকার)
// মোড 'web' হলে কোনো API লেন নেই → সব কাজ ফ্রি ওয়েব AI-তে যায় (API-র খরচ বাঁচে)
export function routeMode(settings = loadConfig()?.settings || {}) {
  const m = settings.routeMode;
  if (m === 'api' || m === 'web' || m === 'both') return m;
  return settings.preferApi === false ? 'web' : 'both';
}

// 'api' মোডে কখনও ব্রাউজার ট্যাব খোলে না — API না চললে সৎভাবে থামে
export const webAllowed = (settings = loadConfig()?.settings || {}) => routeMode(settings) !== 'api';

export function apiLanes(settings = loadConfig()?.settings || {}) {
  if (routeMode(settings) === 'web') return [];
  const lanes = [];
  if (settings.geminiApiKey)
    lanes.push({
      id: 'gemini-api',
      kind: 'gemini',
      owner: 'gemini',
      apiKey: settings.geminiApiKey,
      model: settings.geminiApiModel || 'gemini-3.8-flash',
      label: 'Gemini API'
    });
  if (settings.openaiApiKey)
    lanes.push({
      id: 'openai-api',
      kind: 'openai',
      owner: 'chatgpt',
      baseUrl: settings.openaiBaseUrl || 'https://api.openai.com/v1',
      apiKey: settings.openaiApiKey,
      model: settings.openaiApiModel || 'gpt-4o-mini',
      label: 'OpenAI API'
    });
  if (settings.deepseekApiKey)
    lanes.push({
      id: 'deepseek-api',
      kind: 'openai',
      owner: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      apiKey: settings.deepseekApiKey,
      model: settings.deepseekApiModel || 'deepseek-chat',
      label: 'DeepSeek API'
    });
  for (const a of settings.customApis || [])
    if (a?.key && a?.baseUrl)
      lanes.push({
        id: `custom-${a.id}`,
        kind: 'openai',
        owner: `custom-${a.id}`,
        baseUrl: a.baseUrl,
        apiKey: a.key,
        model: a.model,
        label: a.name || a.id
      });
  return lanes;
}

// providerKey-এর নিজের লেন আগে, বাকিগুলো পরে — নিজের মডেল চললে সেটাই রাখা ভালো
function ordered(lanes, providerKey) {
  const own = lanes.filter((l) => l.owner === providerKey);
  const rest = lanes.filter((l) => l.owner !== providerKey);
  return [...own, ...rest];
}

async function callLane(lane, text, { timeoutSec = 60, maxTokens = 0 } = {}) {
  const { askGeminiApi, askOpenAiCompatible } = await import('./providers.js');
  const started = Date.now();
  const res =
    lane.kind === 'gemini'
      ? await askGeminiApi(text, { apiKey: lane.apiKey, model: lane.model, timeoutSec })
      : await askOpenAiCompatible(text, {
          baseUrl: lane.baseUrl,
          apiKey: lane.apiKey,
          model: lane.model,
          timeoutSec,
          maxTokens
        });
  return { ...res, ms: Date.now() - started, lane: lane.id, label: lane.label };
}

// API লেন দিয়ে উত্তর চেষ্টা। { answer } না পেলে null → কলার ওয়েব লেনে নামবে।
export async function askApiLanes(providerKey, text, { timeoutSec = 60, maxTokens = 0, usable } = {}) {
  const lanes = ordered(apiLanes(), providerKey);
  if (!lanes.length) return null;
  const live = lanes.filter((l) => readyNow(l.id));
  if (!live.length) return null; // সব লেন cooling — এবার ওয়েব, API-তে সময় নষ্ট নেই
  for (const lane of live) {
    try {
      const res = await callLane(lane, text, { timeoutSec, maxTokens });
      const body = String(res.text || '').trim();
      if (!body) throw new LaneError('খালি উত্তর');
      if (usable && !usable(body)) {
        cool(lane.id, 600_000, { code: 'DRIFT', message: 'বাংলার বাইরে উত্তর' });
        continue;
      }
      warm(lane.id, res.ms);
      return res;
    } catch (err) {
      cool(lane.id, cooldownFor(err), err);
      console.log(`[lane] ${lane.label}: ${err.code || ''} ${String(err.message || err).slice(0, 120)}`);
    }
  }
  return null;
}

// ছবি দেখার লেন: API-তে vision মডেল থাকলে স্ক্রিনশট সেখানেই দেখা হয় — জেমিনি ওয়েব ট্যাব
// খোলার দরকার পড়ে না। 'api' মোডে ওয়েব ট্যাব একদম খোলে না, 'web' মোডে কোনো API ব্যবহার হয় না।
const VISION_RE = /(vision|\bvl\b|multimodal|4o|omni|gemini-[0-9.]*flash|gemma)/i;
const visionLanes = () => apiLanes().filter((l) => l.kind === 'openai' && VISION_RE.test(`${l.model} ${l.label}`));

export async function askVisionLane(prompt, imagePath, { timeoutSec = 90 } = {}) {
  const lanes = visionLanes().filter((l) => readyNow(l.id));
  if (!lanes.length) return null;
  for (const lane of lanes) {
    try {
      const { askOpenAiCompatible } = await import('./providers.js');
      const started = Date.now();
      const res = await askOpenAiCompatible(prompt, {
        baseUrl: lane.baseUrl,
        apiKey: lane.apiKey,
        model: lane.model,
        timeoutSec,
        imagePath
      });
      if (!String(res.text || '').trim()) throw new LaneError('খালি উত্তর');
      warm(lane.id, Date.now() - started);
      return { ...res, ms: Date.now() - started, lane: lane.id, label: lane.label };
    } catch (err) {
      cool(lane.id, cooldownFor(err), err);
      console.log(`[eye-lane] ${lane.label}: ${err.code || ''} ${String(err.message || err).slice(0, 110)}`);
    }
  }
  return null;
}

// একই লেন-নিয়ম ছবি দেখার জন্য: API-র vision লেন আগে, না থাকলে জেমিনি ওয়েব ট্যাব
// apiSec আলাদা কারণ API ৩০ সেকেন্ডে উত্তর দেয়, ওয়েব ট্যাব আপলোড ঘেঁটে ২-৪ মিনিট নেয়
export async function lookAtImage(prompt, imagePath, { account, timeoutSec = 120, apiTimeoutSec = 90, uploadWaitMs = 20_000 } = {}) {
  const mode = routeMode();
  if (mode !== 'web') {
    const viaApi = await askVisionLane(prompt, imagePath, { timeoutSec: Math.min(apiTimeoutSec, timeoutSec) });
    if (viaApi) return viaApi;
  }
  if (mode === 'api')
    throw new LaneError('শুধু API মোড — কোনো API লেন ছবি দেখতে পারেনি, জেমিনি ওয়েব ট্যাব খোলা হয়নি।');
  const { askGeminiWithFile } = await import('./providers.js');
  const web = () => askGeminiWithFile(prompt, imagePath, { account, timeoutSec, uploadWaitMs });
  try {
    const r = await web();
    return { ...r, lane: '', web: true };
  } catch (firstErr) {
    // আপলোড ধরা না খেলেই আবার চেষ্টা — বাকি ত্রুটি ঘুরিয়ে দিও না, দেরি বাড়ে
    const msg = String(firstErr.message || firstErr);
    if (!/আপলোড|UPLOAD|সময়মতো/i.test(msg)) throw firstErr;
    await new Promise((res) => setTimeout(res, 1500));
    const r = await web();
    return { ...r, lane: '', web: true };
  }
}

// বোর্ড/ডিবাগের জন্য: কোন লেন চলছে, কোনটা কেন বন্ধ
export function laneStatus() {
  return apiLanes().map((l) => {
    const e = h(l.id);
    return {
      id: l.id,
      label: l.label,
      model: l.model,
      owner: l.owner,
      ok: e.ok,
      fails: e.fails,
      lastMs: e.lastMs,
      lastError: e.lastError,
      code: e.code,
      ready: readyNow(l.id),
      coolingMs: Math.max(0, e.cooldownUntil - Date.now())
    };
  });
}

// কোনো API লেন এ মুহূর্তে চলার যোগ্য কি না — না হলে ওয়েব লেন খুলবে
export function apiAvailable() {
  return apiLanes().some((l) => readyNow(l.id));
}

export function resetLane(id) {
  if (id) health.delete(id);
  else health.clear();
}
