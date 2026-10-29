import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { resolveProfile, loadConfig, PROFILE_DIR, DATA_DIR } from './config.js';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
];
const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];

const ARGS = [
  '--start-maximized',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-infobars',
  '--disable-blink-features=AutomationControlled',
  '--disable-background-networking',
  '--disable-background-timer-throttling',
  '--disable-component-update',
  '--disable-default-apps',
  '--disable-sync',
  '--disable-extensions',
  '--disable-dev-shm-usage',
  '--process-per-site',
  '--disable-features=Translate,BackForwardCache,AcceptCHFrame,MediaRouter,OptimizationHints',
  '--metrics-recording-only',
  '--mute-audio'
];

const browsers = new Map();
const queues = new Map();
const HEADLESS_VIEWPORT = { width: 1366, height: 900 };
const LOGIN_RE = /accounts\.google\.com|servicelogin|auth\.openai\.com|\/auth\/login|\/log-in|sign_?in/i;

function firstExisting(list) {
  return list.find((p) => p && fs.existsSync(p)) || null;
}

function executableFor(kind) {
  if (kind === 'edge') return firstExisting(EDGE_CANDIDATES) || firstExisting(CHROME_CANDIDATES);
  return firstExisting(CHROME_CANDIDATES) || firstExisting(EDGE_CANDIDATES);
}

function chromeMajor(exe) {
  try {
    const dirs = fs
      .readdirSync(path.dirname(exe))
      .filter((d) => /^\d+\./.test(d))
      .map((d) => Number.parseInt(d, 10))
      .filter((n) => Number.isFinite(n));
    return Math.max(...dirs, 141);
  } catch {
    return 141;
  }
}

function wantsHidden() {
  try {
    return loadConfig().settings.hiddenBrowser !== false;
  } catch {
    return true;
  }
}

export function browserStatus() {
  const out = {};
  for (const [id, entry] of browsers) {
    const connected = entry.ctx.browser()?.isConnected?.() ?? false;
    out[id] = { open: connected, hidden: entry.hidden === true, url: entry.page?.url?.() || '' };
  }
  return out;
}

const SHOT_ORIGIN = /chatgpt\.com|gemini\.google\.com|chat\.deepseek\.com|duck\.ai|youtube\.com/i;

export async function captureBrowserShot() {
  const live = [];
  for (const entry of browsers.values()) {
    if (!entry?.page || entry.page.isClosed()) continue;
    if (!(entry.ctx.browser()?.isConnected?.() ?? false)) continue;
    live.push(entry);
  }
  let page = null;
  let hidden = true;
  if (live.length) {
    const entry = live.find((e) => SHOT_ORIGIN.test(e.page.url())) || live[live.length - 1];
    page = entry.page;
    hidden = entry.hidden === true;
  } else if (mediaPage && !mediaPage.isClosed() && mediaCtx) {
    page = mediaPage;
    hidden = false;
  }
  if (!page) return null;
  const buffer = await page.screenshot({ type: 'jpeg', quality: 52, timeout: 6000 });
  return { buffer, url: page.url(), hidden };
}

