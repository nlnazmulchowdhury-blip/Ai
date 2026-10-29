/* এজেন্ট হাট — পর্দার ডান কোণায় সবসময় থাকা চেট পিল */
const $ = (id) => document.getElementById(id);
const body = document.body;
const thread = $('thread');
const input = $('input');

const LOG_KEY = 'agent.widget.log';
const HIST_KEY = 'agent.widget.hist';
const SPEAK_KEY = 'agent.widget.speak';
const MAX_LINES = 400;

const SAMPLE = [
  { k: 'me', t: 'ইউটিউব ওপেন করো' },
  { k: 'step', t: '✓ Terabox ডেটা মিলেছে (open-youtube) → open_url' },
  { k: 'ai', t: 'YouTube Open করা হয়েছে ✅' }
];

let log = read(LOG_KEY, []);
let speaking = read(SPEAK_KEY, true);
let mode = 'expanded';
let myTasks = new Set();
let seen = {};
let running = null;
let pending = [];

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 3;

$('btn-voice').setAttribute('aria-pressed', String(speaking));

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* localStorage না চললেও কাজ চলবে */
  }
}

function line(k, t, cls) {
  const el = document.createElement('p');
  el.className = `ln ${cls || k}`;
  el.textContent = t;
  thread.appendChild(el);
  thread.scrollTop = thread.scrollHeight;
  return el;
}

function paint() {
  thread.innerHTML = '';
  if (!log.length) {
    for (const s of SAMPLE) line(s.k, s.t).style.opacity = '0.5';
    line('note', 'বলো কী করতে হবে — টাইপ করো, 🎤 চাপো, বা 📎 ছবি/ভিডিও দাও।').style.opacity = '0.5';
    return;
  }
  for (const entry of log) line(entry.k, entry.t);
  thread.scrollTop = thread.scrollHeight;
}

function push(k, t) {
  log.push({ k, t, at: Date.now() });
  if (log.length > MAX_LINES) log = log.slice(-MAX_LINES);
  write(LOG_KEY, log);
  if (log.length === 1) thread.innerHTML = '';
  line(k, t);
  // ভয়েস স্ক্রিন খোলা থাকলে প্রতিটি ধাপ ওখানেই দেখায় — চেটে পাঠাতে হয় না
  if (k !== 'me') voiceSay(t);
}

function sub(text) {
  $('sub').textContent = text;
  $('pill-text').textContent = running ? 'চলছে…' : 'জিজ্ঞেস করো…';
}

function applyMode(next) {
  if (next !== 'collapsed' && next !== 'expanded') next = 'expanded';
  if (next === mode) return;
  mode = next;
  body.dataset.mode = next;
  // ভাঁজ করা সরু উইন্ডোতে ওভারলে ঢুকে থাকলে কাটা দেখায় — ভাঁজের আগে দুটোই বন্ধ
  if (next === 'collapsed') {
    if (body.dataset.voice === 'on') setVoice(false);
    if (body.dataset.show === 'on') setShow(false);
  }
  if (next === 'expanded') {
    $('panel').classList.remove('reveal');
    void $('panel').offsetWidth;
    $('panel').classList.add('reveal');
    input.focus();
  }
}

function setMode(next, via) {
  applyMode(next);
  fetch('/api/widget', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'state', mode, via: via || '?' })
  }).catch(() => {});
}

// ড্যাশবোর্ড/ফোন/শর্টকাট যেকোনো দিক থেকে ভাঁজ খুললে পাতাটাও সেই অবস্থা ধরে রাখে
async function syncMode() {
  try {
    const r = await fetch('/api/widget');
    if (!r.ok) return;
    const j = await r.json();
    if (j.mode && j.mode !== mode) applyMode(j.mode);
  } catch {
    /* সার্ভার ওঠার আগে পাতা খুললে পরের টিকেটে মিলে যাবে */
  }
}
setInterval(syncMode, 1400);

