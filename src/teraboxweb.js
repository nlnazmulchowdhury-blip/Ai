// টেরাবক্সে শুধু লগইন করলেই ডেটা-লেন চালু: আলাদা AList/টোকেন লাগে না।
// লগইন করা ব্রাউজার-সেশন (profiles/terabox) থেকেই সাইটের নিজের API পড়া হয়,
// তাই পাসওয়ার্ড/cookie কোথাও লেখা বা ছাপা হয় না।
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { DATA_DIR, PROFILE_DIR } from './config.js';
import { chromiumExecutable } from './browser.js';

export const TERABOX_HOME = 'https://www.terabox.com/main';
const SESSION_FILE = path.join(DATA_DIR, 'terabox-session.json');
const ROOT_CANDIDATES = ['/Ai/PC-Agent', '/apps/Ai/PC-Agent', '/PC-Agent'];
const ARGS = [
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-infobars',
  '--disable-blink-features=AutomationControlled',
  '--disable-background-networking',
  '--disable-sync',
  '--disable-extensions',
  '--disable-dev-shm-usage',
  '--disable-features=Translate,MediaRouter',
  '--mute-audio'
];

let ctx = null;
let page = null;
let session = null;
let idleTimer = null;

// হিডেন ব্রাউজার খোলা থাকলে ৩ মিনিট নিষ্ক্রিয়তায় নিজেই বন্ধ — র‍্যাম বাঁচে
function touchIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (ctx && ctx.__headed === false) closeTerabox().catch(() => {});
  }, 180_000);
  idleTimer.unref?.();
}

export function teraboxSession() {
  if (session) return session;
  try {
    session = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
  } catch {
    session = null;
  }
  return session;
}

function saveSession(data) {
  session = { ...(teraboxSession() || {}), ...data, at: Date.now() };
  try {
    fs.writeFileSync(SESSION_FILE, JSON.stringify(session), { mode: 0o600 });
  } catch {
    /* সেশন ফাইল না লিখলেও প্রোফাইল-কুকি থাকে */
  }
}

async function ensureCtx(headed) {
  if (ctx && !(ctx.browser()?.isConnected?.() ?? false)) {
    ctx = null;
    page = null;
  }
  if (ctx && ctx.__headed !== headed) {
    await ctx.close().catch(() => {});
    ctx = null;
    page = null;
  }
  if (!ctx) {
    const exe = chromiumExecutable('chrome');
    if (!exe) throw new Error('Chrome/Edge পাওয়া যায়নি');
    const dir = path.join(PROFILE_DIR, 'terabox');
    fs.mkdirSync(dir, { recursive: true });
    ctx = await chromium.launchPersistentContext(dir, {
      executablePath: exe,
      headless: !headed,
      viewport: headed ? null : { width: 1366, height: 900 },
      ignoreDefaultArgs: ['--enable-automation'],
      args: ARGS,
      locale: 'bn-BD',
      timezoneId: 'Asia/Dhaka'
    });
    ctx.__headed = headed;
    ctx.on('close', () => {
      ctx = null;
      page = null;
    });
  }
  if (!page || page.isClosed()) {
    page = ctx.pages().find((p) => !p.isClosed()) || (await ctx.newPage());
    page.setDefaultTimeout(45_000);
  }
  touchIdle();
  return page;
}

