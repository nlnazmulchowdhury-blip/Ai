import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { loadConfig, saveConfig, findAccount, ROOT, WORKSPACE } from './src/config.js';
import { openUrl, closeBrowsers, resetTabs, browserStatus, captureBrowserShot } from './src/browser.js';
import { PROVIDER_META, askProvider, probeProvider } from './src/providers.js';
import { askApiLanes, laneStatus, apiAvailable, resetLane, routeMode, webAllowed } from './src/lanes.js';
import { enqueue, queueInfo, wakeTask } from './src/orchestrator.js';
import { lookupAction, actionTool, teraboxStatus, loadActions } from './src/terabox.js';
import { knowledgeStatus, lookupKnowledge, reloadKnowledge } from './src/knowledge.js';
import {
  localModelStatus,
  startLocalModel,
  stopLocalModel,
  askLocalModel,
  localModelEnabled
} from './src/localmodel.js';
import { humanText } from './src/humanize.js';
import { notesForUi, deleteNote } from './src/memory.js';
import { lessonsForUi } from './src/lessons.js';
import { isApiQuestion, localCatalogReply, searchApis, catalogStats, refreshCatalog, ensureCatalog, publicEntry } from './src/apis.js';
import { saveUpload, MAX_FILE_BYTES, MAX_FILES } from './src/attachments.js';
import { connectSummary, setConnectNotifier, beginLogin, checkAll, checkProvider, checkTeraboxNow } from './src/connect.js';
import { ACCESS_KEY, authorized, isLoopback, keyMatches, unlockCookie, unlockPage, lanAddresses } from './src/access.js';
import { ensureCert } from './src/tls.js';
import { captureScreenFile, captureCropFile, pickScreen } from './src/pctools.js';
import { listDevices, pairDevice, beatDevice, forgetDevice, renameDevice, attachDeviceStream, pushCommand, broadcastCommand, saveFrame, latestFrame } from './src/devices.js';

const PORT = Number(process.env.PORT) || 4780;
const SECURE_PORT = Number(process.env.SecurePort || process.env.HTTPS_PORT) || PORT + 1;
let secureLive = false;
const HOST = '0.0.0.0';
const PUBLIC_DIR = path.join(ROOT, 'public');
const TASKS_FILE = path.join(ROOT, 'data', 'tasks.json');

const tasks = loadTasks();
const statuses = {};
const clients = new Set();
let liveShot = { at: 0, file: '', busy: null };
// ইউজার "দেখাও → লাইভ শেয়ার" চালু করলে স্ক্রিনের ক্যাশ প্রায় তাজা থাকে
let shareUntil = 0;
const staleTasks = tasks.filter((t) => t.status === 'running');
for (const task of staleTasks) {
  const tries = Number(task.resumeCount) || 0;
  if (tries >= 3) {
    task.status = 'error';
    task.error = 'কাজটি বারবার বিচ্ছিন্ন হয়েছে — আর নিজে থেকে চেষ্টা করা হচ্ছে না';
    task.finishedAt = Date.now();
    continue;
  }
  task.status = 'queued';
  task.resume = true;
  task.resumeReason = 'restart';
  task.resumeCount = tries + 1;
  task.error = '';
  task.finishedAt = null;
  task.turns = Array.isArray(task.turns) ? task.turns : [];
  task.turns.push({
    kind: 'note',
    say: `সার্ভার বন্ধ হয়ে কাজটি থেমে গিয়েছিল — নিজে থেকেই আবার শুরু করছি (চেষ্টা ${task.resumeCount})।`,
    at: Date.now()
  });
}
const pendingTasks = tasks.filter((t) => t.status === 'queued');

function loadTasks() {
  try {
    const parsed = JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed.slice(0, 30) : [];
  } catch {
    return [];
  }
}

function persistTasks() {
  try {
    // Atomic write: tmp + rename, so a kill mid-write can never leave
    // tasks.json corrupted (torn/NUL-filled) again.
    const tmp = `${TASKS_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(tasks.slice(0, 30), null, 2), 'utf8');
    fs.renameSync(tmp, TASKS_FILE);
  } catch {
    /* ignore */
  }
}

if (staleTasks.length) persistTasks();

function broadcast(type, payload) {
  if (type === 'task') persistTasks();
  const chunk = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) {
    try {
      res.write(chunk);
    } catch {
      clients.delete(res);
    }
  }
}

const hooks = {
  broadcast,
  setStatus(botId, status) {
    statuses[botId] = status;
  },
  statuses: () => statuses
};

setConnectNotifier((summary) => broadcast('connect', summary));

function botsForUi() {
  const cfg = loadConfig();
  const accountName = Object.fromEntries(cfg.accounts.map((a) => [a.id, a.name]));
  const groupName = Object.fromEntries(cfg.groups.map((g) => [g.id, g.name]));
  return cfg.bots.map((b) => ({
    ...b,
    groupName: groupName[b.group] || b.group,
    accountName: accountName[b.account] || b.account,
    providerLabel: providersForUi(cfg)[b.provider]?.label || b.provider,
    status: statuses[b.id] || 'idle'
  }));
}

function providersForUi(cfg) {
  const meta = { ...PROVIDER_META };
  for (const api of cfg.settings?.customApis || []) {
    meta[`custom-${api.id}`] = {
      label: api.name || api.id,
      color: '#8fb6ff',
      api: true,
      apiLabel: api.model || 'API'
    };
  }
  return meta;
}

function statePayload(req) {
  const cfg = loadConfig();
  const payload = {
    settings: cfg.settings,
    accounts: cfg.accounts,
    groups: cfg.groups,
    bots: botsForUi(),
    tasks: tasks.slice(0, 30),
    notes: notesForUi(20),
    lessons: lessonsForUi(),
    browsers: browserStatus(),
    queue: queueInfo(),
    providers: providersForUi(cfg),
    lanes: laneStatus(),
    workspace: WORKSPACE,
    devices: listDevices(),
    connect: connectSummary(),
    now: Date.now()
  };
  if (req && authorized(req, new URL(req.url, `http://${req.headers.host || 'localhost'}`))) {
    const ips = lanAddresses();
    payload.share = {
      urls: ips.map((ip) => `http://${ip}:${PORT}`),
      secureUrls: secureLive ? ips.map((ip) => `https://${ip}:${SECURE_PORT}/phone`) : [],
      key: ACCESS_KEY
    };
  }
  return payload;
}

function sendJson(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(body);
}

function listWorkspace(limit = 300) {
  const out = [];
  const walk = (dir, rel, depth) => {
    if (depth > 3 || out.length >= limit) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '__pycache__') continue;
      const full = path.join(dir, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(full, relPath, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const st = fs.statSync(full);
        out.push({ name: entry.name, path: relPath, size: st.size, mtime: Math.round(st.mtimeMs) });
      } catch {
        /* file vanished mid-walk */
      }
      if (out.length >= limit) return;
    }
  };
  walk(WORKSPACE, '', 0);
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

