// "শুধু লগইন করলেই চলবে" — সাইটে একবার হাতে লগইন করলে সেশন প্রোফাইলে থেকে যায়,
// তারপর এজেন্ট নিজেই হিডেন ব্রাউজারে কাজ করে। এখানে সেটার স্ট্যাটাস আর উইজার্ড।
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, loadConfig, findAccount } from './config.js';
import { getPage, openLoginPage, closeAccount, accountPage } from './browser.js';
import { PROVIDER_META, siteProbe, webProviders } from './providers.js';
import {
  TERABOX_HOME,
  openTeraboxLogin,
  teraboxCookie,
  captureTeraboxSession,
  closeTerabox,
  probeTerabox,
  teraboxOpen
} from './teraboxweb.js';

const CACHE_FILE = path.join(DATA_DIR, 'connect.json');
const loginBusy = new Set();
let notifier = () => {};

export function setConnectNotifier(fn) {
  notifier = typeof fn === 'function' ? fn : () => {};
}

function loadCache() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    return {
      providers: parsed.providers && typeof parsed.providers === 'object' ? parsed.providers : {},
      terabox: parsed.terabox && typeof parsed.terabox === 'object' ? parsed.terabox : {}
    };
  } catch {
    return { providers: {}, terabox: {} };
  }
}

function saveCache(cache) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
  } catch {
    /* স্ট্যাটাস ক্যাশ লেখা না হলেও চলবে */
  }
}

function mark(key, value, extra = {}) {
  const cache = loadCache();
  if (key === 'terabox') cache.terabox = { ...extra, ...value, at: Date.now() };
  else cache.providers[key] = { ...extra, ...value, at: Date.now() };
  saveCache(cache);
  const summary = connectSummary();
  notifier(summary);
  return summary;
}

export function connectSummary() {
  const cache = loadCache();
  const providers = {};
  for (const key of webProviders()) {
    const hit = cache.providers[key];
    providers[key] = {
      label: PROVIDER_META[key]?.label || key,
      color: PROVIDER_META[key]?.color || '#7ab8ff',
      url: PROVIDER_META[key]?.url || '',
      ok: Boolean(hit?.ok),
      at: Number(hit?.at) || 0,
      note: String(hit?.note || ''),
      busy: loginBusy.has('provider:' + key)
    };
  }
  const t = cache.terabox;
  return {
    providers,
    terabox: {
      ok: Boolean(t?.ok),
      at: Number(t?.at) || 0,
      note: String(t?.note || ''),
      root: String(t?.root || ''),
      files: Array.isArray(t?.files) ? t.files : [],
      busy: loginBusy.has('terabox')
    },
    ready: Object.values(providers).some((p) => p.ok),
    any: Object.values(providers).some((p) => p.ok) || Boolean(t?.ok)
  };
}

async function composerVisible(page, site) {
  for (const sel of site.composer) {
    const hit = await page.locator(sel).first().isVisible().catch(() => false);
    if (hit) return true;
  }
  return false;
}

async function probePage(key, page) {
  const site = siteProbe(key);
  if (!site) return { ok: false, note: 'অজানা সাইট' };
  let url = '';
  try {
    url = page.url();
  } catch {
    return { ok: false, note: 'পেজ বন্ধ' };
  }
  const sameOrigin = (() => {
    try {
      return new URL(url).origin === new URL(site.url).origin;
    } catch {
      return false;
    }
  })();
  if (!sameOrigin) {
    await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {});
  }
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    let now = '';
    try {
      now = page.url();
    } catch {
      return { ok: false, note: 'পেজ বন্ধ' };
    }
    if (site.loginUrl.test(now)) return { ok: false, note: 'লগইন পেজে আছে' };
    if (await composerVisible(page, site)) return { ok: true, note: '', url: now };
    await page.waitForTimeout(700);
  }
  return { ok: false, note: 'লেখার বাক্স পাওয়া যায়নি — লগইন দরকার', url };
}