async function launch(account, hidden) {
  const exe = executableFor(account.browser);
  if (!exe) throw new Error('Chrome/Edge পাওয়া যায়নি। CHROME_PATH env দিয়ে browser path দিন।');
  const profile = resolveProfile(account);
  const ua = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor(exe)}.0.0.0 Safari/537.36`;
  const ctx = await chromium.launchPersistentContext(profile, {
    executablePath: exe,
    headless: hidden,
    viewport: hidden ? HEADLESS_VIEWPORT : null,
    ...(hidden ? { userAgent: ua } : {}),
    ignoreDefaultArgs: ['--enable-automation'],
    args: ARGS,
    acceptDownloads: false,
    locale: 'bn-BD',
    timezoneId: 'Asia/Dhaka'
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['bn-BD', 'bn', 'en-US', 'en'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  });
  for (const origin of ['https://chatgpt.com', 'https://gemini.google.com', 'https://chat.deepseek.com', 'https://duck.ai']) {
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin }).catch(() => {});
  }
  ctx.on('close', () => {
    const entry = browsers.get(account.id);
    if (entry && entry.ctx === ctx) browsers.delete(account.id);
  });
  const entry = { ctx, page: null, account, hidden };
  browsers.set(account.id, entry);
  return entry;
}

export async function getPage(account, opts = {}) {
  const hidden = opts.headed === true ? false : opts.headed === false ? true : wantsHidden();
  let entry = browsers.get(account.id);
  if (entry) {
    const connected = entry.ctx.browser()?.isConnected?.() ?? false;
    if (!connected) {
      browsers.delete(account.id);
      entry = null;
    } else if (entry.hidden !== hidden) {
      const loggingIn = entry.hidden === false && LOGIN_RE.test(entry.page?.url?.() || '');
      if (!loggingIn) {
        browsers.delete(account.id);
        await entry.ctx.close().catch(() => {});
        entry = null;
      }
    }
  }
  if (!entry) entry = await launch(account, hidden);
  if (!entry.page || entry.page.isClosed()) {
    entry.page = entry.ctx.pages().find((p) => !p.isClosed()) || (await entry.ctx.newPage());
    entry.page.setDefaultTimeout(45_000);
    entry.page.setDefaultNavigationTimeout(60_000);
  }
  return entry.page;
}

export function withAccount(accountId, fn) {
  const prev = queues.get(accountId) || Promise.resolve();
  const next = prev.then(fn, fn);
  queues.set(
    accountId,
    next.catch(() => {})
  );
  return next;
}

export async function openUrl(account, url) {
  return withAccount(account.id, async () => {
    const page = await getPage(account, { headed: true });
    await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.bringToFront().catch(() => {});
    return page.url();
  });
}

/// লগইন উইজার্ড: দেখা যাওয়া উইন্ডোতে সাইট খুলে পেজটা ফেরত দেয়, যাতে
/// ভেতর থেকেই লগইন শেষ হয়েছে কি না দেখা যায়।
export async function openLoginPage(account, url) {
  return withAccount(account.id, async () => {
    const page = await getPage(account, { headed: true });
    await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.bringToFront().catch(() => {});
    return page;
  });
}

export async function accountPage(accountId) {
  const entry = browsers.get(accountId);
  if (!entry) return null;
  if (!(entry.ctx.browser()?.isConnected?.() ?? false)) return null;
  if (!entry.page || entry.page.isClosed()) return null;
  return entry.page;
}

export async function closeAccount(accountId) {
  const entry = browsers.get(accountId);
  if (!entry) return false;
  browsers.delete(accountId);
  await entry.ctx.close().catch(() => {});
  return true;
}

export function chromiumExecutable(kind = 'chrome') {
  return executableFor(kind);
}

/// কর্নারের "নতুন ট্যাব" বোতাম: পুরনো সব ট্যাব বন্ধ করে একটা ফাঁকা ট্যাব —
/// উইন্ডো আর লগইন অটুট থাকে, শুধু কাজের পেজ রিসেট হয়।
export async function resetTabs() {
  let closed = 0;
  for (const entry of browsers.values()) {
    for (const p of entry.ctx.pages()) {
      if (p.isClosed()) continue;
      await p.close().catch(() => {});
      closed += 1;
    }
    const page = await entry.ctx.newPage();
    page.setDefaultTimeout(45_000);
    page.setDefaultNavigationTimeout(60_000);
    entry.page = page;
  }
  return closed;
}

export async function closeBrowsers() {
  const ids = [...browsers.keys()];
  for (const id of ids) {
    const entry = browsers.get(id);
    browsers.delete(id);
    await entry?.ctx.close().catch(() => {});
  }
  await closeMedia().catch(() => {});
  return ids;
}

let mediaCtx = null;
let mediaPage = null;
const LAST_MEDIA = path.join(DATA_DIR, 'last-media.json');

function saveLastMedia(data) {
  try {
    fs.writeFileSync(LAST_MEDIA, JSON.stringify({ ...data, at: Date.now() }, null, 2), 'utf8');
  } catch {
    /* ignore */
  }
}

function loadLastMedia() {
  try {
    return JSON.parse(fs.readFileSync(LAST_MEDIA, 'utf8'));
  } catch {
    return null;
  }
}

async function getMediaPage() {
  if (mediaCtx) {
    const connected = mediaCtx.browser()?.isConnected?.() ?? false;
    if (!connected) mediaCtx = null;
  }
  if (!mediaCtx) {
    const exe = executableFor('chrome');
    if (!exe) throw new Error('Chrome/Edge পাওয়া যায়নি।');
    mediaCtx = await chromium.launchPersistentContext(path.join(PROFILE_DIR, 'media'), {
      executablePath: exe,
      headless: false,
      viewport: null,
      ignoreDefaultArgs: ['--enable-automation'],
      args: [
        ...ARGS.filter((a) => a !== '--mute-audio'),
        '--autoplay-policy=no-user-gesture-required',
        '--window-size=1280,860'
      ],
      locale: 'bn-BD',
      timezoneId: 'Asia/Dhaka'
    });
    mediaCtx.on('close', () => {
      mediaCtx = null;
      mediaPage = null;
    });
  }
  if (!mediaPage || mediaPage.isClosed()) {
    mediaPage = mediaCtx.pages().find((p) => !p.isClosed()) || (await mediaCtx.newPage());
    mediaPage.setDefaultTimeout(30_000);
  }
  return mediaPage;
}

async function dismissConsent(page) {
  const labels = [
    'button:has-text("Accept all")',
    'button:has-text("Reject all")',
    'button:has-text("I agree")',
    'tp-yt-paper-button:has-text("Accept all")'
  ];
  for (const label of labels) {
    const button = page.locator(label).first();
    if (await button.isVisible().catch(() => false)) {
      await button.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(800);
      return;
    }
  }
}

async function videoState(page) {
  return page.evaluate(() => {
    const v = document.querySelector('video');
    if (!v) return null;
    v.muted = false;
    v.volume = 1;
    return {
      paused: v.paused,
      current: Math.round(v.currentTime || 0),
      duration: Math.round(v.duration || 0),
      title: document.title.replace(/ - YouTube$/, '')
    };
  });
}

async function ensurePlaying(page) {
  await page.waitForSelector('video', { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(1500);
  let state = await videoState(page);
  if (state?.paused) {
    await page.keyboard.press('k').catch(() => {});
    await page.waitForTimeout(1200);
    state = await videoState(page);
  }
  if (state?.paused) {
    await page.evaluate(() => document.querySelector('video')?.play?.()).catch(() => {});
    await page.waitForTimeout(1200);
    state = await videoState(page);
  }
  return state;
}

export async function youtubeSearch(query) {
  const q = String(query || '').trim();
  if (!q) throw new Error('কী সার্চ করবে লিখো');
  const page = await getMediaPage();
  await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`, {
    waitUntil: 'domcontentloaded'
  });
  await dismissConsent(page);
  await page.waitForSelector('ytd-video-renderer a#video-title, a#video-title', { timeout: 25_000 }).catch(() => {});
  const results = await page.evaluate(() =>
    [...document.querySelectorAll('ytd-video-renderer a#video-title')]
      .slice(0, 6)
      .map((a) => ({
        title: (a.getAttribute('title') || a.textContent || '').trim(),
        url: a.href
      }))
      .filter((r) => r.title)
  );
  if (!results.length) return { ok: false, output: `ইউটিউবে "${q}" সার্চে কিছু পাওয়া যায়নি।` };
  return { ok: true, output: `ইউটিউবে "${q}" সার্চ ফলাফল:\n${results.map((r, i) => `${i + 1}. ${r.title}`).join('\n')}` };
}