function readBody(req, limit = 2_000_000) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > limit) {
        reject(new Error('body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

const WIDGET_FILE = path.join(ROOT, 'data', 'widget.json');

function widgetState() {
  try {
    return { mode: 'expanded', running: false, ...JSON.parse(fs.readFileSync(WIDGET_FILE, 'utf8')) };
  } catch {
    return { mode: 'expanded', running: false };
  }
}

function saveWidgetState(patch) {
  const next = { ...widgetState(), ...patch, at: Date.now() };
  try {
    fs.writeFileSync(WIDGET_FILE, JSON.stringify(next, null, 2));
  } catch {
    /* অবস্থা লেখা না গেলেও হাট চলবে */
  }
  return next;
}

const WIDGET_LOG = path.join(ROOT, 'data', 'widget.log');

// widget.json-এর running কেবল ইচ্ছে, প্রমাণ নয় — এনফোর্সার মরে গেলেও true থেকে যায়,
// তখন ড্যাশবোর্ডের হাট বোতাম 'stop' পাঠায় আর স্ক্রিনে কিছুই বদলায় না। এনফোর্সার নিজে
// প্রতি কয়েক টিকে data/widget.hb-তে ছাপা ফেলে; সেই টাইমস্ট্যাম্পই জীবিততার প্রমাণ
const WIDGET_HB = path.join(ROOT, 'data', 'widget.hb');

function widgetAlive() {
  try {
    return Date.now() - Number(fs.readFileSync(WIDGET_HB, 'utf8')) < 20000;
  } catch {
    return false;
  }
}

// এই ল্যাপটপে powershell-এর ঠান্ডা স্টার্ট + Add-Type-এর C# কম্পাইল ৩-৪ মিনিট নেয়,
// সেই ফাঁকে ওয়াচডগ যদি আবার তুলতে যায়, নতুন এনফোর্সার পুরনোটার এজ উইন্ডো মেরে ফেলে
// (ডি-ডিআপ ব্লক)। তাই প্রতিটি স্পনের পর ৫ মিনিট চুপ থাকি
let hatQuietUntil = 0;

function widgetTrace(msg) {
  try { fs.appendFileSync(WIDGET_LOG, `[${new Date().toTimeString().slice(0, 8)}] srv ${msg}\n`); } catch { }
}

function runWidgetScript(extraArgs) {
  // detached:true + powershell = এই জোড়াটা মারাত্মক: কনসোল-অ্যাপটি DETACHED_PROCESS
  // ফ্ল্যাগে স্ক্রিপ্ট চালিয়েই দেয় না (exit 0, কোনো লগ নেই)। windowsHide (CREATE_NO_WINDOW)
  // একাই যথেষ্ট — কনসোল উইন্ডো দেখা যায় না, আবার সার্ভার মরলেও চিল্ড বেঁচে থাকে
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(ROOT, 'scripts', 'start-widget.ps1'), ...extraArgs];
  if (!extraArgs.includes('-Stop')) hatQuietUntil = Date.now() + 300000;
  spawn('powershell.exe', args, { stdio: 'ignore', windowsHide: true }).unref();
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.resolve(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep) && file !== PUBLIC_DIR) {
    res.writeHead(403);
    return res.end('forbidden');
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('পাওয়া যায়নি');
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store'
    });
    res.end(data);
  });
}

function createTask(prompt, startBot, autoTeam, attachments = []) {
  const id = crypto.randomUUID().slice(0, 8);
  const text = String(prompt || '').trim() || (attachments.length ? 'সংযুক্ত ফাইলটি পড়ে কী আছে জানাও।' : '');
  const chat =
    !attachments.length && (!!localClockReply(text) || isSmallTalk(text) || isConversation(text));
  const fast = !attachments.length && (chat || isApiQuestion(text));
  const task = {
    id,
    prompt: text.slice(0, 4000),
    startBot,
    autoTeam: autoTeam !== false,
    attachments: attachments.slice(0, MAX_FILES),
    status: 'queued',
    turns: [],
    createdAt: Date.now(),
    ...(fast ? { fast: true } : {}),
    ...(chat ? { chat: true } : {})
  };
  tasks.unshift(task);
  if (tasks.length > 30) tasks.length = 30;
  persistTasks();
  broadcast('task', task);
  if (fast) runFastReply(task).catch(() => {});
  else enqueue(task, hooks);
  return task;
}

