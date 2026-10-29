import fs from 'node:fs';
import path from 'node:path';
import { WORKSPACE, loadConfig } from './config.js';
import { getPage, withAccount } from './browser.js';
import { askApiLanes, webAllowed } from './lanes.js';

export class AgentError extends Error {
  constructor(message, code = 'AGENT') {
    super(message);
    this.name = 'AgentError';
    this.code = code;
  }
}

export const PROVIDER_META = {
  gemini: {
    label: 'Gemini',
    url: 'https://gemini.google.com/app',
    color: '#7ab8ff'
  },
  chatgpt: {
    label: 'ChatGPT',
    url: 'https://chatgpt.com/',
    color: '#4ade80'
  },
  deepseek: {
    label: 'DeepSeek',
    url: 'https://chat.deepseek.com/',
    color: '#b18cff'
  },
  duckai: {
    label: 'Duck.ai',
    url: 'https://duck.ai/',
    color: '#ff8a5c'
  }
};

const COPY_BUTTONS = [
  'button[aria-label*="Copy response" i]',
  'button[aria-label*="উত্তর কপি"]',
  'button[aria-label*="Copy" i]',
  'button[aria-label*="কপি"]',
  '[data-testid="copy-turn-action-button"]'
];

const SITES = {
  gemini: {
    ...PROVIDER_META.gemini,
    composer: [
      'rich-textarea div[contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]',
      'div.ql-editor[contenteditable="true"]',
      '[contenteditable="true"]',
      'textarea'
    ],
    reply: 'model-response',
    markdown: '.markdown, message-content',
    stop: ['button[aria-label*="Stop" i]', 'button[aria-label*="থামান"]'],
    send: ['button[aria-label*="Send message" i]', 'button.send-button', 'button[aria-label*="Send" i]'],
    loginUrl: /accounts\.google\.com|servicelogin/i
  },
  chatgpt: {
    ...PROVIDER_META.chatgpt,
    composer: [
      '#prompt-textarea',
      'textarea#mobile-composer-prompt',
      'div[contenteditable="true"]#prompt-textarea',
      'div[contenteditable="true"][data-placeholder]',
      'div[contenteditable="true"]',
      '[contenteditable="true"]',
      'textarea'
    ],
    reply: '[data-message-author-role="assistant"]',
    markdown: '.markdown',
    stop: ['[data-testid="stop-button"]', 'button[aria-label*="Stop" i]'],
    send: ['[data-testid="send-button"]', 'button[aria-label*="Send" i]', 'button[aria-label*="পাঠান"]'],
    loginUrl: /auth\.openai\.com|\/auth\/login|\/log-in/i,
    useClipboard: true
  },
  deepseek: {
    ...PROVIDER_META.deepseek,
    composer: [
      'textarea#chat-input',
      'textarea[placeholder]',
      'div[contenteditable="true"][role="textbox"]',
      '[contenteditable="true"]',
      'textarea'
    ],
    reply: '.ds-markdown',
    markdown: '.ds-markdown',
    stop: ['div[role="button"][aria-label*="Stop" i]', 'button[aria-label*="Stop" i]'],
    send: ['div[role="button"][aria-label*="Send" i]', 'button[aria-label*="Send" i]'],
    loginUrl: /\/sign_in|\/sign_up|\/login/i
  },
  duckai: {
    ...PROVIDER_META.duckai,
    composer: [
      'form textarea',
      'textarea[placeholder*="Ask anything"]',
      'textarea[placeholder*="privately"]',
      'textarea',
      '[contenteditable="true"]'
    ],
    // duck.ai echoes the user's message as a message node too — the first
    // new node after sending is the user's own bubble, so skip it and wait
    // for the assistant node after it.
    echoSkips: 1,
    reply: '[class*="message"], [class*="response"], [class*="answer"]',
    markdown: '[class*="content"]',
    stop: ['button[aria-label*="Stop" i]', '[class*="stop" i]'],
    send: ['button[aria-label*="Send" i]', 'button[type="submit"]'],
    loginUrl: /\/login|\/sign_?in/i
  }
};