// ইউটিউবের প্রথম ফলাফল প্রায়ই অন্য গান (প্লেলিস্ট/অ্যাড/কভার) — প্রশ্নের শব্দ মিলিয়ে
// সেরা ফলাফলটা বেছে নেওয়া হয়, নাহলে বস "ভুল গান" বলে বার বার নতুন ধাপ চালায়
function titleScore(query, title) {
  const words = (s) => String(s || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);
  const q = words(query);
  const t = words(title);
  if (!q.length || !t.length) return 0;
  const set = new Set(t);
  let hit = 0;
  for (const w of q) {
    if (set.has(w)) hit += 1;
    else if (t.some((x) => x.length > 3 && (x.startsWith(w) || w.startsWith(x)))) hit += 0.7;
  }
  const phrase = t.join(' ').includes(words(query).join(' ')) ? 0.4 : 0;
  return hit / q.length + phrase;
}

export async function youtubePlay(query) {
  let q = String(query || '').trim();
  const page = await getMediaPage();
  let picked = '';
  if (!q) {
    const onYoutube = /youtube\.com/.test(page.url());
    const hasVideo = onYoutube && (await page.locator('video').count());
    if (!hasVideo) {
      const last = loadLastMedia();
      if (last?.url) {
        await page.goto(last.url, { waitUntil: 'domcontentloaded' }).catch(() => {});
      } else if (last?.query) {
        q = last.query;
      } else {
        return { ok: false, output: 'এখন কোনো ইউটিউব ভিডিও খোলা নেই — কী গান চালাবে বলো।' };
      }
    }
  }
  if (q) {
    await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`, {
      waitUntil: 'domcontentloaded'
    });
    await dismissConsent(page);
    await page.waitForSelector('ytd-video-renderer a#video-title', { timeout: 25_000 }).catch(() => {});
    const links = page.locator('ytd-video-renderer a#video-title');
    const total = await links.count();
    if (!total) {
      return { ok: false, output: `ইউটিউবে "${q}" সার্চে কোনো ভিডিও পাওয়া যায়নি।` };
    }
    let best = links.first();
    let bestTitle = ((await best.getAttribute('title')) || '').trim();
    let bestScore = titleScore(q, bestTitle);
    for (let i = 1; i < Math.min(total, 8); i += 1) {
      if (bestScore >= 0.99) break;
      const el = links.nth(i);
      const title = ((await el.getAttribute('title')) || (await el.textContent()) || '').trim();
      const score = titleScore(q, title);
      if (score > bestScore) {
        best = el;
        bestTitle = title;
        bestScore = score;
      }
    }
    picked = bestTitle;
    await best.click();
    await page.waitForLoadState('domcontentloaded').catch(() => {});
  }
  const state = await ensurePlaying(page);
  if (!state) return { ok: false, output: 'ভিডিও প্লেয়ার পাওয়া যায়নি।' };
  if (state.paused) {
    return {
      ok: false,
      output: `ভিডিও পাওয়া গেছে ("${state.title}") কিন্তু প্লে শুরু হয়নি — হয়তো লগইন/বিজ্ঞাপন বাধা দিচ্ছে।`
    };
  }
  saveLastMedia({ query: q || loadLastMedia()?.query || '', url: page.url(), title: state.title });
  // "যাচাই" শব্দটা দরকারি: এজেন্ট নিজে প্লেয়ারের সময় দেখেছে, তাই অর্ডিনেস্ট্রা চোখ-ধাপ
  // (স্ক্রিনের ছবি দেখিয়ে ~১ মিনিট দেরি) বাদ যায় — গান চললেই কাজ শেষ
  return {
    ok: true,
    output: `ইউটিউবে চালানো হয়েছে (যাচাই: প্লেয়ার চলছে ${state.current}s${state.duration ? ` / ${state.duration}s` : ''}): ${state.title}${picked ? '' : ' (আগের ভিডিও)'}`
  };
}

export async function youtubePause() {
  const page = await getMediaPage();
  if (!/youtube\.com/.test(page.url())) return { ok: false, output: 'কোনো ইউটিউব ভিডিও খোলা নেই।' };
  const state = await videoState(page);
  if (!state) return { ok: false, output: 'ভিডিও প্লেয়ার পাওয়া যায়নি।' };
  if (!state.paused) {
    await page.keyboard.press('k').catch(() => {});
    await page.waitForTimeout(500);
  }
  return { ok: true, output: `ভিডিও থামানো হয়েছে: ${state.title}` };
}

export async function closeMedia() {
  const ctx = mediaCtx;
  mediaCtx = null;
  mediaPage = null;
  await ctx?.close().catch(() => {});
}