const SMALL_TALK = [
  {
    re: /^\s*(hi+|hello+|hey+|helo+|yo)[\s!?.।]*$/i,
    replies: ['হাই! আমি PC·AGENT — বলো, কী করতে পারি তোমার জন্য?', 'হ্যালো! আমি প্রস্তুত — কী কাজ বলবে?']
  },
  {
    re: /^(হাই|হ্যালো|হেলো|ওহে)[\s!?.।]*$/,
    replies: ['হাই! আমি PC·AGENT — কী করতে পারি তোমার জন্য?', 'হ্যালো! কাজটা বলো, করে দিচ্ছি।']
  },
  {
    re: /(আসসালামু\s*আলাইকুম|স্লামালিকুম)/,
    replies: ['ওয়া আলাইকুমুস সালাম! কী করতে পারি তোমার জন্য?']
  },
  {
    re: /(কেমন আছ|কেমন আছো|কেমন আছেন|কেমন আছিস|ভালো আছ|ভালো তো|কি খবর|কী খবর|কিরে|\bhow are you\b|\bhow r u\b|what'?s up|wassup|kemon acho|kemon aso|kemon achen)/i,
    replies: [
      'আমি বট — সবসময় ফুরফুরে আছি! তোমার খবর কী? কাজটা বলো, করে দিই।',
      'দারুণ আছি, তোমার জন্যই অপেক্ষায়! বলো, কী কাজ করতে হবে?'
    ]
  },
  {
    re: /(তুমি কে|কে তুমি|তোমার নাম কি|তোমার নাম কী|who are you|what is your name)/i,
    replies: ['আমি PC·AGENT — তোমার কম্পিউটারের নিজস্ব AI সহকারী। ফাইল, ফোল্ডার, ব্রাউজার, অ্যাপ সব চালাতে পারি।']
  },
  {
    re: /((?:তুমি|তোমি|তুই)\s*(?:কি|কী)\s*করতে\s*(?:পার|পাবেন|পারো)|what can you do)/i,
    replies: [
      'আমি তোমার কম্পিউটারে কাজ করি — ফাইল/ফোল্ডার তৈরি-মোছা, ব্রাউজার ও অ্যাপ খোলা, স্ক্রিন দেখা, ডাউনলোড, রিপোর্ট লেখা… কী দরকার বলো!'
    ]
  },
  {
    re: /(তুমি কি খোলা|খোলা থাকো|কখন খোলা|কতক্ষণ খোলা|সবসময় আছ|তুমি কি (?:ব্যস্ত|ফ্রি)|are you (?:free|available|open))/i,
    replies: [
      'আমি ২৪/৭ খোলা — এই পিসি চালু থাকলেই কাজ পাবো। এখন কিছু বলো!',
      'ব্যস্ততা নেই — যখন খুশি কাজ দাও, সাথে সাথে শুরু করে দেবো।'
    ]
  },
  {
    re: /(শুনতে পা(চ্ছ|ও|ন|ছো)|আমার কথা (শুন|বুঝ)|সাড়া দি|are you there|can you hear|ডাকলে পাওয়া|আছো তুমি|তুমি আছ|রেডি তো|তুমি কি রেডি|are you ready)/i,
    replies: [
      'হ্যাঁ, স্পষ্ট শুনছি! 🎙 বলো, কী করবো?',
      'আছি হাজির — তোমার প্রতিটা কথা আসছে। কাজ বলো, শুরু করি।'
    ]
  },
  {
    re: /(কী করছ|কি করছ|কী করছি|কী হচ্ছে|কি হচ্ছে|কী চলছে|কি চলছে|what are you doing)/i,
    replies: ['এখন তোমার পরের কাজের অপেক্ষায় বসে আছি — বলো কী করবো?', 'কোনো কাজ লাইনে নেই; যা বলবে তা-ই শুরু করবো।']
  },
  {
    re: /^\s*(শুনছি|শুনছ|শুনিছ|শুনতেছ|শুনতেছো|বুঝছ|বুঝতে পারছ|পেয়েছ|অ্যালো|আলো|হ্যালো|hello\??|hi\??|আছো|আছি\??|are you there\??|can you hear me\??)[\s!?.।*]*$/i,
    replies: ['হ্যাঁ শুনছি! 🎙 বলো কী করবো.', 'পাচ্ছি স্পষ্ট — কাজ বলো, এখনই শুরু করি।']
  },
  {
    re: /^\s*(ok|okay|okey|thik ache|ঠিক আছে|বুঝলাম|হুম|হ্যাঁ|হ্যা|না|not now|এখন না|পরে|আচ্ছা|accha)[\s!?.।]*$/i,
    replies: ['আচ্ছা! কিছু লাগলে বলো।', 'ঠিক আছে — আমি আছি।']
  },
  {
    re: /^\s*(thanks|thank you|thank u|thnx|ধন্যবাদ|থ্যাংকস)[\s!?.।]*$/i,
    replies: ['তোমাকেও ধন্যবাদ! আর কিছু লাগলে বলো।', 'সবসময় হাজির! আরেকটা কাজ দাও।']
  },
  {
    re: /^\s*good\s+(morning|afternoon|evening|night)[\s!?.।]*$/i,
    replies: ['Good morning! আজ কী কাজ করবো আমরা?']
  },
  {
    re: /^(শুভ\s+(সকাল|দুপুর|সন্ধ্যা|রাত্রি|রাত))[\s!?.।]*$/,
    replies: ['শুভ সকাল! আজ কী করতে হবে বলো।']
  }
];

// টাইপ/ভয়েস-ট্রান্সক্রিপ্টে স্পেস থাকে না ("তোমিকি" ) — প্রতিটা ফাঁকা জায়গাকে \s* ধরে দ্বিতীয় প্যাটার্ন
const squeeze = (re) => new RegExp(re.source.replace(/ /g, '\\s*'), re.flags);
for (const p of SMALL_TALK) p.re2 = squeeze(p.re);

function smallTalkMatch(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 140) return null;
  return SMALL_TALK.find((p) => p.re.test(t) || p.re2.test(t)) || null;
}

function isSmallTalk(text) {
  return !!smallTalkMatch(text);
}

// কাজ-নির্দেশক ক্রিয়া/লক্ষ্য থাকলে এটা কথাবার্তা না — দল নামাতেই হবে
const NEEDS_TOOL_RE =
  /(খোল|খুল|খুলে|ওপেন|open|তৈরি|বানা|লিখ|মোছ|মুছু|ডিলিট|delete|সেভ|save|ডাউনলোড|download|আপলোড|upload|চালা|কমান্ড|সার্চ|search|গুগল|google|ইউটিউব|youtube|ভিডিও|ফেসবুক|facebook|হোয়াটসঅ্যাপ|whatsapp|ট্যাব|ব্রাউজার|browser|অ্যাপ|সাইট|website|url|http|ফাইল|file|ফোল্ডার|folder|ডেস্কটপ|desktop|স্ক্রিন|screen|শট|shot|ক্যাপচার|capture|মাউস|mouse|কীবোর্ড|keyboard|ভলিউম|volume|মিউট|mute|অ্যালার্ম|আলার্ম|alarm|টাইমার|timer|ক্যালেন্ডার|calendar|মেসেজ|message|ইমেইল|email|প্রিন্ট|print|রেট|rate|আবহাওয়া|weather|ট্রাফিক|traffic|সংবাদ|news|ক্রিপ্টো|bitcoin|রিপোর্ট|report|ডাটা|data|নোটিফিকেশন|phone|ফোন|পিসি|pc-|প্রিন্টার|ওয়াইফাই|wifi|bluetooth|স্পিকার|মাইক|mic)/i;

const CHAT_HINT_RE =
  /(তুমি|তোমি|তুমার|তোমার|তোমারা|তোমারে|তোর|আপনি|আপনার|তুই|আমাকে চেন|কেমন লাগ|বুঝতে পার|শুনতে পা|ভুলে গেছ|মনে আছে|মনে রাখা|ধন্যবাদ|দুঃখিত|sorry|\b(?:agent|assistant|bot|ai|hi|hello|hey)\b|হাই|হ্যালো|শুভ |good (?:morning|night))/i;

// হুকুমের ক্রিয়া থাকলে এটা প্রশ্ন হলেও কাজ — দল লাগবে
const IMPERATIVE_RE =
  /(করো|করুন|করে দাও|করে দিব|দাও|দিন|দিও|লাগাও|লাগান|যাও|খোল|খুল|মোছ|মুছু|বানাও|বানিয়ে|তৈরি|যোগ|সেট|চালাও|চালু|থামা|দেখাও|পড়াও|শাও|ঢালা|রেড|পাঠাও|খুঁজে|দয়া|নোটিফাই)/i;

// প্রশ্নবোধক শব্দ — বাংলায় \b কাজ করে না (বর্ণ \w-এর বাইরে), তাই সীমানা নিজে ধরা
const QUESTION_WORD_RE =
  /(?:^|[^\p{L}\p{M}\p{N}])(?:কি|কী|কেন|কে|কত|কবে|কোথায়|কীভাবে|কিভাবে|কেমন|আছে|পার|চেন|can|could|do|does|are|is|what|who|how|why)(?=$|[^\p{L}\p{M}\p{N}])/iu;