export async function checkProvider(key, accountId) {
  if (loginBusy.has('provider:' + key)) return connectSummary().providers[key];
  const cfg = loadConfig();
  const account = findAccount(cfg, accountId);
  if (!account) throw new Error('অ্যাকাউন্ট পাওয়া যায়নি');
  const page = await getPage(account);
  const probe = await probePage(key, page);
  mark(key, { ok: probe.ok, note: probe.note });
  return connectSummary().providers[key];
}

// একবার ব্রাউজার খুলে সব সাইট দেখা — লগইন-না-করা হলে ব্রাউজারটা আবার বন্ধ করে দিই
export async function checkAll({ keepBrowser = false } = {}) {
  const cfg = loadConfig();
  const account = findAccount(cfg, '');
  const wasOpen = Boolean(accountPage(account.id));
  const results = {};
  for (const key of webProviders()) {
    try {
      results[key] = await checkProvider(key, account.id);
    } catch (err) {
      mark(key, { ok: false, note: String(err.message || err) });
      results[key] = connectSummary().providers[key];
    }
  }
  if (!wasOpen && !keepBrowser) await closeAccount(account.id).catch(() => {});
  return { providers: results, terabox: connectSummary().terabox, ready: connectSummary().ready };
}

function watchProvider(key, page, account) {
  loginBusy.add('provider:' + key);
  notifier(connectSummary());
  const site = siteProbe(key);
  const deadline = Date.now() + 10 * 60_000;
  const loop = async () => {
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2500));
      if (!page || page.isClosed()) break;
      let url = '';
      try {
        url = page.url();
      } catch {
        break;
      }
      if (site.loginUrl.test(url)) continue;
      if (!(await composerVisible(page, site))) continue;
      mark(key, { ok: true, note: '' });
      await new Promise((r) => setTimeout(r, 6000));
      await closeAccount(account.id).catch(() => {});
      break;
    }
    loginBusy.delete('provider:' + key);
    notifier(connectSummary());
  };
  loop().catch(() => {
    loginBusy.delete('provider:' + key);
    notifier(connectSummary());
  });
}

function watchTerabox() {
  loginBusy.add('terabox');
  notifier(connectSummary());
  const deadline = Date.now() + 10 * 60_000;
  const loop = async () => {
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2500));
      const hit = await teraboxCookie();
      if (!hit) continue;
      await captureTeraboxSession();
      try {
        const probe = await probeTerabox();
        mark('terabox', { ok: probe.ok, note: probe.note || '', root: probe.root || '', files: probe.files || [] });
      } catch (err) {
        mark('terabox', { ok: true, note: `লগইন আছে, API: ${String(err.message || err).slice(0, 120)}` });
      }
      await new Promise((r) => setTimeout(r, 4000));
      await closeTerabox().catch(() => {});
      break;
    }
    loginBusy.delete('terabox');
    notifier(connectSummary());
  };
  loop().catch(() => {
    loginBusy.delete('terabox');
    notifier(connectSummary());
  });
}

export async function beginLogin(target, { accountId = '' } = {}) {
  if (target === 'terabox') {
    if (loginBusy.has('terabox')) return { ok: true, already: true, url: TERABOX_HOME };
    await openTeraboxLogin();
    watchTerabox();
    return { ok: true, url: TERABOX_HOME };
  }
  if (!PROVIDER_META[target]) throw new Error('অজানা সাইট — gemini/chatgpt/deepseek/duckai/terabox');
  if (loginBusy.has('provider:' + target)) return { ok: true, already: true, url: PROVIDER_META[target].url };
  const cfg = loadConfig();
  const account = findAccount(cfg, accountId);
  if (!account) throw new Error('অ্যাকাউন্ট পাওয়া যায়নি');
  const page = await openLoginPage(account, PROVIDER_META[target].url);
  watchProvider(target, page, account);
  return { ok: true, url: PROVIDER_META[target].url };
}

export async function checkTeraboxNow() {
  if (loginBusy.has('terabox')) return connectSummary().terabox;
  const wasOpen = teraboxOpen();
  const probe = await probeTerabox();
  mark('terabox', { ok: probe.ok, note: probe.note || '', root: probe.root || '', files: probe.files || [] });
  if (!wasOpen) await closeTerabox().catch(() => {});
  return connectSummary().terabox;
}