// লগইন-স্ট্যাটাস যাচাইয়ের জন্য সাইটের কম্পোজার সিলেক্টর আর লগইন-URL প্যাটার্ন
export function siteProbe(providerKey) {
  const site = SITES[providerKey];
  if (!site) return null;
  return { url: site.url, composer: [...site.composer], loginUrl: site.loginUrl };
}

export function webProviders() {
  return Object.keys(SITES);
}

const COOKIE_BUTTONS = [
  'button:has-text("Accept all")',
  'button:has-text("Accept All")',
  'button:has-text("I agree")',
  'button:has-text("Agree")',
  'button:has-text("Got it")',
  'button:has-text("সম্মত")'
];

// একটি অ্যাকাউন্টেই একটিমাত্র ট্যাব — সব বট সেটা শেয়ার করে, তাই প্রতি কাজে
// ট্যাব জমা হয় না (র‍্যাম কম)। কর্নারের "নতুন ট্যাব" বোতাম চেপে ফাঁকা ট্যাব নেওয়া যায়।
const providerPages = new Map();

function providerPageKey(account) {
  return account.id;
}

async function resetProviderTab(account, providerKey) {
  const key = providerPageKey(account);
  const old = providerPages.get(key);
  if (old && !old.isClosed()) await old.close().catch(() => {});
  providerPages.delete(key);
}

function timeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
  ]);
}

async function anyVisible(page, selectors) {
  for (const sel of selectors) {
    try {
      if (await page.locator(sel).first().isVisible({ timeout: 400 })) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

async function dismissCookies(page) {
  for (const sel of COOKIE_BUTTONS) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 300 })) {
        await btn.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(300);
      }
    } catch {
      /* ignore */
    }
  }
}

async function findComposer(page, site, waitMs) {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if (site.loginUrl && site.loginUrl.test(page.url())) return null;
    for (const sel of site.composer) {
      try {
        const nodes = page.locator(sel);
        const count = Math.min(await nodes.count(), 6);
        for (let i = 0; i < count; i += 1) {
          const node = nodes.nth(i);
          if (await node.isVisible({ timeout: 300 }).catch(() => false)) return node;
        }
      } catch {
        /* ignore */
      }
    }
    await page.waitForTimeout(600);
  }
  return null;
}

