import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, WORKSPACE } from './config.js';

const FILE = path.join(DATA_DIR, 'devices.json');
const SHOTS = path.join(WORKSPACE, 'shots');
const ONLINE_WINDOW_MS = 25_000;
const MAX_QUEUE = 20;
const MAX_FRAMES = 6;

// id -> array of pending commands (survive until a phone drains them)
const queues = new Map();
// id -> Set(http.ServerResponse) open SSE channels
const streams = new Map();
// id -> { file, at } last phone screen frame
const frames = new Map();

function load() {
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (Array.isArray(parsed.devices)) return parsed.devices;
  } catch {
    /* first run */
  }
  return [];
}

function save(list) {
  fs.writeFileSync(FILE, JSON.stringify({ devices: list, updatedAt: Date.now() }, null, 2), 'utf8');
}

function clientIp(req) {
  const raw = String(req?.socket?.remoteAddress || '');
  return raw.replace(/^::ffff:/, '');
}

function detectPlatform(ua) {
  const s = String(ua || '');
  if (/iphone|ipad|ipod/i.test(s)) return 'iphone';
  if (/android/i.test(s)) return 'android';
  if (/windows/i.test(s)) return 'windows';
  if (/mac os x|macintosh/i.test(s)) return 'mac';
  return 'unknown';
}

export function listDevices() {
  const now = Date.now();
  return load()
    .map((d) => ({ ...d, online: now - (d.lastSeen || 0) < ONLINE_WINDOW_MS }))
    .sort((a, b) => (b.online ? 1 : 0) - (a.online ? 1 : 0) || (b.lastSeen || 0) - (a.lastSeen || 0));
}

export function findDevice(id) {
  return load().find((d) => d.id === id) || null;
}

export function pairDevice({ name, ua, req }) {
  const list = load();
  const platform = detectPlatform(ua);
  const label = String(name || '').trim().slice(0, 40) || (platform === 'android' ? 'অ্যান্ড্রয়েড ফোন' : platform === 'iphone' ? 'আইফোন' : 'ডিভাইস');
  const id = `dev-${crypto.randomBytes(4).toString('hex')}`;
  const device = {
    id,
    name: label,
    platform,
    ip: clientIp(req),
    ua: String(ua || '').slice(0, 160),
    pairedAt: Date.now(),
    lastSeen: Date.now()
  };
  const others = list.filter((d) => d.ip !== device.ip || d.name !== label);
  save([...others, device].slice(-12));
  queues.set(id, []);
  return device;
}

export function renameDevice(id, name) {
  const list = load();
  const d = list.find((x) => x.id === id);
  if (!d) return null;
  d.name = String(name || '').trim().slice(0, 40) || d.name;
  save(list);
  return d;
}

export function forgetDevice(id) {
  save(load().filter((d) => d.id !== id));
  queues.delete(id);
  for (const res of streams.get(id) || []) {
    try {
      res.end();
    } catch {
      /* closed */
    }
  }
  streams.delete(id);
  frames.delete(id);
  return { ok: true };
}

export function beatDevice(id, meta = {}) {
  const list = load();
  const d = list.find((x) => x.id === id);
  if (!d) return null;
  d.lastSeen = Date.now();
  d.ip = clientIp(meta.req) || d.ip;
  if (meta.battery != null) d.battery = Math.round(Number(meta.battery));
  if (meta.charging != null) d.charging = !!meta.charging;
  if (meta.app) d.app = String(meta.app).slice(0, 60);
  save(list);
  return { device: d, commands: drain(id) };
}

export function onlineCount() {
  const now = Date.now();
  return load().filter((d) => now - (d.lastSeen || 0) < ONLINE_WINDOW_MS).length;
}

export function devicesSummary() {
  const list = listDevices();
  if (!list.length) return '';
  return list
    .map((d) => `${d.online ? '✓' : '✗'} ${d.name} (${d.platform}${d.battery != null ? `, ব্যাটারি ${d.battery}%` : ''})`)
    .join(' | ');
}