// কথাবার্তা/স্ব-সচেতন প্রশ্ন = দল ছাড়া সরাসরি উত্তর; কাজের আদেশ = দল
function isConversation(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 140) return false;
  if (smallTalkMatch(t)) return true;
  if (NEEDS_TOOL_RE.test(t) || IMPERATIVE_RE.test(t)) return false;
  const hintsToMe = CHAT_HINT_RE.test(t) || squeeze(CHAT_HINT_RE).test(t);
  if (!hintsToMe) return false;
  // ছোট-স্ব-সচেতন বাক্য (৬০ বর্ণের ভেতর, কাজের ক্রিয়া নেই) = কথাবার্তা
  return t.length <= 60 || /[?？]/.test(t) || QUESTION_WORD_RE.test(t);
}

const BN_DAY = ['রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার', 'শনিবার'];
const BN_MONTH = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];
const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
const bnNum = (n) => String(n).replace(/\d/g, (d) => BN_DIGITS[Number(d)]);
const bnDate = (d) => `${bnNum(d.getDate())} ${BN_MONTH[d.getMonth()]} ${bnNum(d.getFullYear())}, ${BN_DAY[d.getDay()]}`;
const bnTime = (d) => {
  const h24 = d.getHours();
  const h = h24 % 12 || 12;
  return `${bnNum(h)}:${bnNum(String(d.getMinutes()).padStart(2, '0'))} ${h24 < 12 ? 'AM' : 'PM'}`;
};

// ঘড়ি/তারিখ-প্রশ্ন — মডেল না ডেকে এখানেই সঠিক উত্তর
const CLOCK_RE =
  /(বা?জল|বা?জছে|(?:কয়|কয়টা|কটা|কত|কেত) ?বা?জ|(?:কয়|কয়টা|কটা) ?সময়|সময় কত|কত ?সময়|তারিখ|কি ?বার|কী ?বার|কোন ?বার|কি ?দিন|কী ?দিন|কোন ?দিন|what time|current time|what day|today'?s date|\bclock\b)/i;

function localClockReply(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 120 || !CLOCK_RE.test(t)) return '';
  if (/(খোল|ওপেন|open|সেট|আলার্ম|অ্যালার্ম|alarm|টাইমার|timer|ক্যালেন্ডার|calendar|মেসেজ|message|phone|ফোন|remind)/i.test(t)) return '';
  const d = new Date();
  if (/(তারিখ|কি ?বার|কী ?বার|কোন ?বার|কি ?দিন|কী ?দিন|কোন ?দিন|what day|date)/i.test(t)) {
    return `আজ ${bnDate(d)}।`;
  }
  return `এখন এই পিসির ঘড়ি অনুযায়ী ${bnTime(d)} — ${bnDate(d)}।`;
}

function localSmallTalkReply(text) {
  const match = smallTalkMatch(text);
  if (!match || !match.replies?.length) return '';
  return match.replies[Math.floor(Math.random() * match.replies.length)];
}

const FAST_SYSTEM = [
  'তুমি PC·AGENT — এই কম্পিউটারের নিজস্ব AI সহকারী, সবসময় বাংলা লিপিতে তুমি-টুই ভাষায় কথা বলো; ইংরেজি, হিন্দি বা দেবনাগরী লিপি মেশাবে না।',
  'এটা কথাবার্তা বা ছোট প্রশ্ন — কোনো কাজের আদেশ না, তাই ফাইল/ব্রাউজার/অ্যাপ কিছুই খুলবে না, দলও নামাবে না।',
  'নিয়ম: ১-৩ ছোট বাক্যে উষ্ণ, বন্ধুসুলভ উত্তর দাও; জানো না বলো জানি না, বানিয়ে বলবে না; দরকার হলে শেষে এক লাইনে বলো কী কী কাজ করে দিতে পারো।'
].join(' ');

// দেবনাগরী বর্ণ/সংখ্যা মিশলে সেটা বাংলা উত্তর না — পরের লেনে যাও।
// (U+0964 "।" ও U+0965 "॥" বাংলা লেখায়ও দাঁড়ি, তাই ওগুলো বাদ)
const DEVANAGARI_RE = /[\u0900-\u0963\u0966-\u097F]/;
const chatUsable = (t) => !!t && !DEVANAGARI_RE.test(t);

// লেনের তালিকা ও স্বাস্থ্য এখন src/lanes.js-এ — ফাস্ট লেন আর কর্মী-বট একই টেবিল ভাগ করে নেয়,
// তাই API চললে ওয়েব ট্যাব একদম খোলে না, আর ব্যর্থ কী বারবার ট্রাই করে সময় নষ্ট হয় না।
async function fastApiReply(question) {
  const res = await askApiLanes('', question, {
    timeoutSec: 15,
    maxTokens: 220,
    usable: chatUsable
  });
  return res ? { text: String(res.text || ''), lane: `api:${res.lane}` } : { text: '', lane: '' };
}

