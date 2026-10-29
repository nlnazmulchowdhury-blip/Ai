import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { WORKSPACE, ROOT } from './config.js';
import { AgentError } from './providers.js';
import { addLesson } from './lessons.js';

function detectDesktop() {
  const home = os.homedir();
  const candidates = [
    process.env.OneDrive && path.join(process.env.OneDrive, 'Desktop'),
    process.env.OneDriveConsumer && path.join(process.env.OneDriveConsumer, 'Desktop'),
    path.join(home, 'OneDrive', 'Desktop'),
    path.join(home, 'Desktop')
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || path.join(home, 'Desktop');
}

const DESKTOP = detectDesktop();
const PROJECT_ROOT = path.resolve(WORKSPACE, '..');
const PS1 = path.join(PROJECT_ROOT, 'src', 'ps', 'win_tools.ps1');

export const TOOL_HELP = `টুল তালিকা (pc array-এ ব্যবহার করো):
- list_dir {"path":"."} — ফোল্ডারের লিস্ট
- make_dir {"path":"Desktop/নতুন ফোল্ডার"} — নতুন ফোল্ডার তৈরি (workspace-এ বা বাইরে); "Desktop/..." লেখলে ডেস্কটপের ভেতরে (OneDrive সহ) বানাবে; অন্য জায়গা হলে পূর্ণ পাথ দাও, পাথে forward slash দাও, ডাবল কোট লাগে না
- read_file {"path":"notes.txt"} — ফাইল পড়া
- write_file {"path":"report.json","content":{ }} — ফাইল লেখা (workspace-এর ভেতরে); content অবজেক্ট, অ্যারে বা টেক্সট হতে পারে
- delete_path {"path":"Desktop/Nazmul"} — ফাইল বা ফোল্ডার (ভেতরের জিনিসসহ) মুছে ফেলা। ফোল্ডার/ফাইল ডিলিটের একমাত্র সঠিক উপায় এটাই — run_command-এ rmdir/Remove-Item/del চালাতে যাবে না
- window_list {} — এখন খোলা উইন্ডোগুলোর তালিকা (প্রোগ্রাম + টাইটেল); কিছু খুলল/বন্ধ হলো কিনা যাচাই করতে ব্যবহার করো
- window_focus {"title":"Resolve","solo":true} — শিরোনামের অংশ দিয়ে উইন্ডোটি সামনে তোলে (minimized থাকলে ফিরিয়ে আনে) আর নিজেই যাচাই বলে কোন উইন্ডো এখন ফোকাসে; "solo":true দিলে বাকি সব উইন্ডো (এজেন্ট হ্যাট বাদে) মিনিমাইজ হয়, ফলে স্ক্রিনশটে শুধু লক্ষ্যটাই দেখায়। প্রতিটি ক্লিক/টাইপ/see_screen-এর আগে দরকারি: এই টুল না থাকলে স্ক্রিনশটে সবসময় যে উইন্ডো আগে থেকে সামনে ছিল (ধরো Qoder/ব্রাউজার) সেটাই দেখায়, নতুন অ্যাপটি নয় — তাই "বোতাম দেখা যাচ্ছে না" ভুল ধারণা হয়। মিনিমাইজ/থামানো ধরনের কাজ এ দিয়েই হয়
- screen_capture {} — পুরো স্ক্রিনের ছবি workspace/shots-এ সেভ করে পাথ দেয় (ইউজার ছবি চাইলে; পুরনো ছবি স্বয়ংক্রিয়ভাবে মুছে যায়)
- যাচাই-চোখ (স্বয়ংক্রিয়) — প্রতিটি দৃশ্য পরিবর্তনের (open_url/open_path/window_focus/mouse_control/type_text/press_keys/youtube_play/run_command) পর সিস্টেম নিজেই স্ক্রিনের ছবি তুলে দেখে কী হয়েছে, ফলাফল তোমাকে জানায়, ছবিটি সঙ্গে সঙ্গে মুছে ফেলে। তাই প্রমাণের জন্য আলাদা করে screen_capture/see_screen চালিও না — শুধু ক্লিকের আগে ঠিকানা জানতে see_screen দাও।
- see_screen {"question":"স্ক্রিনে কী দেখা যাচ্ছে? / কোন উইন্ডো খোলা? / X কোথায়?"} — স্ক্রিনের লাইভ ছবি তুলে AI-কে দেখিয়ে উত্তর নেয় (স্ক্রিন শেয়ারের মতো; API চললে API-তে, না চললে জেমিনি ওয়েব); ইউজার "দেখে/স্ক্রিন দেখে" ধরনের কাজ দিলে এটাই ব্যবহার করো
- mouse_control {"action":"move|click|double|right|drag|scroll|pos","position":"x,y","to":"x,y","amount":-3} — আসল মাউস ইভেন্ট (SendInput): পিক্সেল পজিশনে নড়া, ক্লিক, ডাবল-ক্লিক, রাইট-ক্লিক, ড্র্যাগ, স্ক্রল, বা বর্তমান পজিশন পড়া। স্ক্রিনের উপরের-বাম (0,0) কোণ; আগে see_screen দিয়ে ঠিকানা জেনে তারপর ক্লিক করো — ক্লিকের পর সিস্টেম নিজেই স্ক্রিন দেখে জানাবে
- type_text {"text":"যেকোনো লেখা, বাংলাও"} — যে উইন্ডো ফোকাসে আছে সেখানে কীরকর করে টাইপ করে (ক্লিপবোর্ড নয়, তাই বাংলাও নিখুঁত)। টাইপের আগে টার্গেট উইন্ডোতে একটা ক্লিক করে ফোকাস দাও
- press_keys {"keys":"ctrl+s"} — শর্টকাট/কী চাপা: ctrl, alt, shift, win, enter, tab, esc, space, backspace, delete, home, end, pageup, pagedown, up/down/left/right, f1–f24, a–z, 0–9; "+" দিয়ে মেলো (alt+tab, win+d, ctrl+shift+esc)। ভলিউম/মিডিয়াও এই টুলেই চলে: volumeup, volumedown, volumemute, mediaplaypause, medianext, mediaprev, mediastop — ভলিউম বাড়াতে {"keys":"volumeup"} (বার বার চাপলে বাড়বে); PowerShell/নতুন কমান্ড আবিষ্কার করতে যাবে না, audio endpoint সেট করার কমান্ড এই পিসিতে নেই
- resolve {"action":"edit|import|blade|ripple_delete|play|home|end|step|color|deliver|zoom_fit|save|undo|focus|state","path":"C:/...mp4","frames":48,"times":2} — DaVinci Resolve সরাসরি চালানো (ফ্রি ভার্সনে বাইরের স্ক্রিপ্ট API নেই, তাই আসল কী-ইভেন্ট দিয়ে): পেজ বদল (media/cut/edit/fusion/color/fairlight/deliver), import (Ctrl+I দিয়ে path-এর ফাইল মিডিয়া পুলে), blade (প্লেহেডে কাট), ripple_delete, lift, play/pause, home/end, step, zoom_fit, insert/overwrite, save, undo, focus/state। ফোকাস + কী + স্ক্রিনশট একই ধাপে হয়, তাই ছবিতে সবসময় Resolve-ই থাকে — আলাদা window_focus/screen_capture লাগে না, আর সিস্টেম সেই ছবিটাই দেখে যাচাই করে
- screen_capture {"title":"Resolve"} — শুধু ওই উইন্ডো সামনে এনে ছবি তোলে (title ছাড়া দিলে পুরো স্ক্রিন)
- phone_list {} — একই WiFi-তে যুক্ত ফোন/ডিভাইসগুলোর নাম, id, অনলাইন-অফলাইন হালত আর ব্যাটারি
- phone_control {"action":"speak|notify|show|open_url|ring|vibrate|screen|close_card","device":"ফোনের নাম বা id (একটাই অনলাইনে থাকলে দিতে হবে না)","text":"...","title":"...","url":"https://..."} — ফোনে কমান্ড পাঠানো: জোরে বলা, নোটিফিকেশন/কম্পন, বড় কার্ড দেখানো, ফোনে লিংক খোলা, অ্যালার্ম বাজানো (stop_ring থামায়), স্ক্রিনশট তোলার অনুরোধ (screen)। device না দিলে সব অনলাইন ফোনে যায়
- phone_screen {"question":"ফোনের স্ক্রিনে কী আছে?"} — ফোনের 📸 বোতামে পাঠানো সর্বশেষ স্ক্রিনশট নিয়ে AI-কে দেখিয়ে উত্তর নেয় (ফোনের see_screen)। মোবাইল ব্রাউজারে লাইভ স্ক্রিন শেয়ার চলে না, তাই ছবি না থাকলে অনুরোধ পাঠায় — ইউজারকে স্ক্রিনশট তুলে 📸-তে বাছুন বলো, তারপর ২০-৩০ সেকেন্ড পর আবার চেষ্টা করো
- learn_lesson {"lesson":"যে ভুল হয়েছে আর তার সঠিক উপায়","tool":"টুলের নাম","code":"error কোড","keywords":["কীওয়ার্ড"]} — নিজের ভুল থেকে শেখা পাঠ জমা করো, পরে সব বট সেটা দেখে ভুল এড়াবে
- self_update {"file":"src/pctools.js","content":"নতুন সম্পূর্ণ ফাইল"} — এজেন্টের নিজের কোড/কনফিগ আপডেট করা (অনুমোদিত ফাইল: src/, public/, server.js, data/config.json, data/lessons.json); ব্যাকআপ আগে নেওয়া হয়, ভুল কোড আটকে যায়, পরের রিস্টার্টে কার্যকর হয়। ইউজার "নিজেকে আপডেট করো/উন্নত করো" বললেই শুধু ব্যবহার করো
- restart_self {} — নিজেকে রিস্টার্ট করা (self_update-এর পর নতুন কোড চালু করতে); রিস্টার্টে চলমান কাজ আবার শুরু হয়
- open_path {"path":"C:/Users/..."} — ফাইল/ফোল্ডার/অ্যাপ খোলা। অ্যাপের নামও চলবে — বাংলায় বললেও চলবে ("ভিসি কোড", "নোটপেট", "ক্রোম") বা ইংরেজিতেও ("vs code", "chrome") — ঠিকানা মিল না পেলে টুল নিজেই Start Menu/ইনস্টল করা অ্যাপ থেকে সঠিক ঠিকানা বের করে খোলে এবং উইন্ডো দেখে "যাচাই" বলে; তাই ইনস্টল করা পাথ অনুমান করে বার বার চালাও না, আর খোলার আগে window_list চক্র বানাও না
- run_command {"command":"dir","cwd":".","timeoutMs":280000} — Windows কমান্ড (সরাসরি চলে)। লম্বা কাজে (ffmpeg রেন্ডার, বড় কপি) timeoutMs দাও — না দিলে ৬০ সেকেন্ডে কমান্ড মেরে ফেলা হয়, রেন্ডার তখন অসম্পূর্ণ (moov atom not found) থেকে যায়; সর্বোচ্চ ৩০০০০০ (৫ মিনিট)। এই পিসিতে রেন্ডার ধীর, তাই -preset ultrafast ব্যবহার করো
- open_url {"url":"https://..."} — ডিফল্ট ব্রাউজারে লিংক খোলে আর নিজেই উইন্ডো-শিরোনাম দেখে যাচাই করে; ফলাফল পেলেই কাজ শেষ — window_list/see_screen দিয়ে বার বার প্রমাণ নিও না
- youtube_play {"query":"গানের নাম"} — ইউটিউবে সার্চ করে প্রথম ভিডিও/গান চালু করে (আসল প্লে, শব্দসহ); query না দিলে চলমান ভিডিও আবার প্লে/resume করে
- youtube_search {"query":"গানের নাম"} — ইউটিউবে সার্চ করে ফলাফলের তালিকা দেয় (প্লে করে না)
- youtube_pause {} — চলমান ইউটিউব ভিডিও থামায়
- fetch_url {"url":"https://..."} — ওয়েবপেজ/API থেকে টেক্সট আনা
- search_web {"query":"..."} — Bing/DuckDuckGo সার্চ
- find_api {"query":"আবহাওয়া","limit":4,"live":true} — দুটি মোড: live:true (ডিফল্টে এটাই চাও) কী/লগইন ছাড়া এখান থেকেই কল-যোগ্য এন্ডপয়েন্ট খুঁজে দেয় এবং আসল GET মেরে ✓/✗ সহ দেখায় — এই URL-গুলো সরাসরি fetch_url করলেই ডেটা পাবে, ডক পড়তে হবে না। live ছাড়া বা {"query":"...","category":"Weather","limit":8} দিলে বিল্ট-ইন public-apis ক্যাটালগ (২১৮১টি API, ৫১ ক্যাটাগরি) — কিন্তু সাবধান, ক্যাটালগের URL প্রজেক্টের ওয়েবসাইট/ডকুমেন্টেশন, callable এন্ডপয়েন্ট না, প্রায় সবগুলোতে ফ্রি অ্যাকাউন্ট করে API কী লাগে। ক্যাটালগ ক্যাটাগরি দেখতে {"categories":true}, নতুন করতে {"refresh":true}। "এই API কাজ করে না" বললে live:true দিয়ে প্রোব রান করো, ব্রাউজার বা search_web খোলার দরকার নেই
workspace ফোল্ডার: ${WORKSPACE}
ডেস্কটপের আসল পাথ: ${DESKTOP}
পাথের নিয়ম: সব জায়গায় forward slash (/) দাও — "Desktop/Nazmul" বা "C:/Users/nlnaz/OneDrive/Desktop/Nazmul"। ব্যাকস্ল্যাশ (\\) JSON-এ নষ্ট হয়ে পাথ ভেঙে দেয়, তাই দিও না। ডিলিটের পর list_dir দিয়ে যাচাই করো।
সততা: টুল "যাচাই করা হয়েছে/done" বললেই কাজ সত্যিই হয়েছে; "unverified" মানে নিশ্চিত নয় — তুমিও হুবহু সেটাই বলো, সফল দাবি বানিয়ে লিখো না।
ফাইল বানানো/সেভ: কোনো টেক্সট ফাইল ডিস্কে সেভ করার কাজ হলে সরাসরি write_file ব্যবহার করো — ওটি লিখে ফিরে পড়ে "(যাচাই করা হয়েছে)" বলে দেয়। নোটপ্যাড/এডিটর খুলে টাইপ করে ctrl+s + সেভ-ডায়ালগে নাম লেখে Enter চাপার চক্র একেবারেই করো না; ওই পথে ফাইল তৈরি না হয়েও "সেভ হয়েছে" দাবি আসে। অ্যাপ খুলে দেখানোর নির্দেশ আর ফাইল সেভ করার নির্দেশ একসাথে থাকলে write_file-ই সেভের ধাপ, অ্যাপটি শুধু খুলে দাও।`;

const MAX_OUT = 12_000;

function clip(text, max = MAX_OUT) {
  const s = String(text ?? '');
  return s.length > max ? `${s.slice(0, max)}\n…[${s.length - max} অক্ষর বাদ]` : s;
}

function resolvePath(input) {
  let raw = String(input || '.').trim() || '.';
  raw = raw.replace(/^["']+|["']+$/g, '');
  let abs;
  const friendly = raw.match(/^~?[\\/]?(desktop|ডেস্কটপ)(?:[\\/](.*))?$/i);
  if (!path.isAbsolute(raw) && friendly) {
    abs = path.join(DESKTOP, friendly[2] || '');
  } else if (!path.isAbsolute(raw) && /^~[\\/]/.test(raw)) {
    abs = path.join(os.homedir(), raw.replace(/^~[\\/]/, ''));
  } else {
    if (!path.isAbsolute(raw)) {
      raw = raw.replace(/^\.?[\\/]/, '').replace(/^workspace[\\/]/i, '');
    }
    abs = path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(WORKSPACE, raw);
  }
  const inside = abs === WORKSPACE || abs.startsWith(WORKSPACE + path.sep);
  return { abs, inside };
}

const PROTECTED_DIRS = [
  WORKSPACE,
  PROJECT_ROOT,
  os.homedir(),
  path.dirname(os.homedir()),
  DESKTOP,
  path.dirname(DESKTOP),
  process.env.SystemRoot,
  process.env.ProgramFiles,
  process.env['ProgramFiles(x86)'],
  process.env.APPDATA,
  process.env.LOCALAPPDATA
]
  .filter(Boolean)
  .map((p) => path.resolve(p).replace(/[\\/]+$/, '').toLowerCase());

function trimSep(p) {
  return p.replace(/[\\/]+$/, '');
}

function isProtected(abs) {
  const target = trimSep(path.resolve(abs)).toLowerCase();
  if (PROTECTED_DIRS.includes(target)) return true;
  const root = trimSep(path.parse(abs).root).toLowerCase();
  return target === root;
}

function deleteTarget(rawPath) {
  const clean = String(rawPath || '').trim().replace(/^["']+|["']+$/g, '');
  if (!clean) throw new AgentError('path খালি — কোন ফাইল/ফোল্ডার মুছবে বলো', 'ARGS');
  const { abs } = resolvePath(clean);
  if (isProtected(abs)) throw new AgentError(`নিরাপত্তার জন্য এটি মুছে ফেলা যাবে না: ${abs}`, 'PROTECTED');
  if (!fs.existsSync(abs)) throw new AgentError(`নেই: ${abs}`, 'NOTFOUND');
  const st = fs.lstatSync(abs);
  const childCount = st.isDirectory() ? fs.readdirSync(abs).length : 0;
  fs.rmSync(abs, { recursive: true, force: true, maxRetries: 3 });
  if (fs.existsSync(abs)) throw new AgentError(`মুছে যায়নি (ব্রাউজার/অ্যাপ ব্যস্ত): ${abs}`, 'BUSY');
  return {
    ok: true,
    output: `মুছে ফেলা হয়েছে: ${abs}${st.isDirectory() ? ` (ভেতরের ${childCount} আইটেমসহ)` : ` (${st.size} B)`}`
  };
}

const SHELL_DELETE = /\b(rmdir|rd|del|erase|remove-item|rm)\b/i;

// cmd.exe / PowerShell quoting eats Windows paths, so shell deletes are rerouted to fs.
function shellDeletePath(command) {
  if (!SHELL_DELETE.test(command)) return null;
  const chunks = command.match(/"[^"]*"|'[^']*'|[^\s]+/g) || [];
  let best = null;
  const consider = (raw) => {
    if (!raw || /\*|\?/.test(raw)) return;
    const match = raw.match(/[A-Za-z]:[\\/][^\s'"]+/);
    if (match) best = match[0];
  };
  for (const chunk of chunks) {
    const quoted = chunk.startsWith('"') || chunk.startsWith("'");
    const raw = quoted ? chunk.slice(1, -1) : chunk;
    if (quoted) consider(raw); // inner paths inside e.g. powershell -Command "..."
    consider(raw); // the chunk itself when it is a bare path
  }
  return best;
}

export async function windowList() {
  const r = await runCommand(
    `powershell -NoProfile -ExecutionPolicy Bypass -File "${PS1}" -Action list`,
    null,
    120_000
  );
  try {
    const parsed = JSON.parse(r.out.trim());
    const arr = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    return arr
      .map((w) => ({ name: String(w.ProcessName || ''), title: String(w.MainWindowTitle || '') }))
      .filter((w) => w.title);
  } catch {
    return [];
  }
}

const UPDATEABLE_EXT = new Set(['.js', '.mjs', '.json', '.css', '.html']);
const BLOCKED_UPDATE = new Set(['tasks.json', 'access.json', 'server.log', 'updates.log', 'last-media.json']);

function updateTarget(rawFile) {
  const rel = String(rawFile || '').trim().replace(/^["']+|["']+$/g, '');
  if (!rel) throw new AgentError('file খালি — কোন ফাইল আপডেট করবে বলো', 'ARGS');
  const abs = path.resolve(ROOT, rel);
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) {
    throw new AgentError('প্রজেক্টের বাইরের ফাইল লেখা যাবে না', 'PROTECTED');
  }
  const base = path.basename(abs).toLowerCase();
  if (BLOCKED_UPDATE.has(base)) throw new AgentError(`এই ফাইল এডিট করা নিষেধ: ${base}`, 'PROTECTED');
  const ext = path.extname(abs).toLowerCase();
  if (!UPDATEABLE_EXT.has(ext)) throw new AgentError(`এই ধরনের ফাইল এডিট করা যায় না: ${ext || '(নেই)'}`, 'TYPE');
  return { abs, rel, ext };
}

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

export function htmlToText(html) {
  let s = String(html || '');
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  s = s.replace(/<svg[\s\S]*?<\/svg>/gi, ' ');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  return s.replace(/[ \t\f\v]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
}

async function httpGet(url, { as = 'text', timeoutMs = 25_000 } = {}) {
  if (!/^https?:\/\//i.test(String(url))) throw new AgentError('শুধু http/https URL চলবে', 'URL');
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'accept-language': 'bn,en;q=0.8'
    }
  });
  const body = await res.text();
  return { status: res.status, contentType: res.headers.get('content-type') || '', body, as };
}

function runCommand(command, cwd, timeoutMs = 60_000) {
  const workdir = resolvePath(cwd || '.').abs;
  if (!fs.existsSync(workdir)) throw new AgentError(`cwd নেই: ${workdir}`, 'CWD');
  return new Promise((resolve) => {
    const child = spawn('cmd.exe', ['/d', '/s', '/c', command], {
      cwd: workdir,
      windowsHide: true,
      // Without this, Node's argv quoting mangles quotes inside the command:
      // PowerShell then echoes the text instead of running it and exits 0,
      // which made broken commands look successful.
      windowsVerbatimArguments: true,
      env: process.env
    });
    let out = '';
    let err = '';
    let done = false;
    const finish = (code, timedOut) => {
      if (done) return;
      done = true;
      resolve({ code, timedOut, out: clip(out), err: clip(err) });
    };
    const timer = setTimeout(() => {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
      finish(null, true);
    }, Math.min(Number(timeoutMs) || 60_000, 300_000));
    child.stdout.on('data', (d) => {
      out += d.toString();
      if (out.length > 200_000) out = out.slice(-200_000);
    });
    child.stderr.on('data', (d) => {
      err += d.toString();
      if (err.length > 50_000) err = err.slice(-50_000);
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      err += e.message;
      finish(-1, false);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      finish(code, false);
    });
  });
}

// এই সার্ভার-প্রসেস থেকে explorer.exe / rundll32.exe স্পন করলে Windows 'spawn EPERM'
// দেয় (কনসোল চাইল্ড cmd/powershell ঠিক চলে)। কিন্তু cmd-এর 'start' ওই GUI অ্যাপটি
// সত্যিই তুলে দেয় — শুধু নিজে এক্সিট না করে ব্লক করে, তাই সেটিকে কখনোই wait
// করানো যাবে না (৬০s টাইমআউটে ভুঁয়ো 'ব্যর্থ' রিপোর্ট আসত, উইন্ডো তখন খুলছিল)।
function trySpawn(file, args, opts = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (err) => {
      if (settled) return;
      settled = true;
      resolve(err ? String(err.message || err) : null);
    };
    try {
      const child = spawn(file, args, { detached: true, stdio: 'ignore', ...opts });
      // 'error' ইভেন্টে লিসেনার না দিলে অ্যাকাশন Exception সার্ভারই মেরে ফেলত
      child.on('error', done);
      child.on('spawn', () => done(null));
      child.unref();
      setTimeout(() => done(null), 2000);
    } catch (e) {
      done(e);
    }
  });
}

function shellStart(what) {
  // fire-and-forget: 'start' নিজে এক্সিট করে না যতক্ষণ GUI উইন্ডো বেঁচে থাকে
  return trySpawn('cmd.exe', ['/d', '/s', '/c', `start "" "${what}"`], {
    windowsHide: true,
    windowsVerbatimArguments: true,
    cwd: PROJECT_ROOT
  });
}

// শেষ অস্ত্র — PowerShell-এর Start-Process (ShellExecute), আগের দুটো না চললে
async function startProcessFallback(what) {
  const ps = await runCommand(
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process '${String(what).replace(/'/g, "''")}'"`,
    PROJECT_ROOT,
    45_000
  );
  return ps.code === 0;
}

async function launchGuiTarget(target) {
  const viaExplorer = await trySpawn('explorer.exe', [target]);
  if (!viaExplorer) return { ok: true, how: 'explorer' };
  const viaCmd = await shellStart(target);
  if (!viaCmd) return { ok: true, how: 'cmd-start' };
  return { ok: false, how: 'explorer+cmd threw', why: `${viaExplorer} | ${viaCmd}` };
}

async function launchGuiUrl(url) {
  const viaDll = await trySpawn('rundll32.exe', ['url.dll,FileProtocolHandler', url]);
  if (!viaDll) return { ok: true, how: 'rundll32' };
  const viaCmd = await shellStart(url);
  if (!viaCmd) return { ok: true, how: 'cmd-start' };
  return { ok: false, how: 'rundll32+cmd threw', why: `${viaDll} | ${viaCmd}` };
}

async function searchBing(query) {
  const { body } = await httpGet(`https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=bn`);
  const results = [];
  const blocks = body.split(/<li class="b_algo"/i).slice(1, 9);
  for (const block of blocks) {
    const title = block.match(/<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!title) continue;
    const snippet = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    let link = decodeEntities(title[1]);
    const redirect = link.match(/[?&]u=a1([^&]+)/);
    if (redirect) {
      try {
        link = Buffer.from(redirect[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
      } catch {
        /* keep bing link */
      }
    }
    results.push({
      url: link,
      title: htmlToText(title[2]),
      snippet: snippet ? htmlToText(snippet[1]) : ''
    });
  }
  return results;
}

async function searchDdg(query) {
  const { body } = await httpGet(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`);
  const results = [];
  const blocks = body.split(/class="result results_links[^"]*"/i).slice(1, 9);
  for (const block of blocks) {
    const link = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const snippet = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i);
    let url = decodeEntities(link[1]);
    const redirect = url.match(/uddg=([^&]+)/);
    if (redirect) url = decodeURIComponent(redirect[1]);
    results.push({
      url,
      title: htmlToText(link[2]),
      snippet: snippet ? htmlToText(snippet[1]) : ''
    });
  }
  return results;
}

const TOOL_NAMES = new Set([
  'list_dir',
  'make_dir',
  'read_file',
  'write_file',
  'delete_path',
  'run_command',
  'open_url',
  'open_path',
  'youtube_play',
  'youtube_search',
  'youtube_pause',
  'fetch_url',
  'search_web',
  'find_api',
  'window_list',
  'window_focus',
  'screen_capture',
  'see_screen',
  'mouse_control',
  'type_text',
  'press_keys',
  'resolve',
  'phone_list',
  'phone_control',
  'phone_screen',
  'learn_lesson',
  'self_update',
  'restart_self',
  'browser_screenshot'
]);

export function normalizeTool(name) {
  const raw = String(name || '').trim().toLowerCase().replace(/[\s:]+/g, '_');
  if (TOOL_NAMES.has(raw)) return raw;
  if (/youtube|music|গান|video/.test(raw)) {
    if (/pause|stop|থাম/.test(raw)) return 'youtube_pause';
    if (/search|খোঁজ/.test(raw)) return 'youtube_search';
    if (/play|চাল|বাজ/.test(raw)) return 'youtube_play';
  }
  if (/^(delete|remove|erase|trash|ডিলিট|মুছু|মুছে)[_:-]?(path|file|folder|dir|directory)?$/.test(raw)) return 'delete_path';
  if (/api/.test(raw) && /(find|search|list|get|public|catalog|know|খুঁজ|তালিকা)/.test(raw)) return 'find_api';
  if (/^(mouse|cursor)[_-]?(move|click|double|right|drag|scroll|pos|position|control)?$/.test(raw)) return 'mouse_control';
  if (/^(window|app|win)[_-]?(focus|front|activate|raise|bring|samne|সামনে)$/.test(raw)) return 'window_focus';
  if (/^(type|keyboard|write)[_-]?(text|chars|characters)?$/.test(raw)) return 'type_text';
  if (/^(press|tap|hot)[_-]?keys?$/.test(raw)) return 'press_keys';
  if (/^(resolve|davinci|রিজলভ|ডাবিনচি)/.test(raw)) return 'resolve';
  if (/^(phone|mobile|handset|ফোন)[_-]?(control|cmd|command|action)?$/.test(raw)) return 'phone_control';
  if (/^(phone|mobile)[_-]?(screen|view|see|dekh)$/.test(raw)) return 'phone_screen';
  if (/^(phone|mobile|device)[_-]?(list|all|know|kaun)$/.test(raw)) return 'phone_list';
  return raw;
}

export async function captureScreenFile() {
  const dir = path.join(WORKSPACE, 'shots');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `screen-${Date.now()}.png`);
  const r = await runCommand(
    `powershell -NoProfile -ExecutionPolicy Bypass -File "${PS1}" -Action shot -Path "${file}"`,
    null,
    180_000
  );
  if (r.code !== 0 || !fs.existsSync(file)) {
    throw new AgentError(
      `স্ক্রিনশট ব্যর্থ: ${clip(r.err || r.out) || 'কিছু ফেরত আসেনি'} — এই পিসিতে ঠান্ডা PowerShell উঠতে ১-২ মিনিট লাগে, ` +
        'ধাপটি একবার মাত্র আবার চালাও; বার বার চেষ্টা করে কাজ থামিও না',
      'FAILED'
    );
  }
  pruneShots(dir);
  return { file, size: fs.statSync(file).size };
}

// ইউজার "দেখাও" মোডে যে অংশটুকু ঘেরেছে শুধু সেটাই তোলে — সংযুক্তি হিসেবে uploads-এ বসে
export async function captureCropFile({ x, y, w, h } = {}) {
  const rect = [x, y, w, h].map((n) => Math.round(Number(n) || 0));
  if (rect.slice(0, 2).some((n) => n < 0) || rect[2] < 8 || rect[3] < 8) {
    throw new AgentError('স্ক্রিনের অংশটুকু বোঝা যায়নি', 'ARGS');
  }
  const dir = path.join(WORKSPACE, 'uploads');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `show-${Date.now()}.png`);
  const r = await runCommand(
    `powershell -NoProfile -ExecutionPolicy Bypass -File "${PS1}" -Action shot:crop -Path "${file}" -Arg1 "${rect.join(',')}"`,
    null,
    180_000
  );
  if (r.code !== 0 || !fs.existsSync(file)) {
    throw new AgentError(`অংশ তোলা যায়নি: ${clip(r.err || r.out)}`, 'FAILED');
  }
  try {
    const old = fs
      .readdirSync(dir)
      .filter((f) => /^show-\d+\.png$/i.test(f))
      .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const gone of old.slice(12)) fs.unlinkSync(path.join(dir, gone.f));
  } catch {
    /* পুরনো ক্রপ মুছতে না পারলে পরেরবার চেষ্টা হবে */
  }
  return { file, rect, size: fs.statSync(file).size, origin: cropOrigin(r.out) };
}

// win_tools.ps1 বলে: saved|<path>|<originX>,<originY> — ভার্চুয়াল-স্ক্রিনের উপর-বাম কোণ
function cropOrigin(out) {
  const m = /saved\|[^|]*\|(-?\d+),(-?\d+)/.exec(String(out || ''));
  return m ? [Number(m[1]), Number(m[2])] : [0, 0];
}

// একটাই পিকার একসাথে — দুটো ওভারলে একসঙ্গে উঠলে ইউজার কোনটাতে ঘেরবে বুঝতে পারে না
let pickFlight = null;

// স্ক্রিনের উপর হাতে ঘেরা অংশ / ক্লিক করা উইন্ডো (স্নিপিং টুলের মতো পুরো স্ক্রিন জুড়ে ওভারলে)
export function pickScreen({ mode = 'region', secs = 45 } = {}) {
  if (pickFlight) return pickFlight;
  const kind = ['region', 'point', 'window'].includes(mode) ? mode : 'region';
  const limit = Math.min(120, Math.max(5, Number(secs) || 45));
  pickFlight = (async () => {
    const r = await runCommand(
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${PS1}" -Action pick -Arg1 "${kind}" -Arg2 "${limit}"`,
      '.',
      (limit + 15) * 1000
    );
    const out = String(r.out || '');
    const org = /origin\|(-?\d+),(-?\d+)/.exec(out);
    const base = org ? [Number(org[1]), Number(org[2])] : [0, 0];
    const line = /^(rect|win|point|cancel)\|(.*)$/m.exec(out);
    if (!line) {
      throw new AgentError(`সিলেক্ট ওভারলে চালু হয়নি: ${clip(r.err || out)}`, 'FAILED');
    }
    if (line[1] === 'cancel') return { ok: false, cancelled: true, reason: line[2].split('|')[0] };
    if (line[1] === 'point') {
      const [x, y] = line[2].split(',').map((n) => Math.round(Number(n) || 0));
      return { ok: true, kind: 'point', point: [x, y], abs: [x + base[0], y + base[1]], origin: base };
    }
    const head = line[2].split('|')[0];
    const p = head.split(',').map((n) => Math.round(Number(n) || 0));
    const rect = [p[0] || 0, p[1] || 0, p[2] || 0, p[3] || 0];
    if (rect[2] < 8 || rect[3] < 8) throw new AgentError('যে অংশটা ঘেরা হয়েছে সেটা খুব ছোট', 'ARGS');
    return {
      ok: true,
      kind: line[1] === 'win' ? 'window' : 'region',
      rect,
      abs: [rect[0] + base[0], rect[1] + base[1], rect[2], rect[3]],
      origin: base,
      title: line[1] === 'win' ? line[2].slice(head.length + 1).trim() : ''
    };
  })().finally(() => {
    pickFlight = null;
  });
  return pickFlight;
}

// ছবি জমিয়ে রাখা হয় না — দরকারি কয়েকটা ছাড়া বাকিগুলো মুছে যায়
function pruneShots(dir, keep = 6) {
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => /^screen-.*\.png$/i.test(f))
      .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const old of files.slice(keep)) {
      try {
        fs.unlinkSync(path.join(dir, old.f));
      } catch {
        /* মুছতে না পারলে পরেরবার চেষ্টা হবে */
      }
    }
  } catch {
    /* shots ফোল্ডার না থাকলে কিছু করার নেই */
  }
}