function openStream(id, res) {
  if (!streams.has(id)) streams.set(id, new Set());
  streams.get(id).add(res);
  // an open channel is the fastest way to hand over anything already queued
  setImmediate(() => flush(id));
}

function closeStream(id, res) {
  const set = streams.get(id);
  if (!set) return;
  set.delete(res);
  if (!set.size) streams.delete(id);
}

function write(res, event, data) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    /* socket gone */
  }
}

export function attachDeviceStream(id, res, req) {
  if (!findDevice(id)) return false;
  openStream(id, res);
  write(res, 'hello', { ok: true, id, at: Date.now() });
  req.on('close', () => closeStream(id, res));
  return true;
}

function flush(id) {
  const set = streams.get(id);
  if (!set || !set.size) return;
  const queue = queues.get(id) || [];
  if (!queue.length) return;
  queues.set(id, []);
  for (const res of set) {
    for (const cmd of queue) write(res, 'cmd', cmd);
  }
}

export function pushCommand(id, { type, ...payload }) {
  const device = findDevice(id);
  if (!device) return { ok: false, error: 'ডিভাইস পাওয়া যায়নি' };
  const cmd = { id: `c-${crypto.randomBytes(4).toString('hex')}`, type, ts: Date.now(), ...payload };
  const queue = queues.get(id) || [];
  queue.push(cmd);
  queues.set(id, queue.slice(-MAX_QUEUE));
  const live = streams.has(id);
  flush(id);
  return { ok: true, queued: !live, command: cmd, device: device.name };
}

export function broadcastCommand(cmdSpec) {
  const list = listDevices().filter((d) => d.online);
  if (!list.length) return { ok: false, error: 'কোনো ফোন অনলাইনে নেই — ফোনে /phone খুলে রাখুন' };
  return { ok: true, sent: list.map((d) => `${d.name}: ${pushCommand(d.id, cmdSpec).queued ? 'লাইন-আপে বসানো হয়েছে' : 'পাঠানো হয়েছে'}`) };
}

export function drain(id) {
  const queue = queues.get(id) || [];
  queues.set(id, []);
  return queue;
}

export function pendingCount(id) {
  return (queues.get(id) || []).length;
}

export function saveFrame(id, dataUrl) {
  const device = findDevice(id);
  if (!device) return { ok: false, error: 'ডিভাইস পাওয়া যায়নি' };
  const m = /^data:image\/(png|jpe?g);base64,([\s\S]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new Error('ফ্রেম data:image/png বা jpeg হতে হবে');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 4_000_000) throw new Error('ফ্রেম অনেক বড় (৪MB-এর বেশি)');
  fs.mkdirSync(SHOTS, { recursive: true });
  const ext = m[1] === 'png' ? 'png' : 'jpg';
  const file = path.join(SHOTS, `phone-${id}-${Date.now()}.${ext}`);
  fs.writeFileSync(file, buf);
  const list = load();
  const d = list.find((x) => x.id === id);
  if (d) {
    d.lastFrame = file;
    d.lastSeen = Date.now();
    save(list);
  }
  const history = frames.get(id) || [];
  history.push({ file, at: Date.now() });
  const trimmed = history.slice(-MAX_FRAMES);
  for (const old of history) if (!trimmed.includes(old) && fs.existsSync(old.file)) fs.unlinkSync(old.file);
  frames.set(id, trimmed);
  return { ok: true, file, size: buf.length };
}

export function latestFrame(id) {
  const history = frames.get(id) || [];
  const last = history[history.length - 1];
  if (last && fs.existsSync(last.file)) return last;
  const d = findDevice(id);
  if (d?.lastFrame && fs.existsSync(d.lastFrame)) return { file: d.lastFrame, at: d.lastSeen };
  return null;
}

export function frameHistory(id) {
  return (frames.get(id) || []).filter((f) => fs.existsSync(f.file));
}