async function runFastReply(task) {
  const local = localClockReply(task.prompt) || localSmallTalkReply(task.prompt);
  if (local) {
    task.turns = Array.isArray(task.turns) ? task.turns : [];
    task.turns.push({ kind: 'note', say: 'কথাবার্তা/ছোট প্রশ্ন — দল গঠন না করেই তৎক্ষণাৎ উত্তর।', at: Date.now() });
    task.result = local;
    task.status = 'done';
    task.finishedAt = Date.now();
    broadcast('task', task);
    return;
  }

  if (isApiQuestion(task.prompt)) {
    task.turns = Array.isArray(task.turns) ? task.turns : [];
    task.turns.push({ kind: 'note', say: 'API প্রশ্ন — বিল্ট-ইন public-apis ক্যাটালগে খুঁজছি (ব্রাউজার/মডেল লাগবে না)।', at: Date.now() });
    broadcast('task', task);
    const hit = await localCatalogReply(task.prompt).catch(() => '');
    if (hit) {
      task.result = hit;
      task.status = 'done';
      task.finishedAt = Date.now();
      broadcast('task', task);
      return;
    }
    task.fast = false;
    task.status = 'queued';
    task.turns.push({ kind: 'note', say: 'ক্যাটালগে মিল পাইনি — দল নামিয়ে ওয়েব থেকে খুঁজছি।', at: Date.now() });
    broadcast('task', task);
    enqueue(task, hooks);
    return;
  }

  task.status = 'running';
  task.startedAt = Date.now();
  task.turns = Array.isArray(task.turns) ? task.turns : [];
  task.turns.push({ kind: 'note', say: 'কথাবার্তা/প্রশ্ন — দল গঠন না করে সরাসরি উত্তর দিচ্ছি।', at: Date.now() });
  broadcast('task', task);

  const cfg = loadConfig();
  const now = new Date();
  const question = `${FAST_SYSTEM}\n\n(তথ্য: এখন ${bnTime(now)}, ${bnDate(now)})\n\nব্যবহারকারী: ${task.prompt}`;
  const fast = !task.cancel ? await fastApiReply(question) : { text: '', lane: '' };
  let reply = fast.text;
  task.lane = fast.lane;

  // 'api' মোডে ওয়েব ট্যাব খোলে না — API ব্যর্থ হলে এই ছোট প্রশ্নও সোজা দলে যায়
  if (!reply && !task.cancel && webAllowed()) {
    const account = cfg.accounts.find((a) => a.provider === 'gemini') || cfg.accounts[0];
    const webProvider = account?.provider || 'gemini';
    if (account) {
      try {
        const res = await askProvider(webProvider, question, { account, timeoutSec: 120 });
        reply = res.text;
        // এটা প্রমাণ যে কোনো API চলেনি → ফ্রি ওয়েব AI থেকে উত্তর এসেছে
        task.lane = res.lane ? `api:${res.lane}` : `web:${webProvider}`;
      } catch (err) {
        console.log(`[fast] ${webProvider} web: ${err.code || ''} ${err.message || err}`);
      }
    }
  }

  if (task.cancel) {
    task.status = 'cancelled';
    task.finishedAt = Date.now();
    broadcast('task', task);
    return;
  }

  if (!reply) {
    task.fast = false;
    task.status = 'queued';
    task.turns.push({ kind: 'note', say: 'সরাসরি উত্তর পাওয়া যায়নি — দল নামিয়ে দিচ্ছি।', at: Date.now() });
    broadcast('task', task);
    enqueue(task, hooks);
    return;
  }

  task.result = humanText(String(reply).slice(0, 2000)) || 'সরাসরি উত্তর পাওয়া যায়নি — আবার বলো।';
  task.status = 'done';
  task.finishedAt = Date.now();
  broadcast('task', task);
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);
  const method = req.method;

  try {
    if (pathname === '/favicon.ico') {
      res.writeHead(204, { 'cache-control': 'no-store' });
      return res.end();
    }
    const viaKey = keyMatches(url.searchParams.get('key'));
    if (!authorized(req, url)) {
      res.writeHead(401, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(unlockPage());
    }
    if (viaKey) {
      res.setHeader('set-cookie', unlockCookie());
      if (method === 'GET' && !pathname.startsWith('/api/')) {
        res.writeHead(302, { location: pathname.startsWith('/phone') ? '/phone' : '/' });
        return res.end();
      }
    }

    if (pathname === '/api/events' && method === 'GET') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'x-accel-buffering': 'no'
      });
      res.write(`event: hello\ndata: ${JSON.stringify(statePayload(req))}\n\n`);
      clients.add(res);
      const ping = setInterval(() => {
        try {
          res.write(': ping\n\n');
        } catch {
          /* ignore */
        }
      }, 20_000);
      req.on('close', () => {
        clearInterval(ping);
        clients.delete(res);
      });
      return;
    }

    if (pathname === '/api/state' && method === 'GET') return sendJson(res, 200, statePayload(req));

    // সংযোগ উইজার্ড: একবার লগইন করলেই সাইটগুলো কাজে লাগে — আলাদা সেটআপ নেই
    if (pathname === '/api/connect' && method === 'GET') {
      return sendJson(res, 200, {
        ok: true,
        ...connectSummary(),
        routeMode: routeMode(),
        teraboxLane: teraboxStatus()
      });
    }

    if (pathname === '/api/connect/route' && method === 'POST') {
      const body = await readBody(req);
      const mode = ['api', 'web', 'both'].includes(body.mode) ? body.mode : 'both';
      const cfg = loadConfig();
      cfg.settings.routeMode = mode;
      cfg.settings.preferApi = mode !== 'web';
      const saved = saveConfig(cfg);
      resetLane('');
      broadcast('config', saved);
      return sendJson(res, 200, { ok: true, routeMode: mode });
    }

    if (pathname === '/api/connect/login' && method === 'POST') {
      const body = await readBody(req);
      try {
        const r = await beginLogin(String(body.target || ''), { accountId: String(body.accountId || '') });
        return sendJson(res, 200, { ok: true, ...r });
      } catch (err) {
        return sendJson(res, 400, { ok: false, error: err.message || 'লগইন উইন্ডো খোলা যায়নি' });
      }
    }

    if (pathname === '/api/connect/check' && method === 'POST') {
      const body = await readBody(req);
      const target = String(body.target || '');
      try {
        if (target === 'terabox') return sendJson(res, 200, { ok: true, terabox: await checkTeraboxNow() });
        if (target) return sendJson(res, 200, { ok: true, provider: await checkProvider(target, String(body.accountId || '')) });
        const busy = queueInfo().running > 0;
        return sendJson(res, 200, { ok: true, ...(await checkAll({ keepBrowser: busy })) });
      } catch (err) {
        return sendJson(res, 503, { ok: false, error: err.message || 'যাচাই করা যায়নি' });
      }
    }

    if (pathname === '/api/files' && method === 'GET') {
      return sendJson(res, 200, { ok: true, workspace: WORKSPACE, files: listWorkspace() });
    }

    // Terabox-এ রাখা অ্যাকশন-ডেটা: "GET /api/data?query=youtube open"
    if (pathname === '/api/data' && method === 'GET') {
      const q = url.searchParams.get('query') || '';
      if (url.searchParams.get('refresh') === 'true') await loadActions({ force: true });
      const hit = await lookupAction(q);
      return sendJson(res, 200, {
        ok: Boolean(hit.record),
        query: q,
        source: hit.source,
        data_count: hit.count,
        action: hit.record || null,
        tool: hit.record ? actionTool(hit.record) : null,
        terabox: teraboxStatus()
      });
    }

    // লোকাল মডেল + বাংলা কর্পাস স্ট্যাটাস/কন্ট্রোল
    if (pathname === '/api/models' && method === 'GET') {
      return sendJson(res, 200, {
        ok: true,
        ...localModelStatus(),
        knowledge: knowledgeStatus(),
        enabled: localModelEnabled(loadConfig()),
        terabox: teraboxStatus()
      });
    }

    if (pathname === '/api/models' && method === 'POST') {
      const body = await readBody(req);
      const action = String(body.action || '');
      const cfg = loadConfig();
      if (action === 'toggle') {
        cfg.settings.localModel = { ...cfg.settings.localModel, enabled: Boolean(body.enabled) };
        saveConfig(cfg);
        if (!body.enabled) stopLocalModel('toggle-off');
        return sendJson(res, 200, { ok: true, enabled: Boolean(body.enabled), ...localModelStatus() });
      }
      if (action === 'start') {
        const r = await startLocalModel(String(body.modelId || cfg.settings.localModel.modelId || ''));
        // স্ট্যাটাস আগে, ফলাফল পরে — নাহলে status-এর খালি error() আসল অস্বীকারের
        // কারণ ("RAM কম — …") চেপে দিত, বোতাম চাপলে কিছুই বোঝা যেত না
        const st = localModelStatus();
        return sendJson(res, 200, { ...st, ...r, error: r.error || st.error });
      }
      if (action === 'stop') {
        const r = stopLocalModel('api');
        const st = localModelStatus();
        return sendJson(res, 200, { ...st, ...r, error: r.error || st.error });
      }
      if (action === 'ask') {
        const r = await askLocalModel(String(body.prompt || ''), { modelId: String(body.modelId || '') });
        return sendJson(res, 200, r);
      }
      if (action === 'reload') {
        reloadKnowledge();
        return sendJson(res, 200, { ok: true, knowledge: knowledgeStatus() });
      }
      return sendJson(res, 400, { ok: false, error: 'অজানা action' });
    }

    // বাংলা কর্পাসে খোঁজা: "GET /api/knowledge?query=..."
    if (pathname === '/api/knowledge' && method === 'GET') {
      const q = url.searchParams.get('query') || '';
      return sendJson(res, 200, { ok: true, query: q, hits: lookupKnowledge(q, 8), stats: knowledgeStatus() });
    }

    // ডান কোণায় সবসময় থাকার হাট চেট: শুরু/থামাও আর বড়-ছোট অবস্থা
    if (pathname === '/api/widget' && method === 'GET') {
      return sendJson(res, 200, { ok: true, ...widgetState(), alive: widgetAlive() });
    }

    if (pathname === '/api/widget' && method === 'POST') {
      const body = await readBody(req);
      const action = String(body.action || '');
      if (action === 'state') {
        const mode = body.mode === 'collapsed' ? 'collapsed' : 'expanded';
        widgetTrace(`state -> ${mode} via ${String(body.via || 'api').slice(0, 24)} (from ${req.headers.referer || 'no-referer'})`);
        return sendJson(res, 200, { ok: true, ...saveWidgetState({ mode }), alive: widgetAlive() });
      }
      if (action === 'stop') {
        widgetTrace('action -> stop');
        try { fs.writeFileSync(WIDGET_HB, '0'); } catch { }
        runWidgetScript(['-Stop']);
        return sendJson(res, 200, { ok: true, ...saveWidgetState({ running: false }), alive: false });
      }
      if (widgetAlive()) {
        widgetTrace('action -> start ignored (enforcer alive)');
        return sendJson(res, 200, { ok: true, ...saveWidgetState({ running: true }), alive: true, skipped: true });
      }
      widgetTrace('action -> start');
      runWidgetScript([]);
      return sendJson(res, 200, { ok: true, ...saveWidgetState({ running: true }), alive: false });
    }

    if (pathname === '/api/apis' && method === 'GET') {
      await ensureCatalog();
      const q = url.searchParams.get('q') || '';
      const limit = Number(url.searchParams.get('limit')) || 10;
      const results = q ? searchApis(q, { category: url.searchParams.get('category') || '', limit }).map(publicEntry) : [];
      return sendJson(res, 200, { ok: true, query: q, results, ...catalogStats() });
    }

    if (pathname === '/api/apis/refresh' && method === 'POST') {
      try {
        const r = await refreshCatalog();
        return sendJson(res, 200, { ...r, ...catalogStats() });
      } catch (err) {
        return sendJson(res, 502, { ok: false, error: err.message || String(err) });
      }
    }

    if (pathname === '/api/notes' && method === 'DELETE') {
      const id = url.searchParams.get('id') || '';
      const removed = deleteNote(id);
      broadcast('notes', { id, removed });
      return sendJson(res, removed ? 200 : 404, { ok: removed });
    }

    if (pathname === '/api/upload' && method === 'POST') {
      const body = await readBody(req, Math.ceil(MAX_FILE_BYTES * 1.4) + 1_000_000);
      try {
        const attachment = saveUpload(body);
        return sendJson(res, 200, { ok: true, attachment });
      } catch (err) {
        return sendJson(res, 400, { error: err.message || 'আপলোড ব্যর্থ' });
      }
    }

    if (pathname === '/api/task' && method === 'POST') {
      const body = await readBody(req);
      const prompt = String(body.prompt || '').trim();
      const attachments = (Array.isArray(body.attachments) ? body.attachments : [])
        .slice(0, MAX_FILES)
        .map((a) => ({
          name: String(a?.name || '').slice(0, 160),
          path: String(a?.path || ''),
          mime: String(a?.mime || '').slice(0, 80),
          size: Number(a?.size) || 0
        }))
        .filter((a) => a.path);
      if (!prompt && !attachments.length) return sendJson(res, 400, { error: 'কাজ লেখা হয়নি' });
      const task = createTask(prompt, body.startBot, body.autoTeam, attachments);
      return sendJson(res, 200, { task });
    }

    if (pathname === '/api/task/cancel' && method === 'POST') {
      const body = await readBody(req);
      const task = tasks.find((t) => t.id === body.id);
      if (!task) return sendJson(res, 404, { error: 'কাজ পাওয়া যায়নি' });
      task.cancel = true;
      // থামানো বোতাম চাপা মাত্রই চলমান ৩০-৯০ সেকেন্ডের কলের অপেক্ষা ভাঙে
      wakeTask(task);
      if (task.status === 'queued') task.status = 'cancelled';
      broadcast('task', task);
      persistTasks();
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === '/api/task/retry' && method === 'POST') {
      const body = await readBody(req);
      const task = tasks.find((t) => t.id === body.id);
      if (!task) return sendJson(res, 404, { error: 'কাজ পাওয়া যায়নি' });
      if (task.status === 'running' || task.status === 'queued') {
        return sendJson(res, 400, { error: 'কাজটি এখনই চলছে' });
      }
      if (!['error', 'need_login', 'cancelled'].includes(task.status)) {
        return sendJson(res, 400, { error: 'কাজটি সফলভাবে শেষ হয়েছে — আবার চালানোর দরকার নেই' });
      }
      task.status = 'queued';
      task.error = '';
      task.finishedAt = null;
      task.startedAt = null;
      task.resume = true;
      task.resumeReason = 'retry';
      task.resumeCount = 0;
      task.cancel = false;
      task.turns = Array.isArray(task.turns) ? task.turns : [];
      task.turns.push({
        kind: 'note',
        say: 'ব্যবহারকারী আবার চালাতে বলেছেন — যেখানে থেমেছিল সেখান থেকেই শুরু হচ্ছে।',
        at: Date.now()
      });
      persistTasks();
      broadcast('task', task);
      enqueue(task, hooks);
      return sendJson(res, 200, { ok: true, task });
    }

    if (pathname === '/api/login' && method === 'POST') {
      const body = await readBody(req);
      const cfg = loadConfig();
      const account = findAccount(cfg, body.accountId);
      const provider = PROVIDER_META[body.provider];
      if (!account || !provider) return sendJson(res, 400, { error: 'ভুল অ্যাকাউন্ট/প্রোভাইডার' });
      const current = await openUrl(account, provider.url);
      return sendJson(res, 200, { ok: true, url: current });
    }

    if (pathname === '/api/browser/close' && method === 'POST') {
      const closed = await closeBrowsers();
      broadcast('browsers', browserStatus());
      return sendJson(res, 200, { ok: true, closed });
    }

    if (pathname === '/api/browser/newtab' && method === 'POST') {
      try {
        const closed = await resetTabs();
        broadcast('browsers', browserStatus());
        return sendJson(res, 200, { ok: true, closed });
      } catch (err) {
        return sendJson(res, 503, { ok: false, error: err.message || 'নতুন ট্যাব খোলা যায়নি' });
      }
    }

    if (pathname === '/api/browser/shot' && method === 'GET') {
      let shot = null;
      try {
        shot = await captureBrowserShot();
      } catch (err) {
        return sendJson(res, 503, { error: err.message || 'স্ক্রিন তোলা যায়নি' });
      }
      if (!shot) return sendJson(res, 404, { error: 'ব্রাউজার খোলা নেই' });
      res.writeHead(200, {
        'content-type': 'image/jpeg',
        'cache-control': 'no-store',
        'content-length': shot.buffer.length
      });
      return res.end(shot.buffer);
    }

    if (pathname === '/api/screen/live' && method === 'GET') {
      const minAge =
        shareUntil > Date.now() ? 1100 : Math.max(2500, Number(url.searchParams.get('ms')) || 4000);
      const cached = liveShot.file && Date.now() - liveShot.at < minAge && fs.existsSync(liveShot.file);
      if (!cached) {
        if (!liveShot.busy) {
          const previous = liveShot.file;
          liveShot.busy = captureScreenFile().then((r) => {
            liveShot = { at: Date.now(), file: r.file, busy: null };
            if (previous && previous !== r.file) fs.unlink(previous, () => {});
          });
        }
        try {
          await liveShot.busy;
        } catch (err) {
          liveShot = { at: 0, file: '', busy: null };
          return sendJson(res, 503, { error: err.message || 'স্ক্রিন তোলা যায়নি' });
        }
      }
      const buf = fs.readFileSync(liveShot.file);
      res.writeHead(200, {
        'content-type': 'image/png',
        'cache-control': 'no-store',
        'content-length': buf.length,
        'x-shot-at': String(liveShot.at)
      });
      return res.end(buf);
    }

    if (pathname === '/api/screen/crop' && method === 'POST') {
      const body = await readBody(req);
      try {
        const { file, rect, size, origin } = await captureCropFile({
          x: Number(body.x),
          y: Number(body.y),
          w: Number(body.w),
          h: Number(body.h)
        });
        return sendJson(res, 200, {
          ok: true,
          rect,
          origin,
          attachment: {
            name: `screen-${rect.join('x')}.png`,
            path: path.relative(WORKSPACE, file).split(path.sep).join('/'),
            mime: 'image/png',
            size
          }
        });
      } catch (err) {
        return sendJson(res, 400, { error: err.message || 'স্ক্রিনের অংশ তোলা যায়নি' });
      }
    }

    if (pathname === '/api/pick' && method === 'POST') {
      const body = await readBody(req);
      // ওয়াচডগকে বলে দিই হ্যাটকে আগে তুলছে না — নাহলে স্নিপিং ওভারলের উপর হ্যাট ভেসে থাকে
      saveWidgetState({ pick: true });
      try {
        const r = await pickScreen({ mode: String(body.mode || 'region'), secs: Number(body.secs) });
        return sendJson(res, 200, r);
      } catch (err) {
        return sendJson(res, 503, { error: err.message || 'সিলেক্ট ওভারলে চালু করা যায়নি' });
      } finally {
        saveWidgetState({ pick: false });
      }
    }

    if (pathname === '/api/show' && method === 'POST') {
      const body = await readBody(req);
      if (body.action === 'share') {
        shareUntil = body.on ? Date.now() + 10 * 60 * 1000 : 0;
        broadcast('show', { share: Boolean(body.on), until: shareUntil });
      }
      return sendJson(res, 200, { ok: true, share: shareUntil > Date.now(), until: shareUntil });
    }

    if (pathname === '/api/config' && method === 'PUT') {
      const body = await readBody(req);
      const saved = saveConfig(body);
      // কী/মডেল বদলালে পুরনো ব্যর্থ-কুলডাউন ভেঙে দাও — নতুন কী সঙ্গে সঙ্গে ইমপায়ার্ড হবে
      resetLane('');
      broadcast('config', saved);
      return sendJson(res, 200, saved);
    }

    if (pathname === '/api/providers/test' && method === 'POST') {
      const body = await readBody(req);
      const kind = body.kind === 'gemini' ? 'gemini' : 'openai';
      const result = await probeProvider({
        kind,
        apiKey: String(body.apiKey || ''),
        baseUrl: String(body.baseUrl || ''),
        model: String(body.model || '')
      });
      console.log(`[api-test] ${kind} ${result.ok ? `✓ ${result.ms}ms` : `✗ ${result.code}`}`);
      return sendJson(res, 200, result);
    }

    // লেনের অবস্থা + নতুন কী সেভ করলে কুলডাউন ভাঙা
    if (pathname === '/api/lanes' && method === 'GET') {
      return sendJson(res, 200, {
        lanes: laneStatus(),
        apiAvailable: apiAvailable(),
        mode: routeMode(),
        webAllowed: webAllowed()
      });
    }

    if (pathname === '/api/lanes/reset' && method === 'POST') {
      const body = await readBody(req);
      resetLane(body.id ? String(body.id) : '');
      return sendJson(res, 200, { ok: true, lanes: laneStatus() });
    }

    if (pathname === '/api/bot' && method === 'PUT') {
      const body = await readBody(req);
      const cfg = loadConfig();
      const bot = cfg.bots.find((b) => b.id === body.id);
      if (!bot) return sendJson(res, 404, { error: 'বট পাওয়া যায়নি' });
      for (const key of ['name', 'system', 'provider', 'account', 'group']) {
        if (body[key] != null) bot[key] = body[key];
      }
      const saved = saveConfig(cfg);
      broadcast('config', saved);
      return sendJson(res, 200, { ok: true, bot: saved.bots.find((b) => b.id === body.id) });
    }

    if (pathname === '/api/tts' && method === 'GET') {
      const text = String(url.searchParams.get('text') || '').trim().slice(0, 500);
      if (!text) return sendJson(res, 400, { error: 'বলার জন্য text দরকার' });
      const gurl = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=bn&q=${encodeURIComponent(text)}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20_000);
      try {
        const r = await fetch(gurl, {
          signal: controller.signal,
          headers: {
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
            accept: 'audio/mpeg,*/*'
          }
        });
        if (!r.ok) return sendJson(res, 502, { error: 'TTS সার্ভিস সাড়া দেয়নি' });
        const buf = Buffer.from(await r.arrayBuffer());
        const type = r.headers.get('content-type') || 'audio/mpeg';
        res.writeHead(200, {
          'content-type': type.startsWith('audio/') ? type : 'audio/mpeg',
          'cache-control': 'no-store',
          'content-length': buf.length
        });
        return res.end(buf);
      } catch {
        return sendJson(res, 502, { error: 'TTS সার্ভিস সাড়া দেয়নি' });
      } finally {
        clearTimeout(timer);
      }
    }

    if (pathname === '/api/phone/pair' && method === 'POST') {
      const body = await readBody(req);
      const device = pairDevice({ name: body.name, ua: body.ua || req.headers['user-agent'], req });
      broadcast('devices', listDevices());
      return sendJson(res, 200, { ok: true, device });
    }

    if (pathname === '/api/phone/beat' && method === 'POST') {
      const body = await readBody(req);
      const r = beatDevice(String(body.id || ''), { ...body, req });
      if (!r) return sendJson(res, 404, { error: 'ডিভাইসটি paired নয় — /phone আবার খুলুন' });
      return sendJson(res, 200, { ok: true, commands: r.commands, online: true });
    }

    if (pathname === '/api/phone/frame' && method === 'POST') {
      const body = await readBody(req, 8_000_000);
      const r = saveFrame(String(body.id || ''), body.dataUrl);
      if (!r.ok) return sendJson(res, 404, { error: r.error });
      broadcast('phone_frame', { id: body.id, file: r.file });
      return sendJson(res, 200, r);
    }

    if (pathname === '/api/phone/stream' && method === 'GET') {
      const id = String(url.searchParams.get('id') || '');
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'x-accel-buffering': 'no'
      });
      if (!attachDeviceStream(id, res, req)) {
        res.write('event: error\ndata: {"error":"not paired"}\n\n');
        return res.end();
      }
      const ping = setInterval(() => {
        try {
          res.write(': ping\n\n');
        } catch {
          /* ignore */
        }
      }, 15_000);
      req.on('close', () => clearInterval(ping));
      return;
    }

    if (pathname === '/api/phone/screen' && method === 'GET') {
      const frame = latestFrame(String(url.searchParams.get('id') || ''));
      if (!frame) return sendJson(res, 404, { error: 'ফোনের কোনো স্ক্রিনশট নেই — ফোনের অ্যাপে 📸 স্ক্রিনশট পাঠাও বোতামটা ব্যবহার করুন' });
      res.writeHead(200, {
        'content-type': frame.file.endsWith('.jpg') ? 'image/jpeg' : 'image/png',
        'cache-control': 'no-store',
        'content-length': fs.statSync(frame.file).size
      });
      return fs.createReadStream(frame.file).pipe(res);
    }

    if (pathname === '/api/devices' && method === 'GET') {
      return sendJson(res, 200, { ok: true, devices: listDevices() });
    }

    if (pathname === '/api/device/command' && method === 'POST') {
      const body = await readBody(req);
      const { id, all, type, name, ...rest } = body;
      if (!type) return sendJson(res, 400, { error: 'type দরকার' });
      const spec = { type, ...rest };
      const r = all || !id ? broadcastCommand(spec) : pushCommand(String(id), spec);
      return sendJson(res, r.ok ? 200 : 404, r);
    }

    if (pathname === '/api/device/rename' && method === 'POST') {
      const body = await readBody(req);
      const d = renameDevice(String(body.id || ''), body.name);
      if (!d) return sendJson(res, 404, { error: 'ডিভাইস নেই' });
      broadcast('devices', listDevices());
      return sendJson(res, 200, { ok: true, device: d });
    }

    if (pathname === '/api/device' && method === 'DELETE') {
      const body = await readBody(req);
      forgetDevice(String(body.id || ''));
      broadcast('devices', listDevices());
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === '/api/health') {
      return sendJson(res, 200, { ok: true, queue: queueInfo(), browsers: browserStatus() });
    }

    if (pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'রুট নেই' });

    if ((pathname === '/phone' || pathname === '/phone/') && (method === 'GET' || method === 'HEAD')) {
      return serveStatic(req, res, '/phone.html');
    }

    if ((pathname === '/setup' || pathname === '/setup/') && (method === 'GET' || method === 'HEAD')) {
      return serveStatic(req, res, '/setup.html');
    }

    if (pathname === '/widget' && (method === 'GET' || method === 'HEAD')) {
      return serveStatic(req, res, '/widget.html');
    }

    if (method === 'GET' || method === 'HEAD') return serveStatic(req, res, pathname);
    res.writeHead(405);
    res.end('method not allowed');
  } catch (err) {
    sendJson(res, 500, { error: err.message || 'server error' });
  }
}