async function debugShot(page, tag) {
  try {
    const dir = path.join(WORKSPACE, 'shots');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${tag}-${Date.now()}.png`);
    await page.screenshot({ path: file, fullPage: false, timeout: 15_000 });
    return file;
  } catch {
    return null;
  }
}

function cleanReply(text, provider) {
  let out = (text || '').replace(/\r/g, '').trim();
  const site = PROVIDER_META[provider];
  out = out.replace(new RegExp(`^${site.label}\\s*said\\s*\\n+`, 'i'), '');
  const junk = /^(copy|copy code|copy link|share|edit|more|regenerate|good response|bad response|report|read aloud|listen|কপি|শেয়ার|সম্পাদনা|আরও|পুনরায় তৈরি)$/i;
  const lines = out.split('\n');
  while (lines.length && junk.test(lines[lines.length - 1].trim())) lines.pop();
  return lines.join('\n').trim();
}

async function lastReplyText(page, site) {
  const last = page.locator(site.reply).last();
  try {
    if (!(await last.count())) return '';
    const md = last.locator(site.markdown).last();
    if (await md.count()) {
      const t = await md.innerText().catch(() => '');
      if (t && t.trim()) return t;
    }
    return (await last.innerText().catch(() => '')).trim();
  } catch {
    return '';
  }
}

async function replyCount(page, site) {
  try {
    return await page.locator(site.reply).count();
  } catch {
    return 0;
  }
}

function loginError(providerKey) {
  const label = PROVIDER_META[providerKey]?.label || providerKey;
  const err = new AgentError(`${label}-এ লগইন করা নেই। ড্যাশবোর্ডের বাঁ দিক থেকে লগইন করুন।`, 'LOGIN');
  err.provider = providerKey;
  return err;
}

async function typePrompt(page, composer, text) {
  const tag = await composer.evaluate((n) => n.tagName);
  if (tag === 'TEXTAREA' || tag === 'INPUT') {
    await composer.click({ timeout: 5000 }).catch(() => {});
    await page.keyboard.insertText(text);
    const value = await composer.inputValue().catch(() => '');
    if (value.trim()) return true;
    await composer.fill(text, { timeout: 10_000 }).catch(() => {});
    return Boolean((await composer.inputValue().catch(() => '')).trim());
  }
  await composer.click({ timeout: 10_000 });
  await page.keyboard.insertText(text);
  return true;
}

async function sendPrompt(page, site, text, providerKey) {
  if (site.loginUrl.test(page.url())) throw loginError(providerKey);
  let composer = await findComposer(page, site, 25_000);
  let typed = composer ? await typePrompt(page, composer, text).catch(() => false) : false;
  if (!typed) {
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(2500);
    await dismissCookies(page);
    composer = await findComposer(page, site, 20_000);
    if (!composer) {
      if (site.loginUrl.test(page.url())) throw loginError(providerKey);
      throw new AgentError('চ্যাট বক্স পাওয়া যায়নি (সাইট বদলেছে বা লগইন নেই)।', 'COMPOSER');
    }
    typed = await typePrompt(page, composer, text).catch(() => false);
    if (!typed) throw new AgentError('চ্যাট বক্সে লেখা যায়নি — পেজ ঠিকভাবে লোড হয়নি।', 'COMPOSER');
  }
  await page.waitForTimeout(250);
  const before = await replyCount(page, site);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);

  const started = Date.now();
  while (Date.now() - started < 9000) {
    if ((await replyCount(page, site)) > before) return before;
    if (await anyVisible(page, site.stop)) return before;
    await page.waitForTimeout(500);
  }
  // Enter did not send (some sites keep focus quirks) - try the send button.
  for (const sel of site.send) {
    try {
      const btn = page.locator(sel).first();
      if ((await btn.count()) && (await btn.isVisible({ timeout: 400 }))) {
        await btn.click({ timeout: 3000 }).catch(() => {});
        break;
      }
    } catch {
      /* ignore */
    }
  }
  await page.waitForTimeout(1500);
  if ((await replyCount(page, site)) <= before && !(await anyVisible(page, site.stop))) {
    await page.keyboard.press('Enter').catch(() => {});
  }
  return before;
}

async function clipboardReply(page, site, providerKey, promptText, timeoutSec) {
  const deadline = Date.now() + timeoutSec * 1000;
  let last = '';
  while (Date.now() < deadline) {
    await page.waitForTimeout(1000);
    if (page.isClosed()) throw new AgentError('ব্রাউজার বন্ধ হয়ে গেছে।', 'CLOSED');
    if (site.loginUrl.test(page.url())) throw loginError(providerKey);
    const buttons = page.locator(COPY_BUTTONS.join(','));
    const count = await buttons.count().catch(() => 0);
    if (!count) continue;
    const btn = buttons.last();
    await btn.hover({ timeout: 1200 }).catch(() => {});
    await page.evaluate(() => navigator.clipboard.writeText('').catch(() => {})).catch(() => {});
    await btn.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(400);
    const clip = await page
      .evaluate(() => navigator.clipboard.readText().catch(() => ''))
      .catch(() => '');
    const text = cleanReply(clip, providerKey);
    if (!text) continue;
    if (text === String(promptText).trim()) continue;
    if (text === last) return { text, url: page.url() };
    last = text;
  }
  if (last) return { text: last, url: page.url(), partial: true };
  throw new AgentError(
    'উত্তর পাওয়া যায়নি। সাইটে লগইন আছে কিনা এবং পেজ ঠিকভাবে খুলছে কিনা দেখুন।',
    'TIMEOUT'
  );
}

// --- Native Gemini API (Interactions API) --------------------------------
// When settings.geminiApiKey is set, gemini bots try the real API first and
// fall back to the free web chat on any failure — a model ladder, so a quota
// or outage never stops a task. The key lives in data/config.json and is
// never sent anywhere except Google's endpoint.

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';

function extractApiText(data) {
  if (!data || typeof data !== 'object') return '';
  const parts = data.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    return parts.map((p) => p.text || '').join('').trim();
  }
  const response = data.response;
  if (typeof response === 'string') return response.trim();
  if (response && typeof response === 'object') {
    if (Array.isArray(response.parts)) {
      return response.parts.map((p) => (typeof p === 'string' ? p : p.text || '')).join('').trim();
    }
    if (typeof response.text === 'string') return response.text.trim();
  }
  if (typeof data.output === 'string') return data.output.trim();
  if (Array.isArray(data.output)) {
    return data.output.map((p) => (typeof p === 'string' ? p : p.text || '')).join('').trim();
  }
  return '';
}

export async function askGeminiApi(prompt, { apiKey, model = 'gemini-3.8-flash', timeoutSec = 120 } = {}) {
  if (!apiKey) throw new AgentError('Gemini API key নেই', 'NO_KEY');
  const res = await fetch(GEMINI_API_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutSec * 1000),
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: String(prompt || '').slice(0, 100_000) })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || data?.message || `HTTP ${res.status}`;
    throw new AgentError(`Gemini API: ${msg}`, 'API');
  }
  const text = extractApiText(data);
  if (!text) throw new AgentError('Gemini API উত্তর খালি', 'EMPTY');
  return { text, url: 'gemini-api', api: true };
}

// --- OpenAI-সামঞ্জস্যপূর্ণ API (OpenAI / DeepSeek / OpenRouter / Groq / Mistral / Ollama…) ---

export async function askOpenAiCompatible(
  prompt,
  { baseUrl, apiKey, model, timeoutSec = 120, maxTokens = 0, imagePath = '' } = {}
) {
  if (!apiKey || !baseUrl) throw new AgentError('API key/baseUrl নেই', 'NO_KEY');
  const url = `${String(baseUrl).replace(/\/+$/, '')}/chat/completions`;
  const text = String(prompt || '').slice(0, 100_000);
  // ছবি-সহ লেন (vision model) — data URL পাঠালে স্ক্রিনশট সরাসরি দেখতে পারে
  const parts = imagePath
    ? [
        { role: 'user', content: [{ type: 'text', text }] },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${fs.readFileSync(imagePath).toString('base64')}` }
            }
          ]
        }
      ]
    : [{ role: 'user', content: text }];
  const body = {
    model: String(model || 'gpt-4o-mini'),
    messages: parts,
    temperature: 0.7,
    ...(Number(maxTokens) > 0 ? { max_tokens: Number(maxTokens) } : {})
  };
  if (imagePath) body.max_tokens = Math.max(Number(maxTokens) || 0, 700);
  const res = await fetch(url, {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutSec * 1000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || data?.message || `HTTP ${res.status}`;
    throw new AgentError(`API: ${msg}`, 'API');
  }
  const out = String(data?.choices?.[0]?.message?.content || '').trim();
  if (!out) throw new AgentError('API উত্তর খালি', 'EMPTY');
  return { text: out, url: 'api', api: true };
}