function speak(text, done) {
  if (!speaking || !window.speechSynthesis) {
    if (done) done();
    return;
  }
  const utter = new SpeechSynthesisUtterance(String(text).slice(0, 300));
  utter.lang = 'bn-BD';
  if (done) {
    let fired = false;
    const off = () => {
      if (fired) return;
      fired = true;
      done();
    };
    utter.onend = off;
    utter.onerror = off;
    // সিন্থেসিস হঠাৎ রিসেট করলেও মাইক আবার খুলতে হবে
    setTimeout(off, 25000);
  }
  speechSynthesis.cancel();
  speechSynthesis.speak(utter);
}

/* ---------- সংযুক্তি: ছবি/ভিডিও এজেন্টকে দেওয়া ---------- */
function fmtSize(bytes) {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${bytes}B`;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = () => reject(new Error(`${file.name} পড়া যায়নি`));
    reader.readAsDataURL(file);
  });
}

function addFiles(list) {
  for (const file of list || []) {
    if (pending.length + shows.length >= MAX_FILES) {
      push('note', `একসাথে সর্বোচ্চ ${MAX_FILES}টি সংযুক্তি (ফাইল + দেখানো)`);
      break;
    }
    if (!file.size) {
      push('note', `${file.name} খালি ফাইল`);
      continue;
    }
    if (file.size > MAX_BYTES) {
      push('note', `${file.name} অনেক বড় — সর্বোচ্চ ২৫MB`);
      continue;
    }
    if (pending.some((f) => f.name === file.name && f.size === file.size)) continue;
    pending.push(file);
  }
  renderChips();
  syncComposer();
}

function renderChips() {
  const box = $('chips');
  box.innerHTML = '';
  const items = [
    ...pending.map((file, index) => ({
      tag: file.type.startsWith('video/') ? 'ভিডিও' : file.type.startsWith('image/') ? 'ছবি' : 'ফাইল',
      name: file.name,
      size: fmtSize(file.size),
      off: () => {
        pending.splice(index, 1);
        renderChips();
        syncComposer();
      }
    })),
    ...shows.map((s, index) => ({
      tag: showTag(s),
      name: showDetail(s),
      size: '',
      off: () => {
        shows.splice(index, 1);
        renderChips();
        syncComposer();
        $('btn-show').classList.toggle('on', Boolean(shows.length));
      }
    }))
  ];
  box.hidden = !items.length;
  $('btn-clip').classList.toggle('on', Boolean(pending.length));
  $('btn-show').classList.toggle('on', Boolean(shows.length));
  items.forEach((item) => {
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.title = item.name;
    const kind = document.createElement('i');
    kind.textContent = item.tag;
    const name = document.createElement('span');
    name.textContent = item.name;
    const size = document.createElement('em');
    size.textContent = item.size;
    const x = document.createElement('button');
    x.type = 'button';
    x.textContent = '×';
    x.setAttribute('aria-label', 'সরাও');
    x.addEventListener('click', item.off);
    chip.append(kind, name, size, x);
    box.appendChild(chip);
  });
}

async function send() {
  const said = input.value.trim();
  if (!said && !pending.length && !shows.length) return;
  const files = pending.slice();
  const shown = shows.slice();
  const marker = showMarker();
  const text = said || (shown.length ? 'সংযুক্ত ছবিতে যেটা দেখিয়েছি সেটাই নিয়ে বলছি।' : '');
  input.value = '';
  pending = [];
  shows = [];
  renderChips();
  syncComposer();
  const marks = [];
  if (shown.length) marks.push(`👁 ${shown.length} দেখানো`);
  if (files.length) marks.push(`📎 ${files.map((f) => f.name).join(', ')}`);
  push('me', `${text}${marks.length ? ` · ${marks.join(' · ')}` : ''}`);
  sub('পাঠাচ্ছে…');
  // ভয়েস মোডে কাজ গেলে স্ক্রিনটা খোলাই থাকে — উত্তর চেটে না গিয়ে ভয়েজেই ফেরত আসে
  voiceSay('পাঠাচ্ছে…');
  try {
    const attachments = shown.map((s) => s.attachment).filter(Boolean);
    for (const file of files) {
      sub(`ফাইল পাঠাচ্ছে: ${file.name}`);
      const up = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: file.name, mime: file.type, data: await fileToBase64(file) })
      });
      const uj = await up.json().catch(() => ({}));
      if (!up.ok || !uj.attachment) throw new Error(uj.error || `${file.name} পাঠানো যায়নি`);
      attachments.push(uj.attachment);
    }
    const r = await fetch('/api/task', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: `${marker}${text}`, attachments })
    });
    const j = await r.json();
    const task = j.task;
    if (!task) throw new Error(j.error || 'কাজ তৈরি হয়নি');
    myTasks.add(task.id);
    seen[task.id] = 0;
    if (task.status === 'running' || task.status === 'queued') running = task;
    syncRun();
  } catch (err) {
    push('note', `✗ পাঠানো যায়নি: ${err.message}`);
    sub('সার্ভার সাড়া দিচ্ছে না');
  }
}

const TURN_KINDS = new Set(['bot', 'tool', 'boss', 'eye', 'team', 'note']);

function renderTurns(task) {
  const start = seen[task.id] || 0;
  for (const turn of task.turns.slice(start)) {
    if (!TURN_KINDS.has(turn.kind)) continue;
    if (turn.kind === 'tool') {
      for (const res of turn.results || []) {
        const out = String(res.output || res.error || '').split('\n')[0].slice(0, 200);
        push('step', `${res.ok ? '✓' : '✗'} ${res.tool}${out ? ` — ${out}` : ''}`);
      }
    } else if (turn.say) {
      push(turn.kind === 'bot' ? 'ai' : 'note', turn.kind === 'team' ? `দল: ${turn.say}` : String(turn.say).slice(0, 300));
    }
  }
  seen[task.id] = task.turns.length;
}

function syncComposer() {
  // পাঠাও আর ভয়েস-ওয়েভ একই স্লটে — লেখা, ফাইল, দেখানো বা চলমান কাজ থাকলে পাঠাও, না হলে ওয়েভফর্ম
  $('comp-bar').classList.toggle(
    'typing',
    Boolean(input.value.trim()) || Boolean(running) || Boolean(pending.length) || Boolean(shows.length)
  );
}

function syncRun() {
  $('btn-send').textContent = running ? 'থামাও' : 'পাঠাও';
  $('pill').classList.toggle('busy', Boolean(running));
  if (running) sub(running.status === 'queued' ? 'লাইনে আছে…' : 'চলছে…');
  syncComposer();
}

function finish(task) {
  const text = String(task.result || task.error || '').trim();
  if (text) push('ai', text);
  if (body.dataset.voice === 'on') {
    // ভয়েস স্ক্রিন খোলা থাকলে উত্তর চেটে ফেলা হয় না — মাইক থেমে কথায় ফেরত দেয়, শেষ হলে আবার শোনে
    stopMic(true);
    if (text) {
      voiceSay(text);
      sub('ভয়েজে বলছি…');
      body.dataset.speaking = '1';
      speak(text.replace(/[^\p{L}\p{M}\p{N}\s।✅✗]/gu, ''), resumeVoice);
    } else {
      resumeVoice();
    }
  } else if (text) {
    speak(text.replace(/[^\p{L}\p{M}\p{N}\s।✅✗]/gu, ''));
  }
  running = null;
  syncRun();
  sub('প্রস্তুত');
}

/* ---------- live feed ---------- */
function connect() {
  const es = new EventSource('/api/events');
  es.addEventListener('hello', (event) => {
    const state = JSON.parse(event.data);
    const live = (state.tasks || []).find((t) => t.status === 'running' || t.status === 'queued');
    if (live && !running) {
      running = live;
      myTasks.add(live.id);
      seen[live.id] = seen[live.id] || live.turns.length;
      syncRun();
    }
  });
  es.addEventListener('task', (event) => {
    const task = JSON.parse(event.data);
    if (!myTasks.has(task.id)) {
      if (task.status === 'running' && !running) {
        myTasks.add(task.id);
        seen[task.id] = 0;
        running = task;
        push('me', task.prompt);
        syncRun();
      } else return;
    }
    renderTurns(task);
    if (task.status === 'done' || task.status === 'error' || task.status === 'cancelled') {
      if (running && running.id === task.id) finish(task);
    } else {
      running = task;
      syncRun();
    }
  });
  es.onerror = () => sub('সংযোগ বিচ্ছিন্ন — আবার চেষ্টা হচ্ছে…');
}

/* ---------- দেখাও মোড: স্ক্রিন থেকে ঘেরা/ছোঁয়া/উইন্ডো বেছে এজেন্টকে বোঝানো ---------- */
let showTool = 'region';
let shows = [];
let shotOrigin = [0, 0];
let shotSize = [1920, 1080];
let shotTimer = null;
let liveOn = false;
let drag = null;

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function showHint(t) {
  $('show-hint').textContent = t;
}

async function pullShot() {
  const img = $('shot-img');
  try {
    const r = await fetch(`/api/screen/live?ms=1100&t=${Date.now()}`);
    if (!r.ok) throw new Error('ছবি আসেনি');
    const url = URL.createObjectURL(await r.blob());
    const prev = img.src;
    img.onload = () => {
      if (img.naturalWidth) shotSize = [img.naturalWidth, img.naturalHeight];
    };
    img.src = url;
    if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
  } catch {
    showHint('স্ক্রিনের ছবি আসেনি — সার্ভার চালু আছে তো?');
  }
}

// ছবির পিক্সেল → আসল স্ক্রিনের সমন্বয়
function imgPoint(clientX, clientY) {
  const box = $('shot').getBoundingClientRect();
  const nx = clamp(Math.round(((clientX - box.left) / box.width) * shotSize[0]), 0, shotSize[0] - 1);
  const ny = clamp(Math.round(((clientY - box.top) / box.height) * shotSize[1]), 0, shotSize[1] - 1);
  return [nx, ny];
}

function drawBox() {
  const el = $('shot-box');
  const host = $('shot').getBoundingClientRect();
  const a = imgPoint(drag.x0, drag.y0);
  const b = imgPoint(drag.x1, drag.y1);
  const x = Math.min(a[0], b[0]);
  const y = Math.min(a[1], b[1]);
  const w = Math.abs(a[0] - b[0]);
  const h = Math.abs(a[1] - b[1]);
  el.hidden = false;
  el.style.left = `${(x / shotSize[0]) * host.width}px`;
  el.style.top = `${(y / shotSize[1]) * host.height}px`;
  el.style.width = `${(w / shotSize[0]) * host.width}px`;
  el.style.height = `${(h / shotSize[1]) * host.height}px`;
  return [x, y, w, h];
}

async function crop(rect) {
  const r = await fetch('/api/screen/crop', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ x: rect[0], y: rect[1], w: rect[2], h: rect[3] })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.attachment) throw new Error(j.error || 'স্ক্রিনের অংশ তোলা যায়নি');
  if (Array.isArray(j.origin)) shotOrigin = j.origin;
  return { attachment: j.attachment, rect: j.rect };
}

async function addShow(entry) {
  if (shows.length + pending.length >= MAX_FILES) {
    showHint(`একসাথে ${MAX_FILES}টি সংযুক্তি — আগে একটা সরাও`);
    return;
  }
  shows.push(entry);
  renderChips();
  syncComposer();
  showHint(`✓ ${showName(entry)}`);
  $('btn-show').classList.add('on');
}

// টুলগুলোর নিজের ক্রপ ব্যর্থ হলে চিপ না বসিয়ে হিন্টেই কারণ দেখায়
async function tryShow(promise) {
  try {
    await promise;
  } catch (err) {
    showHint(`✗ ${err.message}`);
  }
}

function addRegion(rect) {
  return crop(rect).then(({ attachment, rect: got }) =>
    addShow({ kind: 'region', rect: got, abs: [shotOrigin[0] + got[0], shotOrigin[1] + got[1]], attachment })
  );
}

function addPoint(nx, ny) {
  const w = Math.min(320, shotSize[0]);
  const h = Math.min(220, shotSize[1]);
  const x = clamp(nx - (w >> 1), 0, shotSize[0] - w);
  const y = clamp(ny - (h >> 1), 0, shotSize[1] - h);
  return crop([x, y, w, h]).then(({ attachment }) =>
    addShow({ kind: 'point', abs: [shotOrigin[0] + nx, shotOrigin[1] + ny], attachment })
  );
}

function addFull() {
  return crop([0, 0, shotSize[0], shotSize[1]]).then(({ attachment }) =>
    addShow({ kind: 'full', abs: [shotOrigin[0], shotOrigin[1]], attachment })
  );
}

// স্ক্রিনের বাইরে পিকার-উইন্ডো বেছে নিলে তার আসল রেক্টটাই ক্রপ হয়
function addWindow(rect, title) {
  return crop(rect).then(({ attachment, rect: got }) =>
    addShow({
      kind: 'window',
      title,
      rect: got,
      abs: [shotOrigin[0] + got[0], shotOrigin[1] + got[1]],
      attachment
    })
  );
}

// পুরো ডেস্কটপ জুড়ে স্নিপিং ওভারলে — হ্যাটের ছোট ছবির ভেতর ঘেরতে হয় না
// openPanel=false মানে কম্পোজার থেকে এসেছে: দেখাও-প্যানেল না খুলে চিপটা কম্পোজারেই বসে
async function pickAdd(kind, openPanel = true) {
  if (openPanel && body.dataset.show !== 'on') setShow(true);
  clearInterval(shotTimer);
  shotTimer = null;
  const snipBtn = $('btn-snip');
  snipBtn.classList.add('on');
  showHint('পুরো স্ক্রিনে ঘেরো — এক ক্লিকে পুরো উইন্ডো, Shift+ক্লিকে বিন্দু');
  try {
    const r = await fetch('/api/pick', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: kind })
    });
    const j = await r.json().catch(() => ({}));
    if (j.cancelled) {
      showHint('বাতিল হয়েছে — আবার চাপ দিলে পুরো স্ক্রিন জুড়ে ঘেরা যাবে');
    } else if (!r.ok || !j.ok) {
      throw new Error(j.error || 'সিলেক্ট ওভারলে চালু হয়নি');
    } else if (j.kind === 'point') {
      await tryShow(addPoint(j.point[0], j.point[1]));
    } else if (j.kind === 'window') {
      await tryShow(addWindow(j.rect, j.title));
    } else {
      await tryShow(addRegion(j.rect));
    }
  } catch (err) {
    showHint(`✗ ${err.message}`);
  } finally {
    snipBtn.classList.remove('on');
  }
  if (body.dataset.show === 'on' && !shotTimer) shotTimer = setInterval(pullShot, 2200);
}

function showTag(s) {
  return s.kind === 'region' ? 'অংশ' : s.kind === 'point' ? 'পয়েন্ট' : s.kind === 'full' ? 'স্ক্রিন' : 'উইন্ডো';
}

function showName(s) {
  if (s.kind === 'region') return `অংশ ${s.rect[0]},${s.rect[1]} ${s.rect[2]}×${s.rect[3]}`;
  if (s.kind === 'point') return `পয়েন্ট ${s.abs[0]},${s.abs[1]}`;
  if (s.kind === 'full') return 'পুরো স্ক্রিন';
  return `উইন্ডো: ${s.title || s.name}`;
}

function showDetail(s) {
  if (s.kind === 'region') return `${s.rect[0]},${s.rect[1]} ${s.rect[2]}×${s.rect[3]}`;
  if (s.kind === 'point') return `${s.abs[0]},${s.abs[1]}`;
  if (s.kind === 'full') return 'পুরোটা';
  return s.title || s.name;
}

function showMarker() {
  const bits = shows.map((s) => {
    if (s.kind === 'region') return `স্ক্রিনের অংশ ${s.rect[0]},${s.rect[1]} ${s.rect[2]}×${s.rect[3]} (বাম-উপরের কোণ ${s.abs[0]},${s.abs[1]}) — সংযুক্ত ছবিতে ঘেরা অংশটুকুই আছে`;
    if (s.kind === 'point') return `স্ক্রিনের পয়েন্ট ${s.abs[0]},${s.abs[1]} — ওই জায়গার কাছের ছবি সংযুক্ত`;
    if (s.kind === 'full') return 'পুরো স্ক্রিনের ছবি সংযুক্ত';
    if (s.rect) return `উইন্ডো "${s.title}" — স্ক্রিনের ${s.abs[0]},${s.abs[1]} থেকে ${s.rect[2]}×${s.rect[3]} অংশ, সংযুক্ত ছবিতে পুরো উইন্ডোটা আছে`;
    return `উইন্ডো: "${s.title}" (প্রোগ্রাম ${s.name})`;
  });
  if (liveOn) bits.push('ইউজার লাইভ স্ক্রিন শেয়ার করছেন — see_screen/screen_capture যেকোনো সময় একদম তাজা ছবি পাবে');
  return bits.length ? `[দেখানো · ${bits.join(' · ')}] ` : '';
}

function setTool(next) {
  showTool = next;
  $('t-region').classList.toggle('on', next === 'region');
  $('t-point').classList.toggle('on', next === 'point');
  showHint(next === 'point' ? 'স্ক্রিনে যে জায়গাটা বলছো সেখানে চাপ দাও' : 'পুরো স্ক্রিন জুড়ে টেনে ঘেরো — এই ছবির ভেতরে নয়');
}

async function toggleLive() {
  try {
    const r = await fetch('/api/show', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'share', on: !liveOn })
    });
    const j = await r.json();
    liveOn = Boolean(j.share);
  } catch {
    liveOn = !liveOn;
  }
  $('s-live').classList.toggle('on', liveOn);
  showHint(liveOn ? 'লাইভ শেয়ার চালু — ১০ মিনিট ধরে তাজা স্ক্রিন' : 'লাইভ শেয়ার বন্ধ');
}

function setShow(on) {
  if (on && body.dataset.voice === 'on') setVoice(false);
  body.dataset.show = on ? 'on' : 'off';
  $('btn-show').classList.toggle('on', Boolean(shows.length));
  if (on) {
    setTool(showTool);
    pullShot();
    clearInterval(shotTimer);
    shotTimer = setInterval(pullShot, 2200);
  } else {
    clearInterval(shotTimer);
    shotTimer = null;
    drag = null;
    $('shot-box').hidden = true;
  }
}

/* ---------- voice ---------- */
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
let speakHold = false;

function setListening(on) {
  body.dataset.listening = on ? '1' : '0';
  $('btn-mic').classList.toggle('on', on);
  $('v-mic').classList.toggle('on', on);
}

function voiceSay(text) {
  if (body.dataset.voice === 'on') $('voice-say').textContent = text;
}

function startMic() {
  if (!SpeechRec) {
    push('note', 'এই উইন্ডোতে ভয়েস নেই — টাইপ করে লেখো');
    return;
  }
  if (rec) return;
  // মাইক চাপা মাত্রই উত্তর বলা থামে — কথা দিয়েই বাধা দেওয়া যায়
  if (window.speechSynthesis) speechSynthesis.cancel();
  speakHold = false;
  rec = new SpeechRec();
  rec.lang = 'bn-BD';
  rec.interimResults = true;
  rec.continuous = false;
  rec.onstart = () => {
    setListening(true);
    voiceSay('বলো…');
  };
  rec.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const t = event.results[i][0].transcript;
      if (event.results[i].isFinal) input.value = (input.value + ' ' + t).trim();
      else interim += t;
    }
    sub(interim ? `শুনছি: ${interim}` : 'শুনছি…');
    voiceSay(interim || input.value.trim() || 'বলো…');
    syncComposer();
  };
  rec.onerror = (event) => push('note', `🎤 ${event.error === 'not-allowed' ? 'মাইকের অনুমতি দাও' : 'কোনো কথা শোনা যায়নি'}`);
  rec.onend = () => {
    setListening(false);
    rec = null;
    // উত্তর বলার আগে মাইক থামানো হলে এখানে কাজ পাঠানো হয় না — speak() শেষে নিজের আবার খুলবে
    if (speakHold) {
      speakHold = false;
      input.value = '';
      syncComposer();
      return;
    }
    sub('প্রস্তুত');
    if (input.value.trim()) send();
    else voiceSay('কিছু শোনা যায়নি — আবার বলো');
  };
  rec.start();
}

function stopMic(forSpeak) {
  speakHold = Boolean(forSpeak);
  if (rec) rec.stop();
}

function resumeVoice() {
  if (body.dataset.voice !== 'on') return;
  body.dataset.speaking = '0';
  voiceSay('বলো…');
  sub('শুনছি…');
  startMic();
}

function toggleMic() {
  if (rec) stopMic();
  else startMic();
}

function setVoice(on) {
  body.dataset.voice = on ? 'on' : 'off';
  if (on) {
    $('voice-say').textContent = 'বলো…';
    startMic();
  } else {
    body.dataset.speaking = '0';
    if (window.speechSynthesis) speechSynthesis.cancel();
    stopMic();
  }
}

function toggleSpeak() {
  speaking = !speaking;
  write(SPEAK_KEY, speaking);
  $('btn-voice').setAttribute('aria-pressed', String(speaking));
  $('v-voice').classList.toggle('on', speaking);
}

/* ---------- wiring ---------- */
// e.detail = 0 হলে ক্লিকটা নকল (প্রোগ্রাম্যাটিক), 1 হলে সত্যিকারের মাউস
$('pill').addEventListener('click', (e) => setMode('expanded', `pill-click/${e.detail}`));
$('pill').addEventListener('keydown', (e) => e.key === 'Enter' && setMode('expanded', 'pill-enter'));
$('btn-min').addEventListener('click', () => setMode('collapsed', 'min-btn'));
$('btn-mic').addEventListener('click', toggleMic);
// মাক করা বাম প্রান্তে ফাইল বোতাম — ছবি/ভিডিও বেছে এজেন্টকে দেওয়া যায়
$('btn-clip').addEventListener('click', () => $('file-in').click());
$('file-in').addEventListener('change', (e) => {
  addFiles(e.target.files);
  e.target.value = '';
});
$('btn-voice').addEventListener('click', toggleSpeak);
// মাক করা ওয়েভফর্ম = ভয়েস মোড — পুরো কোণা জুড়ে অরব আর গোল বোতাম
$('btn-wave').addEventListener('click', () => setVoice(true));
// দেখাও মোড — স্ক্রিনের ছবি টেনে ঘেরো / ছোঁয়াও / পুরো স্ক্রিন / উইন্ডো বে নাও
$('btn-show').addEventListener('click', () => setShow(body.dataset.show !== 'on'));
$('s-close').addEventListener('click', () => setShow(false));
$('s-refresh').addEventListener('click', pullShot);
$('s-live').addEventListener('click', toggleLive);
// টুলে চাপলেই পুরো ডেস্কটপ জুড়ে স্নিপিং ওভারলে ওঠে — হ্যাটের ভেতরের ছবিতে ঘেরা লাগে না
$('t-region').addEventListener('click', () => {
  setTool('region');
  pickAdd('region');
});
// কম্পোজারের লেবেলা বোতাম — এক চাপেই পুরো ডেস্কটপের সিলেক্ট ওভারলে, প্যানেল না খুলেই চিপ
$('btn-snip').addEventListener('click', () => {
  setTool('region');
  pickAdd('region', false);
});
$('t-point').addEventListener('click', () => {
  setTool('point');
  pickAdd('point');
});
$('t-full').addEventListener('click', () => tryShow(addFull()));
$('t-win').addEventListener('click', () => pickAdd('window'));
$('shot').addEventListener('pointerdown', (e) => {
  if (showTool !== 'region' && showTool !== 'point') return;
  e.preventDefault();
  // ক্যাপচার ব্যর্থ হলেও (পেন/সিন্থেটিক ইভেন্ট) ঘেরা-অংশ নাড়া বন্ধ হবে না
  try {
    $('shot').setPointerCapture(e.pointerId);
  } catch {}
  $('shot-dot').hidden = true;
  drag = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY };
  if (showTool === 'region') drawBox();
});
$('shot').addEventListener('pointermove', (e) => {
  if (!drag || showTool !== 'region') return;
  drag.x1 = e.clientX;
  drag.y1 = e.clientY;
  drawBox();
});
$('shot').addEventListener('pointerup', (e) => {
  if (!drag) return;
  const rect = showTool === 'region' ? drawBox() : null;
  drag = null;
  $('shot-box').hidden = true;
  const p = imgPoint(e.clientX, e.clientY);
  const tooSmall = rect && (rect[2] < 16 || rect[3] < 16);
  if (showTool === 'point' || tooSmall) {
    const host = $('shot').getBoundingClientRect();
    const dot = $('shot-dot');
    dot.hidden = false;
    dot.style.left = `${e.clientX - host.left}px`;
    dot.style.top = `${e.clientY - host.top}px`;
    tryShow(addPoint(p[0], p[1]));
  } else {
    tryShow(addRegion(rect));
  }
});
$('v-close').addEventListener('click', () => setVoice(false));
$('v-mic').addEventListener('click', toggleMic);
$('v-voice').addEventListener('click', toggleSpeak);
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (body.dataset.voice === 'on') setVoice(false);
  else if (body.dataset.show === 'on') setShow(false);
});
$('btn-clear').addEventListener('click', () => {
  if (log.length) {
    const hist = read(HIST_KEY, []);
    hist.push({ at: Date.now(), lines: log });
    write(HIST_KEY, hist.slice(-20));
    log = [];
    write(LOG_KEY, log);
  }
  seen = {};
  myTasks = new Set();
  paint();
  sub('নতুন চেট');
});
$('btn-send').addEventListener('click', () => {
  if (running) {
    fetch('/api/task/cancel', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: running.id })
    }).catch(() => {});
    push('note', 'থামানো হচ্ছে…');
    return;
  }
  send();
});
$('btn-close').addEventListener('click', () => {
  fetch('/api/widget', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'stop' })
  }).catch(() => {});
  setTimeout(() => window.close(), 250);
});
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    send();
  }
});
input.addEventListener('input', syncComposer);

paint();
connect();
syncComposer();
$('v-voice').classList.toggle('on', speaking);
// boot-এ setMode ডাকলে প্রতি রিলোডে ভাঁজ করা কোণাটা নিজের থেকে খুলে যেত — শুরুতে শুধু সার্ভারের অবস্থা পড়া হয়
syncMode();