// Cold powershell.exe on this laptop spends minutes compiling the Win32 helper assembly,
// so the old 60 s ceiling killed real successes (window_focus) and reported "no output".
async function psRun(action, { arg1 = '', arg2 = '', file = '', timeoutMs = 200_000 } = {}) {
  const r = await runCommand(
    `powershell -NoProfile -ExecutionPolicy Bypass -File "${PS1}" -Action ${action} -Arg1 "${arg1}" -Arg2 "${arg2}"` +
      (file ? ` -Path "${file}"` : ''),
    null,
    timeoutMs
  );
  const text = `${r.out}${r.err}`.trim();
  const line = text.split(/\r?\n/).find((l) => /^(ok|fail)\b/.test(l.trim())) || text;
  if (!/^ok\b/.test(String(line).trim()) || r.code !== 0) {
    const why = text
      ? clip(String(line), 200)
      : 'PowerShell কিছুই ফেরত দেয়নি — এই পিসিতে প্রথম চালাতে কম্পাইলে ৬০-১২০ সেকেন্ড লাগে, তাই ধাপটি একবার মাত্র আবার চালাও (দ্বিতীয়বার cache-এর জন্য দ্রুত হয়), তৃতীয়বার চেষ্টা বা window_list ঘুরে বেড়িও না';
    throw new AgentError(why, 'FAILED');
  }
  return String(line).trim();
}