// --- কী সত্যিই কাজ করছে কিনা — ছোট্ট একটা অনুরোধ পাঠিয়ে দেখা ---

export async function probeProvider({ kind = 'openai', apiKey = '', baseUrl = '', model = '' }, timeoutSec = 25) {
  const started = Date.now();
  if (!apiKey.trim()) return { ok: false, ms: 0, code: 'NO_KEY', error: 'কী খালি — আগে কী লিখো।' };
  try {
    const prompt = 'সংযোগ পরীক্ষা: শুধু এই দুই অক্ষর লিখো — ঠিক';
    const r = kind === 'gemini'
      ? await askGeminiApi(prompt, { apiKey: apiKey.trim(), model: model.trim() || 'gemini-3.8-flash', timeoutSec })
      : await askOpenAiCompatible(prompt, { apiKey: apiKey.trim(), baseUrl: baseUrl.trim(), model: model.trim(), timeoutSec });
    return { ok: true, ms: Date.now() - started, reply: String(r.text || '').slice(0, 60) };
  } catch (err) {
    return { ok: false, ms: Date.now() - started, code: err?.code || 'ERR', error: String(err?.message || err).slice(0, 220) };
  }
}

export async function askProvider(providerKey, prompt, { account, timeoutSec = 240 } = {}) {  const text = String(prompt || '').slice(0, 24_000);

  // মোড 'both' হলে API আগে, সব লেন ব্যর্থ/কুলিং-এ তখনই নিচের ফ্রি ওয়েব লেন।
  // 'api' মোডে ওয়েব ট্যাব খোলেই না — API না চললে সৎভাবে থামে ('web' মোডে askApiLanes ফাঁকা তালিকা দেয়)।
  const viaApi = await askApiLanes(providerKey, text, { timeoutSec: Math.min(timeoutSec, 120) });
  if (viaApi) return { text: viaApi.text, url: viaApi.url, api: true, lane: viaApi.lane };
  if (!webAllowed())
    throw new AgentError('শুধু API মোড চালু — কোনো API লেন উত্তর দেয়নি, তাই ChatGPT/জেমিনি ওয়েব খোলা হয়নি।', 'LANE');

  // কোনো API নেই/বন্ধ → ফ্রি ওয়েব AI; কাস্টম API-র বট হলে প্রথম চালানো ওয়েব সাইটে নামো
  const webKey = SITES[providerKey] ? providerKey : ['gemini', 'chatgpt', 'deepseek', 'duckai'].find((k) => SITES[k]) || '';
  const site = SITES[webKey];
  if (!site)
    throw new AgentError('কোনো API কাজ করছে না আর ব্রাউজ করার মতো লগইন-করা ওয়েব AI-ও নেই।', 'PROVIDER');
  if (webKey !== providerKey)
    console.log(`[lane] ${providerKey} → ওয়েব ফলব্যাক ${webKey} (API বিকল/নেই)`);

  return withAccount(account.id, async () => {
    const key = providerPageKey(account);
    const origin = new URL(site.url).origin;
    let attempts = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      attempts += 1;
      let page = providerPages.get(key);
      if (!page || page.isClosed()) page = await getPage(account);

      const onSite = page.url().startsWith(origin);
      if (!onSite) {
        await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
        await page.waitForTimeout(900);
        await dismissCookies(page);
      } else {
        await dismissCookies(page);
      }

      try {
        const before = await sendPrompt(page, site, text, webKey);
        const result = site.useClipboard
          ? await clipboardReply(page, site, webKey, text, timeoutSec)
          : await waitForReply(page, site, webKey, before, timeoutSec);
        providerPages.set(key, page);
        return result;
      } catch (err) {
        const retriable =
          err instanceof AgentError && ['COMPOSER', 'TIMEOUT', 'CLOSED'].includes(err.code);
        if (!retriable || attempts >= 2) throw err;
        // Site warned/broke the tab — close it and retry once in a NEW tab.
        console.log(`[web] ${webKey}: ট্যাব রিসেট — নতুন ট্যাবে একবার চেষ্টা (${attempts})`);
        await resetProviderTab(account, webKey);
      }
    }
  });
}

