import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { DATA_DIR } from './config.js';

const FILE = path.join(DATA_DIR, 'access.json');
const KEY_RE = /^[a-z0-9]{10}$/;

function makeKey() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(10);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

function loadKey() {
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (KEY_RE.test(parsed.key || '')) return parsed.key;
  } catch {
    /* first run */
  }
  const key = makeKey();
  fs.writeFileSync(FILE, JSON.stringify({ key }, null, 2), 'utf8');
  return key;
}

export const ACCESS_KEY = loadKey();
const SESSION = crypto.createHash('sha256').update(`pc-agent:${ACCESS_KEY}`).digest('hex');

export function isLoopback(req) {
  const addr = req.socket.remoteAddress || '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export function keyMatches(value) {
  return typeof value === 'string' && value.length === ACCESS_KEY.length && crypto.timingSafeEqual(Buffer.from(value), Buffer.from(ACCESS_KEY));
}

export function authorized(req, url) {
  if (isLoopback(req)) return true;
  if (keyMatches(url.searchParams.get('key'))) return true;
  return cookies(req).pa === SESSION;
}

export function unlockCookie() {
  return `pa=${SESSION}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`;
}

export function lanAddresses() {
  const found = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) found.push(net.address);
    }
  }
  const rank = (ip) => (/^192\.168\./.test(ip) ? 0 : /^10\./.test(ip) ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3);
  return found.sort((a, b) => rank(a) - rank(b));
}

export function unlockPage() {
  return `<!doctype html><html lang="bn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PC Agent · পাসকি</title><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#070d14;color:#dbe7f5;font-family:system-ui,Segoe UI,sans-serif}
form{background:rgba(255,255,255,.05);border:1px solid rgba(120,200,255,.25);padding:26px;border-radius:20px;width:min(90vw,340px)}
h1{font-size:15px;letter-spacing:.12em;text-transform:uppercase;margin:0 0 6px;color:#8fd0ff}
p{font-size:13px;line-height:1.6;color:#8fa3b8;margin:0 0 16px}
input{width:100%;box-sizing:border-box;padding:12px 14px;border-radius:12px;border:1px solid rgba(120,200,255,.25);background:#0b1622;color:#e8f2ff;font-size:16px;letter-spacing:.15em}
button{margin-top:12px;width:100%;padding:12px;border:0;border-radius:12px;background:#2f9dff;color:#04121f;font-weight:700;font-size:14px}
</style></head><body><form method="GET" action="/">
<h1>PC · AGENT</h1>
<p>এই ডিভাইসটি অনুমোদিত নয়। ডেস্কটপ ড্যাশবোর্ডের সেটিংস → শেয়ার থেকে লিংকটি নিন, অথবা পাসকি লিখুন।</p>
<input name="key" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="পাসকি" autofocus>
<button type="submit">খুলুন</button></form></body></html>`;
}