// resolve/actshot-ই ছবি তুলে দেয় (ফোকাস তখনও Resolve-এ) — চোখ আবার স্ক্রিন তুললে
// Qoder সামনে এসে ভুল ছবি দেখার ঝুঁকি, তাই পরের eyeVerify এই ফাইলটাই ব্যবহার করে
let pendingShot = '';
export function takePendingShot() {
  const f = pendingShot;
  pendingShot = '';
  return f;
}

function parsePoint(value) {
  const parts = String(value || '').split(/[, ]+/).filter(Boolean).map(Number);
  if (parts.length < 2 || parts.some((n) => !Number.isFinite(n))) {
    throw new AgentError('পজিশন "x,y" ফরম্যাটে দাও, যেমন "820,460"', 'ARGS');
  }
  return `${parts[0]},${parts[1]}`;
}

// মডেল প্রায়ই {"position":"0,0"} প্লেসহোল্ডার পাঠায় আর আসল ঠিকানা বসায়
// {"x":732,"y":817} এ — সেক্ষেত্রে 0,0 (স্ক্রিনের উপর-বাম কোণ) এ ক্লিক হচ্ছিল।
function pickPoint(args) {
  const xy =
    Number.isFinite(Number(args.x)) && Number.isFinite(Number(args.y)) && (Number(args.x) !== 0 || Number(args.y) !== 0)
      ? `${Number(args.x)},${Number(args.y)}`
      : null;
  const pos = args.position ? parsePoint(args.position) : null;
  if (pos === '0,0' && xy) return xy;
  const point = pos || xy;
  if (!point) throw new AgentError('position ("x,y") বা x,y দুটোর একটি দাও — আগে see_screen দিয়ে ঠিকানা দেখো', 'ARGS');
  return point;
}