async function waitForReply(page, site, providerKey, before, timeoutSec) {
  const deadline = Date.now() + timeoutSec * 1000;
  let last = '';
  let stableSince = 0;
  let sawBusy = false;

  while (Date.now() < deadline) {
    await page.waitForTimeout(700);
    if (page.isClosed()) throw new AgentError('ব্রাউজার বন্ধ হয়ে গেছে।', 'CLOSED');
    if (site.loginUrl.test(page.url())) throw loginError(providerKey);
    const count = await replyCount(page, site);
    const busy = await anyVisible(page, site.stop);
    if (busy) sawBusy = true;
    const threshold = before + (site.echoSkips || 0);
    if (count > threshold) {
      const current = cleanReply(await lastReplyText(page, site), providerKey);
      if (current && current !== last) {
        last = current;
        stableSince = Date.now();
      }
      if (current && !busy && Date.now() - stableSince > 2600) {
        return { text: current, url: page.url() };
      }
    } else if (sawBusy && !busy && Date.now() - stableSince > 4000) {
      const current = cleanReply(await lastReplyText(page, site), providerKey);
      if (current) return { text: current, url: page.url() };
    }
  }

  const shot = await debugShot(page, `timeout-${providerKey}`);
  const partial = last || cleanReply(await lastReplyText(page, site), providerKey);
  if (partial) return { text: partial, url: page.url(), partial: true };
  throw new AgentError(
    `উত্তর সময়মতো আসেনি (${providerKey})।${shot ? ` স্ক্রিনশট: ${shot}` : ''}`,
    'TIMEOUT'
  );
}