const server = http.createServer(handleRequest);

// ফোনের ব্রাউজারে মাইক আর স্ক্রিন-ক্যাপচার চলতে হলে secure context লাগবে,
// তাই একই হ্যান্ডলার HTTPS-এও শোনে (শুধু LAN, পাসকি দিয়ে সুরক্ষিত)।
let secureServer = null;
try {
  const bundle = ensureCert();
  secureServer = https.createServer({ key: bundle.key, cert: bundle.cert }, handleRequest);
} catch (err) {
  console.log(`  HTTPS (ফোন লেন) চালু করা যায়নি: ${err.message}`);
}

// হাটের এনফোর্সার এই ল্যাপটপে বারবার মরে যায় (RAM টান) — widget.json তখনও running:true
// থাকে, তাই ছাপা না মিললে নিজেই আবার তুলি, কিন্তু ক্রমশ দূরত্ব বাড়িয়ে (১→৫→২০ মিনিট)
// যাতে মৃত এজের পেছনে পাগলের মতো powershell না জমে
const hatWatch = { next: 0, fails: 0 };
setInterval(() => {
  if (widgetAlive()) { hatWatch.fails = 0; return; }
  if (!widgetState().running || Date.now() < hatWatch.next || Date.now() < hatQuietUntil) return;
  hatWatch.fails += 1;
  hatWatch.next = Date.now() + [60e3, 300e3, 1200e3][Math.min(hatWatch.fails - 1, 2)];
  widgetTrace(`watchdog -> start (#${hatWatch.fails})`);
  runWidgetScript([]);
}, 15000);