// অ্যাপের নাম থেকে ইনস্টল করা আসল ঠিকানা (Start Menu শর্টকাট / PATH / UWP AppsFolder)
// Start Menu-র শর্টকাটের নাম ইংরেজি ("Visual Studio Code"), বট বাংলায় বলে ("ভিসি কোড") —
// মিল না চললে open_path "পাথ নেই" বলে ফেলে, তাই বাংলা নাম → ইনস্টল করা ইংরেজি নামের মিল এখানে।
// \b বাংলা শব্দের সঙ্গে কাজ করে না, তাই সব মিল সংকুচিত (স্পেসবিহীন) লেখায় হয়।
const APP_NAME_ALIAS = [
  [/ভিসি|ভিএস|ভিসিকোড|ভিসুয়াল|^কোড$/, 'visual studio code'],
  [/নোটপে|নোটপ্যা|নোটপ্যাড|নোটপেড/, 'notepad'],
  [/ক্রোম|করোম|গুগলক্রোম/, 'chrome'],
  [/ফায়ারফক্স|ফায়ারফক্স/, 'firefox'],
  [/ভিএলসি/, 'vlc'],
  [/স্পট[িী]ফাই|স্পট[িী]ফ/, 'spotify'],
  [/ডাভি|ডাভিন|ডাভিঞ্চ/, 'davinci'],
  [/প্রিম[িী]য়ার|প্রিমিয়ার/, 'premiere'],
  [/ফটোশপ|ফটোশপ|photoshop/, 'photoshop'],
  [/অ্যাফটার|এফটার|ইফেক্ট/, 'after effects'],
  [/ওবএস|ওবস/, 'obs'],
  [/এক্সেল/, 'excel'],
  [/ওয়ার্ড/, 'word'],
  [/পাওয়ারপ[ইী]এন্ট|পাওয়ারপইন্ট/, 'powerpoint'],
  [/টাস্কম[্য]ানেজ|টাস্কম্যানেজ/, 'task manager'],
  [/সেটিং[সা]|সেটিংস/, 'settings'],
  [/ক্যালকুলেট|ক্যালক/, 'calculator'],
  [/এক্সপ্লোর|ফাইলএক্সপ্লোর/, 'explorer'],
  [/পাওয়ারশেল|পাওয়ারশে/, 'powershell'],
  [/ডিসকর্ড|ডিসকোর/, 'discord'],
  [/টেলিগ্রাম/, 'telegram'],
  [/হোয়াটসঅ্যাপ|হোয়াটসঅ্যাপ/, 'whatsapp'],
  [/স্টিম/, 'steam'],
  [/স্নিপিং|ছবিকাট/, 'snipping'],
  [/মিডিয়াপ্লেয়ার/, 'media player']
];
// বাংলা নাম থেকে ইনস্টল করা অ্যাপের মাপকাঠি-শব্দ (ইংরেজি নাম হলে সেটিই ফেরে)
export function latinAppName(term) {
  const squeezed = String(term || '').replace(/\s+/g, '');
  for (const [re, latin] of APP_NAME_ALIAS) {
    if (re.test(squeezed) || re.test(String(term || ''))) return latin;
  }
  return String(term || '');
}