async function waitForUpload(page, baseName, timeoutMs, baseline = 0) {
  const stem = baseName.replace(/\.[^.]+$/, '');
  const deadline = Date.now() + Math.min(timeoutMs, 60_000);
  // Gemini ছবি আপলোডে ফাইলের নাম দেখায় না — কম্পোজারের প্রিভিউ/থাম্বনেইলই প্রমাণ
  const previewCount = () =>
    page
      .locator('img[src^="blob:"], img[src^="data:"], img[alt*="upload" i], img[alt*="preview" i], [data-test-id*="attachment" i], [data-test-id*="preview" i]')
      .count()
      .catch(() => 0);
  let calmSince = 0;
  while (Date.now() < deadline) {
    if (page.isClosed()) throw new AgentError('ব্রাউজার বন্ধ হয়ে গেছে।', 'CLOSED');
    const body = await page.locator('body').innerText().catch(() => '');
    if (/upload failed|couldn't upload|could not upload|not supported file|unsupported file|আপলোড ব্যর্থ|আপলোড করা যায়নি/i.test(body)) {
      throw new AgentError(`Gemini ফাইলটি নিতে পারেনি (${baseName}) — ফরম্যাট বা সাইজ সমস্যা হতে পারে।`, 'UPLOAD');
    }
    const shots = await previewCount();
    if (body.includes(stem) || shots > baseline) {
      const busy = /uploading|processing|আপলোড হচ্ছে|প্রসেস হচ্ছে/i.test(body);
      if (busy) calmSince = 0;
      else if (!calmSince) calmSince = Date.now();
      else if (Date.now() - calmSince > 1200) return;
    }
    await page.waitForTimeout(500);
  }
  if ((await previewCount()) > baseline) return;
  throw new AgentError(`ফাইল আপলোড ধরা পড়েনি (${baseName}) — Gemini সাইটে সমস্যা।`, 'UPLOAD');
}