export async function openTeraboxLogin() {
  const p = await ensureCtx(true);
  await p.goto(TERABOX_HOME, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await p.bringToFront().catch(() => {});
  return p;
}

export async function teraboxCookie() {
  if (!ctx) return '';
  const cookies = await ctx.cookies(['https://www.terabox.com']).catch(() => []);
  const hit = cookies.find((c) => c.name === 'ndus' && String(c.value || '').length > 12);
  return hit ? { cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; '), ua: await ctx.pages()[0]?.evaluate(() => navigator.userAgent).catch(() => '') } : null;
}

export async function closeTerabox() {
  clearTimeout(idleTimer);
  const c = ctx;
  ctx = null;
  page = null;
  await c?.close().catch(() => {});
}

export function teraboxOpen() {
  return Boolean(ctx && (ctx.browser()?.isConnected?.() ?? false));
}

// লগইন হয়ে গেলে সেশন-ফাইল লিখে ব্রাউজার বন্ধ — পরে দরকারে হিডেন খুলবে
export async function captureTeraboxSession() {
  const hit = await teraboxCookie();
  if (!hit) return null;
  saveSession({ cookie: hit.cookie, ua: hit.ua || '' });
  return teraboxSession();
}

async function tbFetch(pathname, { method = 'GET', headers = {}, body } = {}) {
  const p = await ensureCtx(false);
  if (!/terabox\.com/.test(p.url())) {
    await p.goto(TERABOX_HOME, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await p.waitForTimeout(1200);
  }
  const out = await p.evaluate(
    async ({ u, method, headers, body }) => {
      try {
        const res = await fetch(u, { method, headers, body, credentials: 'include' });
        const text = await res.text();
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {
          /* non-json */
        }
        return { status: res.status, json, text: json ? '' : text.slice(0, 200) };
      } catch (err) {
        return { status: 0, error: String(err && err.message ? err.message : err) };
      }
    },
    { u: pathname, method, headers, body }
  );
  return out;
}

const API_COMMON = 'app_id=250528&web=1&clienttype=0&channel=0&client=web';

async function tbList(dir) {
  const q = `/api/list?dir=${encodeURIComponent(dir)}&order=name&num=200&page=1&${API_COMMON}`;
  const r = await tbFetch(q);
  if (!r.json) return { ok: false, error: r.error || `HTTP ${r.status}`, list: [] };
  if (r.json.errno !== 0) return { ok: false, error: `errno ${r.json.errno}`, list: [] };
  return { ok: true, list: Array.isArray(r.json.list) ? r.json.list : [] };
}

async function resolveRoot() {
  const known = teraboxSession()?.root;
  if (known) {
    const hit = await tbList(known);
    if (hit.ok) return known;
  }
  for (const dir of ROOT_CANDIDATES) {
    const hit = await tbList(dir);
    if (hit.ok) return dir;
  }
  return '';
}

async function dlinkFor(filePath) {
  const q = `/api/filemetas?dlink=1&target=${encodeURIComponent(JSON.stringify([filePath]))}&${API_COMMON}`;
  const r = await tbFetch(q);
  const info = r.json?.info?.[0];
  return info?.dlink || info?.thumbs?.url3 || '';
}

async function fetchText(url) {
  const p = await ensureCtx(false);
  const viaPage = await p.evaluate(async (u) => {
    try {
      const res = await fetch(u, { credentials: 'include' });
      if (!res.ok) return { ok: false, status: res.status };
      return { ok: true, text: await res.text() };
    } catch (err) {
      return { ok: false, error: String(err && err.message ? err.message : err) };
    }
  }, url);
  if (viaPage.ok) return viaPage;
  const s = teraboxSession();
  const res = await fetch(url, {
    headers: { cookie: s?.cookie || '', 'user-agent': s?.ua || 'Mozilla/5.0', referer: TERABOX_HOME }
  });
  if (!res.ok) throw new Error(`ডাউনলোড HTTP ${res.status}`);
  return { ok: true, text: await res.text() };
}

// লগইন আছে কি না + ফোল্ডার ঠিকানা — উইজার্ডের "সংযুক্ত" প্রমাণ
export async function probeTerabox() {
  const p = await ensureCtx(false);
  if (!/terabox\.com/.test(p.url())) {
    await p.goto(TERABOX_HOME, { waitUntil: 'domcontentloaded' }).catch(() => {});
  }
  const deadline = Date.now() + 20_000;
  let hit = null;
  while (Date.now() < deadline) {
    hit = await teraboxCookie();
    if (hit) break;
    await p.waitForTimeout(1500);
  }
  if (!hit) return { ok: false, note: 'লগইন দরকার' };
  saveSession({ cookie: hit.cookie, ua: hit.ua || teraboxSession()?.ua || '' });
  const root = await resolveRoot();
  if (!root) return { ok: false, note: 'লগইন আছে, কিন্তু /Ai/PC-Agent ফোল্ডার পাওয়া যায়নি' };
  saveSession({ cookie: hit.cookie, ua: hit.ua || '', root });
  const listing = await tbList(root);
  return {
    ok: true,
    root,
    files: listing.list.filter((f) => !f.isdir).map((f) => f.server_filename).slice(0, 12)
  };
}

export async function readTeraboxJson(name) {
  const root = teraboxSession()?.root || (await resolveRoot());
  if (!root) return null;
  const dlink = await dlinkFor(`${root}/${name}`);
  if (!dlink) return null;
  const res = await fetchText(dlink);
  return JSON.parse(res.text);
}