async function findApp(term) {
  // ইংরেজি মিল প্রথমে, না পেলে মূল নাম — দুটোই চালানো হয় কারণ Start Menu-তে
  // "Visual Studio Code" আছে কিন্তু "ভিসি কোড" নেই, আবার UWP/স্থানীয় নাম উল্টোটাও হতে পারে
  const tries = [...new Set([latinAppName(term), term].filter((t) => String(t || '').trim().length >= 2))];
  for (const q of tries) {
    const hits = await appFindOnce(q);
    if (hits.length) return hits;
  }
  return [];
}

async function appFindOnce(term) {
  let line = '';
  try {
    line = await psRun('app:find', { arg1: term });
  } catch {
    return [];
  }
  const hits = line
    .replace(/^ok\s*/, '')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
  // .exe আগে, লঞ্চর-ফোল্ডারের shim (bin\code.cmd) পরে
  const exe = hits.filter((h) => /\.exe$/i.test(h));
  const rest = hits.filter((h) => !/\.exe$/i.test(h));
  const clean = exe.filter((h) => !/[\\/]bin[\\/]/i.test(h));
  return [...clean, ...exe.filter((h) => /[\\/]bin[\\/]/i.test(h)), ...rest];
}

export async function executeTool(call, ctx) {
  const tool = normalizeTool(call?.tool);
  let args = call?.args;
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args);
    } catch {
      args = {};
    }
  }
  args = args && typeof args === 'object' ? args : {};

  switch (tool) {
    case 'list_dir': {
      const { abs } = resolvePath(args.path);
      if (!fs.existsSync(abs)) throw new AgentError(`ফোল্ডার নেই: ${abs}`, 'NOTFOUND');
      const entries = fs
        .readdirSync(abs, { withFileTypes: true })
        .slice(0, 200)
        .map((e) => {
          const full = path.join(abs, e.name);
          let size = null;
          try {
            size = fs.statSync(full).size;
          } catch {
            /* protected or vanished entry */
          }
          return `${e.isDirectory() ? '[D]' : '[F]'} ${e.name}${e.isFile() && size != null ? ` (${size} B)` : ''}`;
        });
      return { ok: true, output: clip(`${abs}\n${entries.join('\n') || '(খালি)'}`) };
    }
    case 'make_dir': {
      const { abs } = resolvePath(args.path);
      fs.mkdirSync(abs, { recursive: true });
      if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
        throw new AgentError(`তৈরি হয়েছে কিনা যাচাই করা যায়নি: ${abs}`, 'FAILED');
      }
      return { ok: true, output: `ফোল্ডার তৈরি হয়েছে (যাচাই করা হয়েছে): ${abs}` };
    }
    case 'delete_path': {
      const rawPath = String(args.path ?? args.target ?? args.name ?? '');
      return deleteTarget(rawPath);
    }
    case 'read_file': {
      const { abs, inside } = resolvePath(args.path);
      if (!fs.existsSync(abs)) throw new AgentError(`ফাইল নেই: ${abs}`, 'NOTFOUND');
      const st = fs.statSync(abs);
      if (!st.isFile()) throw new AgentError('এটি ফাইল নয়', 'TYPE');
      if (st.size > 2_000_000) throw new AgentError('ফাইল বড় (2MB+)', 'BIG');
      const text = fs.readFileSync(abs, 'utf8');
      return { ok: true, output: clip(`${inside ? '' : `[workspace-এর বাইরে] `}${abs}\n\n${text}`) };
    }
    case 'write_file': {
      const { abs } = resolvePath(args.path);
      const content =
        args.content && typeof args.content === 'object'
          ? JSON.stringify(args.content, null, 2)
          : String(args.content ?? '');
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, 'utf8');
      if (!fs.existsSync(abs) || fs.statSync(abs).size !== Buffer.byteLength(content)) {
        throw new AgentError(`লেখা হয়েছে কিনা যাচাই করা যায়নি: ${abs}`, 'FAILED');
      }
      return { ok: true, output: `লেখা হয়েছে (যাচাই করা হয়েছে): ${abs} (${Buffer.byteLength(content)} B)` };
    }
    case 'run_command': {
      const command = String(args.command || '');
      const delPath = shellDeletePath(command);
      if (delPath) {
        // Destructive shell commands are rerouted to the fs deleter so cmd
        // quoting can never corrupt the path (Mark-LVI verified-result rule).
        return deleteTarget(delPath);
      }
      const r = await runCommand(command, args.cwd, args.timeoutMs);
      if (r.timedOut) {
        // start/notepad/chrome ধরনের লঞ্চ কমান্ড GUI অ্যাপ বন্ধ হওয়া পর্যন্ত বসে থাকে —
        // ওই ৬০ সেকেন্ডের অপেক্ষা পুরোটাই নষ্ট (অ্যাপ খোলার জন্য open_path/open_url আছে)
        throw new AgentError(
          `কমান্ডটি শেষ হওয়ার অপেক্ষায় সময় শেষ: ${command}\n` +
            `যেটুকু আউটপুট এসেছে: ${clip(`${r.out}${r.err ? `\n[stderr]\n${r.err}` : ''}`, 600) || '(কিছুই না)'}\n` +
            'অ্যাপ/সাইট খোলার জন্য run_command চলবে না — open_path {"path":"অ্যাপের নাম"} বা open_url ব্যবহার করো (ওগুলো নিজেই উইন্ডো দেখে যাচাই করে দেয়)।',
          'TIMEOUT'
        );
      }
      const head = `exit=${r.code}`;
      const output = clip(`${head}\n${r.out}${r.err ? `\n[stderr]\n${r.err}` : ''}`);
      return { ok: r.code === 0 && !r.timedOut, output };
    }
    case 'open_url': {
      const url = String(args.url || '');
      if (!/^https?:\/\//i.test(url)) throw new AgentError('শুধু http/https URL চলবে', 'URL');
      const opened = await launchGuiUrl(url);
      if (!opened.ok) throw new AgentError(`সাইট খোলা যায়নি (${opened.why}) — ব্রাউজার বন্ধ কি না দেখো, অথবা URL বদলে একটিবার চেষ্টা করো`, 'LAUNCH');
      // ব্রাউজারের উইন্ডো-শিরোনামে সাইটের নাম আসে — নিজেই ৩ বার তাকিয়ে ফলাফল বলে দিই।
      // আগে এখানে "(unverified)" লেখা আসত, বস সেটা দেখে বার বার নতুন যাচাই চাইত,
      // আর একই সাইট বার বার খুলে ইউজার ঘণ্টা বসে থাকত।
      const hint = String(url.replace(/^https?:\/\/(www\.)?/i, '').split(/[/?#]/)[0]).split('.')[0].toLowerCase();
      for (let i = 0; i < 3; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        const wins = await windowList();
        const hit = wins.find((w) => hint.length > 2 && String(w.title || '').toLowerCase().includes(hint));
        if (hit) return { ok: true, output: `খোলা হয়েছে (যাচাই: "${hit.title}" উইন্ডো দেখা যাচ্ছে): ${url}` };
      }
      return {
        ok: true,
        output: `খোলার কমান্ড পাঠানো হয়েছে: ${url} — ব্রাউজার এখন লোড হচ্ছে, সিস্টেম নিজেই স্ক্রিন দেখে জানাবে। window_list/see_screen চালিয়ে আলাদা করে প্রমাণ সংগ্রহ করো না।`
      };
    }
    case 'open_path': {
      let target = resolvePath(args.path).abs;
      let hintWord = '';
      if (!fs.existsSync(target)) {
        // মডেল ইনস্টল করা ঠিকানা অনুমান করে ভুল করে ("C:\Program Files\Microsoft VS Code" —
        // আসলে LocalAppData-তে আছে)। Start Menu/PATH/UWP থেকে সঠিক ঠিকানা নিজেই বের করা হয়।
        const stem = path.basename(target).replace(/\.(exe|lnk|bat|cmd)$/i, '') || String(args.path).trim();
        // উইন্ডো-শিরোনাম ইংরেজিতে থাকে — বাংলা নাম দিয়ে মিল খুঁজলে কখনোই মিলবে না
        hintWord = latinAppName(stem);
        const hits = await findApp(stem);
        if (hits.length === 1) {
          target = hits[0];
        } else if (hits.length > 1) {
          throw new AgentError(
            `পাথ নেই: ${target}\n"${stem}" নামে একাধিক অ্যাপ মিলেছে — একটি বেছে নিয়ে আবার চেষ্টা করো:\n${hits
              .slice(0, 4)
              .map((h, i) => `${i + 1}) ${h}`)
              .join('\n')}`,
            'NOTFOUND'
          );
        } else {
          throw new AgentError(
            `পাথ নেই: ${target} — "${stem}" নামে ইনস্টল করা কোনো অ্যাপ/ফাইল Start Menu বা PATH-এ পাওয়া যায়নি। ` +
              'ভুল পথে বার বার চেষ্টা করো না; টার্গেটের নাম/পাথ ঠিক করে একটিবার নতুন করে চেষ্টা করো, ' +
              'নতুন ফাইল বানাতে হলে write_file ব্যবহার করো, আর কিছু না বুঝলে ইউজারকে জিজ্ঞেস করো। দেখার টুল (window_list/see_screen) দিয়ে চক্র বানাও না।',
            'NOTFOUND'
          );
        }
      }
      const fromAppFolder = target.startsWith('appsfolder:');
      const ext = path.extname(target).toLowerCase();
      const isExec = fromAppFolder || ['.exe', '.bat', '.cmd', '.msi', '.lnk', '.com'].includes(ext);
      const before = await windowList();
      const opened = fromAppFolder
        ? await launchGuiTarget(`shell:AppsFolder\\${target.slice('appsfolder:'.length)}`)
        : await launchGuiTarget(target);
      if (!opened.ok) {
        throw new AgentError(
          `খোলা যায়নি: ${target} (${opened.why}) — একই পাথে বার বার চেষ্টা করো না; ` +
            'প্রথমে window_list দিয়ে দেখো অ্যাপটি ইতিমধ্যে চলছে কি না, চললে সেটাই ব্যবহার করো।',
          'LAUNCH'
        );
      }
      // অ্যাপ-নাম দিয়ে ঠিকানা বের করলে (বা AppsFolder হলে) শিরোনাম সেই নামেই মিলবে
      const nameHint = String(hintWord || path.basename(target)).toLowerCase();
      // খোলা হয়েছে কি না নিজেই দেখে নেওয়া হয় — "(unverified)" লেখা বসের নতুন চক্র ডাকে
      for (let i = 0; i < 9; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 900));
        const after = await windowList();
        const same = after.find((w) => nameHint.length > 2 && String(w.title || '').toLowerCase().includes(nameHint));
        if (same) {
          return { ok: true, output: `খোলা হয়েছে (যাচাই: "${same.title}" উইন্ডো দেখা যাচ্ছে): ${target}` };
        }
        const fresh = after.find((w) => !before.some((b) => b.title === w.title));
        if (fresh && i >= 1) {
          return { ok: true, output: `খোলা হয়েছে (যাচাই: নতুন উইন্ডো "${fresh.title}"): ${target}` };
        }
        if (!isExec && i >= 4) break;
      }
      // এই PC-তে ভারী অ্যাপ (DaVinci Resolve) ২-৩ মিনিটে ওঠে — তাই প্রথম লুপে উইন্ডো
      // না দেখলে শেষবার PowerShell-এর Start-Process দিয়ে আবার কিছুক্ষণ তাকানো হয়
      await startProcessFallback(target);
      for (let i = 0; i < 5; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const after = await windowList();
        const same = after.find((w) => nameHint.length > 2 && String(w.title || '').toLowerCase().includes(nameHint));
        if (same) {
          return { ok: true, output: `খোলা হয়েছে (যাচাই: "${same.title}" উইন্ডো দেখা যাচ্ছে): ${target}` };
        }
      }
      // উইন্ডো দেখা যায়নি — সফল দাবি না করে সত্যি বলা হয়, যাতে চোখ/বস ধরা পড়ে
      return {
        ok: true,
        output: `কমান্ড পাঠানো হয়েছে কিন্তু "${nameHint}" নামে কোনো উইন্ডো দেখা যায়নি: ${target} — অ্যাপটি ধীর পিসিতে এখনও ওঠার পথে থাকতে পারে, ` +
          ' তাই ৩০-৬০ সেকেন্ড পর পর window_list দিয়ে ৩-৪ বার দেখো (আবার open_path চালাও না), না মিললে final:true-এ সত্যি বলো'
      };
    }
    case 'window_list': {
      const windows = await windowList();
      const text = windows.map((w) => `${w.name} — ${w.title}`).join('\n') || '(কোনো খোলা উইন্ডো নেই)';
      return { ok: true, output: clip(`খোলা উইন্ডো (${windows.length}):\n${text}`) };
    }
    case 'window_focus': {
      // শিরোনামের অংশ দিয়ে উইন্ডো সামনে তোলা — ক্লিক/টাইপ/ছবি ঐ উইন্ডোতেই পড়ে
      const title = String(args.title || args.name || args.window || args.app || '').trim();
      if (title.length < 2) throw new AgentError('title দাও — উইন্ডো শিরোনামের অন্তত ২ অক্ষর, যেমন "Resolve"', 'ARGS');
      const solo = args.solo === true || /^(1|true|solo|একা|শুধু)$/i.test(String(args.solo || ''));
      let done;
      try {
        done = await psRun('win:activate', { arg1: title, arg2: solo ? 'solo' : '' });
      } catch (e) {
        throw new AgentError(
          `উইন্ডো সামনে তোলা যায়নি ("${title}"): ${e.message} — আগে window_list দিয়ে দেখো আসল শিরোনাম কী, ` +
            'আর খোলা নেই বুঝলে open_path দিয়ে খোলো; একই শিরোনাম নিয়ে বার বার চালাও না',
          'FAILED'
        );
      }
      const rest = done.replace(/^ok\s+activated\s+/i, '');
      const hid = /solo_minimized=(\d+)/.exec(rest);
      const got = rest.replace(/\s+solo_minimized=\d+/, '');
      return {
        ok: true,
        output: `সামনে তোলা হয়েছে (যাচাই: "${got}" এখন ফোকাসে${hid ? `, বাকি ${hid[1]}টি উইন্ডো মিনিমাইজ করা হয়েছে` : ''}) — ` +
          'সিস্টেম নিজেই স্ক্রিন দেখে জানাবে, আলাদা screen_capture/see_screen চালাও না; এখনকার ক্লিক/টাইপ এই উইন্ডোতেই লাগবে'
      };
    }
    case 'screen_capture': {
      const title = String(args.title || args.window || args.app || '').trim();
      if (title.length >= 2) {
        // উইন্ডো-নির্দিষ্ট ছবি: ফোকাস+ক্যাপচার এক প্রসেসে, তাই অন্য উইন্ডো মাঝে এসে ছবি নষ্ট করতে পারে না
        const file = path.join(WORKSPACE, 'shots', `win-${Date.now()}.png`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const out = await psRun('win:actshot', { arg1: title, arg2: '', file });
        return { ok: true, output: `"${title}" সামনে এনে ক্যাপচার হয়েছে (${fs.existsSync(file) ? fs.statSync(file).size : 0} B): ${file} — ${out}` };
      }
      const { file, size } = await captureScreenFile();
      return { ok: true, output: `স্ক্রিন ক্যাপচার হয়েছে (যাচাই: ${size} B): ${file}` };
    }
    case 'see_screen': {
      // Gemini-style screen share: capture the screen and let the logged-in
      // Gemini web chat actually LOOK at it, then give us its answer as text.
      if (!ctx?.account) throw new AgentError('অ্যাকাউন্ট পাওয়া যায়নি', 'ACCOUNT');
      const { file } = await captureScreenFile();
      const { lookAtImage } = await import('./lanes.js');
      const question = String(args.question || args.query || 'স্ক্রিনে যা দেখা যাচ্ছে তা বিস্তারিতভাবে বর্ণনা করো।');
      const r = await lookAtImage(`${question}\n\n(এটি আমার পিসির লাইভ স্ক্রিনশট — ছবিটি দেখে উত্তর দাও)`, file, {
        account: ctx.account,
        timeoutSec: 240
      });
      return { ok: true, output: clip(`স্ক্রিন দেখে উত্তর:\n${r.text}`) };
    }
    case 'mouse_control': {
      // আসল মাউস ইভেন্ট (Win32 SendInput) — যে উইন্ডো ফোকাসে আছে সেটায় চলে
      const action = String(args.action || 'pos').toLowerCase();
      if (action === 'pos') return { ok: true, output: await psRun('mouse:pos') };
      if (action === 'move') return { ok: true, output: await psRun('mouse:move', { arg1: pickPoint(args) }) };
      if (['click', 'double', 'right'].includes(action)) {
        return { ok: true, output: await psRun(`mouse:${action}`, { arg1: pickPoint(args) }) };
      }
      if (action === 'drag') {
        return {
          ok: true,
          output: await psRun('mouse:drag', { arg1: pickPoint(args), arg2: parsePoint(args.to) })
        };
      }
      if (action === 'scroll') {
        const amount = Number(args.amount) || -3;
        const at = args.position ? parsePoint(args.position) : '';
        return { ok: true, output: await psRun('mouse:scroll', { arg1: at, arg2: String(amount) }) };
      }
      throw new AgentError(`অচেনা অ্যাকশন "${action}" — move|click|double|right|drag|scroll|pos`, 'ARGS');
    }
    case 'type_text': {
      const text = String(args.text || '');
      if (!text.trim()) throw new AgentError('text খালি', 'ARGS');
      const tmp = path.join(WORKSPACE, 'shots', `type-${Date.now()}.txt`);
      fs.mkdirSync(path.dirname(tmp), { recursive: true });
      fs.writeFileSync(tmp, text, 'utf8');
      try {
        const out = await psRun('key:type', { arg1: `file:${tmp}` });
        return { ok: true, output: `${out} — যে উইন্ডো ফোকাসে ছিল সেখানে লেখা হয়েছে; সিস্টেম নিজেই স্ক্রিন দেখে পরের ধাপে জানাবে, তাই নিজে থেকে "দেখে নিশ্চিত" দাবি কোরো না` };
      } finally {
        fs.unlink(tmp, () => {});
      }
    }
    case 'resolve': {
      // Resolve-এর ফ্রি ভার্সনে বাইরের স্ক্রিপ্টিং API বন্ধ, তাই নিয়ন্ত্রণ হয় আসল কীবোর্ড/ক্লিকে।
      // ফোকাস + কী + স্ক্রিনশট একই PowerShell প্রসেসে (win:actshot) — মাঝপথে Qoder/অন্য উইন্ডো
      // সামনে এসে ছবি নষ্ট করতে বা কী নিজের কাছে নিয়ে যেতে পারে না।
      const action = String(args.action || 'state').toLowerCase();
      const PAGES = { media: 'shift+2', cut: 'shift+3', edit: 'shift+4', fusion: 'shift+5', color: 'shift+6', fairlight: 'shift+7', deliver: 'shift+8' };
      const KEYS = {
        play: 'space',
        pause: 'k',
        stop: 'k',
        blade: 'ctrl+b',
        ripple_delete: 'backspace',
        lift: 'delete',
        home: 'home',
        end: 'end',
        zoom_fit: 'shift+z',
        insert: 'f9',
        overwrite: 'f10',
        replace: 'f11',
        undo: 'ctrl+z',
        redo: 'ctrl+shift+z',
        save: 'ctrl+s'
      };
      if (action === 'import') {
        const file = String(args.path || '').replace(/\//g, '\\').trim();
        if (!file) throw new AgentError('import-এ path দাও — যে ফাইলটি মিডিয়া পুলে আনবে', 'ARGS');
        const shot = path.join(WORKSPACE, 'shots', `resolve-${Date.now()}.png`);
        await psRun('win:actshot', { arg1: 'DaVinci Resolve', arg2: 'ctrl+i;wait:1200', file: shot });
        const tmp = path.join(WORKSPACE, 'shots', `resolve-import-${Date.now()}.txt`);
        fs.mkdirSync(path.dirname(tmp), { recursive: true });
        fs.writeFileSync(tmp, file, 'utf8');
        try {
          await psRun('key:type', { arg1: `file:${tmp}` });
        } finally {
          fs.unlink(tmp, () => {});
        }
        await new Promise((r) => setTimeout(r, 400));
        const done = await psRun('key:press', { arg1: 'enter' });
        return { ok: true, output: `${done} — ইমপোর্ট ডায়ালগে "${file}" লিখে এন্টার; পরের resolve কলেই স্ক্রিনশটে মিডিয়া পুল দেখা যাবে` };
      }
      const steps = [];
      let label = action;
      let times = 1;
      if (action === 'focus' || action === 'state') {
        label = 'উইন্ডো সামনে আনা';
      } else if (PAGES[action]) {
        steps.push(PAGES[action]);
        label = `${action} পেজে যাওয়া`;
      } else if (KEYS[action]) {
        times = Math.min(30, Math.max(1, Number(args.times) || 1));
        for (let i = 0; i < times; i += 1) steps.push(KEYS[action]);
        label = `${action}${times > 1 ? ` ×${times}` : ''}`;
      } else if (action === 'step') {
        const n = Math.max(-300, Math.min(300, Number(args.frames) || 1));
        for (let i = 0; i < Math.abs(n); i += 1) steps.push(n >= 0 ? 'right' : 'left');
        label = `প্লেহেড ${n} ফ্রেম সরানো`;
      } else {
        throw new AgentError(
          `অচেনা resolve কাজ "${action}" — ব্যবহার করো: focus|state|media|cut|edit|fusion|color|fairlight|deliver|` +
            'import|play|pause|blade|ripple_delete|lift|home|end|step|zoom_fit|insert|overwrite|undo|save',
          'ARGS'
        );
      }
      const shotFile = path.join(WORKSPACE, 'shots', `resolve-${Date.now()}.png`);
      const out = await psRun('win:actshot', { arg1: 'DaVinci Resolve', arg2: steps.join(';'), file: shotFile });
      const took = /shot:(.+)$/.exec(out);
      if (took && fs.existsSync(took[1].trim())) pendingShot = took[1].trim();
      return {
        ok: true,
        output: `${out} — Resolve-এ ${label}; স্ক্রিনশট নিজে থেকেই তোলা হয়েছে, সেটাই চোখে যাবে (আলাদা screen_capture দরকার নেই)`
      };
    }
    case 'press_keys': {
      const keys = String(args.keys || '').trim();
      if (!keys) throw new AgentError('keys দাও, যেমন "ctrl+s" বা "volumeup"', 'ARGS');
      const done = await psRun('key:press', { arg1: keys });
      // ভলিউম/মিডিয়া কীর ফল স্ক্রিনে দেখা যায় না — ওই ধাপে ছবি তুললে ৩০-৯০ সেকেন্ড নষ্ট হয়,
      // তাই এই কীগুলোর জন্য টুল নিজেই "যাচাই" বলে দিয়ে লুপটা শেষ করে দেয়
      const onScreenInvisible = keys.split('+').every((k) => /^(volume|media)/i.test(k.trim()));
      return {
        ok: true,
        output: onScreenInvisible
          ? `কী চাপানো হয়েছে (যাচাই: উইন্ডোজ SendInput ইভেন্টগুলো গ্রহণ করেছে): ${keys} — ভলিউম স্ক্রিনে দেখার বিষয় না, তাই ছবি তুলে আলাদা যাচাই করো না; কাজ হলে এখনই final:true দাও`
          : done
      };
    }
    case 'phone_list': {
      const { listDevices } = await import('./devices.js');
      const list = listDevices();
      if (!list.length) return { ok: true, output: 'কোনো ফোন paired নেই — ফোনে https://PC-IP:4781/phone খুলে পাসকি দিন' };
      return { ok: true, output: list.map((d) => `${d.online ? '✓ অনলাইন' : '✗ অফলাইন'} ${d.name} [${d.id}] (${d.platform}${d.battery != null ? `, ${d.battery}%${d.charging ? ' চার্জিং' : ''}` : ''}, IP ${d.ip})`).join('\n') };
    }
    case 'phone_control': {
      // এজেন্ট ফোনের দিকে কমান্ড পাঠায় — ফোন/PC দুটোই তার হাতের নিচে
      const dev = await import('./devices.js');
      const action = String(args.action || args.type || 'speak').toLowerCase();
      const types = {
        speak: 'speak',
        talk: 'speak',
        bolo: 'speak',
        notify: 'notify',
        notification: 'notify',
        show: 'show',
        card: 'show',
        open: 'open_url',
        open_url: 'open_url',
        link: 'open_url',
        ring: 'ring',
        alarm: 'ring',
        stop_ring: 'ring',
        vibrate: 'vibrate',
        buzz: 'vibrate',
        screen: 'screen',
        stop_screen: 'screen',
        close: 'close_card'
      };
      const type = types[action];
      if (!type) throw new AgentError('অ্যাকশন: speak|notify|show|open_url|ring|vibrate|screen|close_card', 'ARGS');
      const spec = { type, text: args.text, title: args.title, url: args.url, ms: args.ms };
      if (action === 'stop_ring' || action === 'stop_screen') spec.stop = true;
      const wanted = String(args.device || args.phone || '').trim().toLowerCase();
      const online = dev.listDevices().filter((d) => d.online);
      if (!online.length) throw new AgentError('কোনো ফোন অনলাইনে নেই — ফোনে /phone খোলা রাখতে বলুন', 'NODEVICE');
      let target = null;
      if (wanted) target = online.find((d) => d.id === wanted || d.name.toLowerCase().includes(wanted) || wanted.includes(d.name.toLowerCase()));
      else if (online.length === 1) target = online[0];
      if (wanted && !target) throw new AgentError(`“${wanted}” নামে অনলাইন ফোন নেই। আছে: ${online.map((d) => d.name).join(', ')}`, 'NODEVICE');
      if (!target) return dev.broadcastCommand(spec);
      const r = dev.pushCommand(target.id, spec);
      if (!r.ok) throw new AgentError(r.error, 'FAILED');
      return { ok: true, output: `${target.name}-এ ${type} কমান্ড ${r.queued ? 'লাইন-আপে বসানো হয়েছে (ফোন ১০ সেকেন্ডের মধ্যে নেবে)' : 'পাঠানো হয়েছে'}` };
    }
    case 'phone_screen': {
      const dev = await import('./devices.js');
      const wanted = String(args.device || args.phone || '').trim().toLowerCase();
      const devices = dev.listDevices();
      const target = wanted ? devices.find((d) => d.id === wanted || d.name.toLowerCase().includes(wanted)) : devices.find((d) => d.online) || devices[0];
      if (!target) throw new AgentError('কোনো ফোন paired নেই — ফোনে /phone খুলতে বলুন', 'NODEVICE');
      const frame = dev.latestFrame(target.id);
      if (!frame) {
        dev.pushCommand(target.id, { type: 'screen' });
        throw new AgentError(`${target.name}-এ এখনো কোনো স্ক্রিনশট নেই — ফোনে অনুরোধ পাঠানো হয়েছে, সেখানে 📸 স্ক্রিনশট পাঠানোর নির্দেশ দেখাচ্ছে। ইউজারকে বলো: ফোন ধরে Power + Volume down চেপে স্ক্রিনশট তুলুন, তারপর ফোন অ্যাপে “📸 স্ক্রিনশট পাঠাও”-তে ট্যাপ করে নতুন ছবিটা বাছুন। ২০-৩০ সেকেন্ড পর phone_screen আবার চালালে ছবিটা দেখা যাবে। লাইভ শেয়ার মোবাইল ব্রাউজারে চলে না — বারবার শেয়ারের অনুমতি চাইবে না`, 'NOSHARE');
      }
      const ageMin = Math.max(0, Math.round((Date.now() - Number(frame.at || 0)) / 60_000));
      const staleNote = ageMin > 2 ? `এই ছবিটি ${ageMin} মিনিট আগের — বর্তমান স্ক্রিন জানাতে ইউজারকে নতুন স্ক্রিনশট পাঠাতে বলো। ` : '';
      const question = String(args.question || args.query || 'ফোনের স্ক্রিনে যা দেখা যাচ্ছে তা বিস্তারিত বর্ণনা করো। কোন অ্যাপ/পেজ খোলা?');
      if (!ctx?.account) return { ok: true, output: `ফোনের স্ক্রিনশট সেভ আছে (${ageMin} মিনিট আগে): ${frame.file}. ${staleNote}` };
      const { lookAtImage } = await import('./lanes.js');
      const r = await lookAtImage(`${question}\n\n(এটি আমার ফোনের ${ageMin <= 2 ? 'লাইভ' : `${ageMin} মিনিট আগের`} স্ক্রিনশট — ছবিটি দেখে উত্তর দাও)`, frame.file, {
        account: ctx.account,
        timeoutSec: 240
      });
      return { ok: true, output: clip(`${staleNote}${target.name} দেখে উত্তর:\n${r.text}`) };
    }
    case 'youtube_play': {
      const { youtubePlay } = await import('./browser.js');
      return youtubePlay(args.query);
    }
    case 'youtube_search': {
      const { youtubeSearch } = await import('./browser.js');
      return youtubeSearch(args.query);
    }
    case 'youtube_pause': {
      const { youtubePause } = await import('./browser.js');
      return youtubePause();
    }
    case 'fetch_url': {
      const { status, contentType, body } = await httpGet(String(args.url || ''));
      const text = /html|xml/i.test(contentType) ? htmlToText(body) : body;
      return { ok: status >= 200 && status < 400, output: clip(`HTTP ${status}\n${text}`) };
    }
    case 'search_web': {
      const query = String(args.query || '').trim();
      if (!query) throw new AgentError('query খালি', 'ARGS');
      let results = [];
      try {
        results = await searchBing(query);
      } catch {
        /* fall through */
      }
      if (!results.length) results = await searchDdg(query).catch(() => []);
      if (!results.length) return { ok: false, output: 'কোনো সার্চ ফলাফল পাওয়া যায়নি।' };
      const text = results
        .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
        .join('\n');
      return { ok: true, output: clip(text) };
    }
    case 'find_api': {
      const { ensureCatalog, catalogToolOutput } = await import('./apis.js');
      await ensureCatalog();
      const out = await catalogToolOutput(args);
      return { ok: true, output: clip(out) };
    }
    case 'learn_lesson': {
      const lesson = String(args.lesson || '').trim();
      if (!lesson) throw new AgentError('lesson খালি — কী শিখলে লিখো', 'ARGS');
      const tool = String(args.tool || '');
      const code = String(args.code || '');
      const entry = addLesson({
        signature: `${tool || 'general'}:${code || ''}:${lesson.slice(0, 120)}`,
        tool,
        code,
        lesson,
        keywords: Array.isArray(args.keywords) ? args.keywords.map(String).filter(Boolean) : [tool, code].filter(Boolean),
        sourceTask: ctx?.taskId || ''
      });
      return {
        ok: true,
        output: `পাঠ জমা হয়েছে${entry.count > 1 ? ` (আগেও ছিল — এখন ${entry.count} বার)` : ''} — এখন থেকে বটরা এই ভুল এড়াবে।`
      };
    }
    case 'self_update': {
      const { abs, rel, ext } = updateTarget(String(args.file || ''));
      const content = String(args.content ?? '');
      if (content.length > 300_000) throw new AgentError('ফাইল খুব বড় (৩০০KB+)', 'BIG');
      const backupDir = path.join(ROOT, 'data', 'backups');
      fs.mkdirSync(backupDir, { recursive: true });
      if (fs.existsSync(abs)) {
        fs.copyFileSync(abs, path.join(backupDir, `${path.basename(abs)}.${Date.now()}`));
      }
      const tmp = path.join(path.dirname(abs), `.upd-${path.basename(abs)}`);
      fs.writeFileSync(tmp, content, 'utf8');
      if (ext === '.js' || ext === '.mjs') {
        const check = spawnSync(process.execPath, ['--check', tmp], { windowsHide: true, encoding: 'utf8' });
        if (check.status !== 0) {
          fs.rmSync(tmp, { force: true });
          throw new AgentError(`কোডে ভুল আছে — লেখা হয়নি:\n${check.stderr.slice(0, 600)}`, 'SYNTAX');
        }
      }
      fs.renameSync(tmp, abs);
      fs.appendFileSync(
        path.join(ROOT, 'data', 'updates.log'),
        `${new Date().toISOString()} ${rel} (${Buffer.byteLength(content)} B)\n`
      );
      return {
        ok: true,
        output: `আপডেট হয়েছে (যাচাই করা হয়েছে): ${rel} — পরের রিস্টার্টে কার্যকর হবে; restart_self দিলে এখনই নতুন কোড চালু হবে।`
      };
    }
    case 'restart_self': {
      const vbs = path.join(ROOT, 'start-agent-silent.vbs');
      const inner = `ping -n 4 127.0.0.1 >nul & cscript //nologo ${vbs}`;
      spawn('cmd.exe', ['/d', '/s', '/c', `start "" /min cmd /c "${inner}"`], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        windowsVerbatimArguments: true
      }).unref();
      setTimeout(() => process.exit(0), 800);
      return { ok: true, output: 'রিস্টার্ট শুরু হচ্ছে — চলমান কাজটি নিজে থেকেই আবার শুরু হবে।' };
    }
    case 'browser_screenshot': {
      if (!ctx.account) throw new AgentError('অ্যাকাউন্ট পাওয়া যায়নি', 'ACCOUNT');
      const { getPage } = await import('./browser.js');
      const page = await getPage(ctx.account);
      const dir = path.join(WORKSPACE, 'shots');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `browser-${Date.now()}.png`);
      await page.screenshot({ path: file, timeout: 15_000 });
      return { ok: true, output: `স্ক্রিনশট: ${file}` };
    }
    default:
      throw new AgentError(`অজানা টুল: ${tool}`, 'TOOL');
  }
}