// Uploads a file into the logged-in Gemini web chat (free, no API key) and returns
// its text answer. Used to turn images / video / audio / scanned docs into text.
export async function askGeminiWithFile(prompt, filePath, { account, timeoutSec = 300, uploadWaitMs } = {}) {
  const site = SITES.gemini;
  const text = String(prompt || '').slice(0, 12_000);
  return withAccount(account.id, async () => {
    const key = providerPageKey(account);
    let page = providerPages.get(key);
    if (!page || page.isClosed()) page = await getPage(account);
    if (!page.url().startsWith(new URL(site.url).origin)) {
      await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
      await page.waitForTimeout(1200);
    }
    await dismissCookies(page);
    if (site.loginUrl.test(page.url())) throw loginError('gemini');

    const closeSidebar = page.locator('button[aria-label="Close sidebar"]').first();
    if (await closeSidebar.isVisible({ timeout: 600 }).catch(() => false)) {
      await closeSidebar.click().catch(() => {});
      await page.waitForTimeout(350);
    }

    // Gemini-র কম্পোজারে আপলোড বোতামটি কখনো সরাসরি, কখনো "+" মেনুর ভেতরে, কখনো
    // লেবেল বদলে যায় — তাই একাধিক ট্রিগার, না পেলে নতুন চ্যাটে রিলোড দিয়ে একবার চেষ্টা।
    const UPLOAD_TRIGGERS = [
      'button[aria-label*="Upload" i]',
      'button[aria-label*="আপলোড"]',
      'button[aria-label*="Add files" i]',
      'button[aria-label*="Add image" i]',
      'button[aria-label*="Attach" i]',
      'button[aria-label*="ফাইল"]',
      '[data-test-id*="upload" i]',
      'button[aria-label*="more options" i]'
    ];
    async function findUploadInput(p) {
      for (const sel of UPLOAD_TRIGGERS) {
        const btn = p.locator(sel).first();
        if (!(await btn.count().catch(() => 0))) continue;
        await btn.click({ timeout: 4000 }).catch(() => {});
        const input = p.locator('input[type="file"]').first();
        if (await input.waitFor({ state: 'attached', timeout: 5000 }).then(() => true).catch(() => false)) return input;
      }
      return null;
    }
    let input = await findUploadInput(page);
    if (!input) {
      await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
      await page.waitForTimeout(2500);
      await dismissCookies(page);
      input = await findUploadInput(page);
    }
    if (!input) {
      throw new AgentError(
        'Gemini-তে ফাইল আপলোড বোতাম পাওয়া যায়নি (নতুন চ্যাটে রিলোড করেও) — ট্যাবটিতে লগইন/ক্যাপচা আটকে ' +
          'থাকতে পারে; তাই এই ধাপে ছবি দেখানো যাবে না, স্ক্রিনের বদলে window_list/ফাইল পাঠে কাজ সারো।',
        'UPLOAD'
      );
    }
    const previewBefore = await page
      .locator('img[src^="blob:"], img[src^="data:"], [data-test-id*="attachment" i], [data-test-id*="preview" i]')
      .count()
      .catch(() => 0);
    await input.setInputFiles(filePath, { timeout: 60_000 });
    await waitForUpload(page, path.basename(filePath), uploadWaitMs || Math.min(timeoutSec * 1000, 60_000), previewBefore);

    const composer = await findComposer(page, site, 25_000);
    if (!composer) throw new AgentError('ফাইল আপলোডের পর চ্যাট বক্স পাওয়া যায়নি।', 'COMPOSER');
    const typed = await typePrompt(page, composer, text).catch(() => false);
    if (!typed) throw new AgentError('Gemini চ্যাট বক্সে নির্দেশ লেখা যায়নি।', 'COMPOSER');
    await page.waitForTimeout(300);

    const before = await replyCount(page, site);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1200);
    if ((await replyCount(page, site)) <= before && !(await anyVisible(page, site.stop))) {
      for (const sel of site.send) {
        const btn = page.locator(sel).first();
        if ((await btn.count()) && (await btn.isVisible({ timeout: 400 }).catch(() => false))) {
          await btn.click({ timeout: 3000 }).catch(() => {});
          break;
        }
      }
      await page.waitForTimeout(1200);
      if ((await replyCount(page, site)) <= before && !(await anyVisible(page, site.stop))) {
        await page.keyboard.press('Enter').catch(() => {});
      }
    }
    const result = await waitForReply(page, site, 'gemini', before, timeoutSec);
    providerPages.set(key, page);
    return result;
  });
}