server.listen(PORT, HOST, () => {
  const url = `http://127.0.0.1:${PORT}`;
  const phone = lanAddresses().map((ip) => `http://${ip}:${PORT}/?key=${ACCESS_KEY}`)[0];
  console.log(`\n  PC Agent চালু: ${url}`);
  console.log(`  একই WiFi (ফোন/অন্য PC): ${phone || 'LAN IP পাওয়া যায়নি — WiFi সংযোগ দেখুন'}`);
  if (secureServer) {
    secureServer.listen(SECURE_PORT, HOST, () => {
      secureLive = true;
      const p = lanAddresses().map((ip) => `https://${ip}:${SECURE_PORT}/phone?key=${ACCESS_KEY}`)[0];
      console.log(`  ফোন কন্ট্রোল (mic + 📸 স্ক্রিনশট): ${p || 'LAN IP পাওয়া যায়নি'}`);
    });
  }
  console.log(`  workspace: ${WORKSPACE}\n`);
  for (const bot of loadConfig().bots) statuses[bot.id] = statuses[bot.id] || 'idle';
  for (const task of pendingTasks) enqueue(task, hooks);
  if (!process.env.NO_OPEN) {
    spawn('cmd.exe', ['/d', '/s', '/c', `start "" "${url}"`], { detached: true, stdio: 'ignore' }).unref();
  }
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    console.log('\nবন্ধ হচ্ছে…');
    await closeBrowsers();
    process.exit(0);
  });
}
