import { MASCOTS, mascotById, mascotSvg, mascotLayers, loadMascotId, saveMascotId } from './mascots.js';

const $ = (sel) => document.querySelector(sel);

const STATUS_LABEL = {
  idle: 'ঘুমিয়ে',
  busy: 'কাজ করছে',
  login: 'লগইন দরকার',
  error: 'সমস্যা'
};

const TASK_LABEL = {
  queued: 'অপেক্ষায়',
  running: 'চলছে',
  done: 'শেষ',
  error: 'সমস্যা',
  need_login: 'লগইন দরকার',
  cancelled: 'বাতিল'
};

let state = null;
let selectedTaskId = null;

// চেট সেশন: প্রতিটা "নতুন চেট" = আলাদা স্বাধীন চেট। পুরনো চেট "চ্যাট ইতিহাস"
// প্যানেলে জমা হয়; এক চেটের বার্তার সাথে আরেক চেটের কোনো সংযোগ নেই।
// সেশন = { id, segs: [[from,to],...], cur?: ts } — cur থাকলে সেটিই চলতি (খোলা) চেট।
const SESSIONS_KEY = 'agent.sessions';
let sessions = loadSessions();

function loadSessions() {
  try {
    const arr = JSON.parse(localStorage.getItem(SESSIONS_KEY) || 'null');
    if (Array.isArray(arr) && arr.length && arr.every((s) => s && typeof s.id === 'string' && Array.isArray(s.segs))) {
      if (!arr.some((s) => s.cur != null)) arr[arr.length - 1].cur = Date.now();
      return arr;
    }
  } catch { /* ভাঙা ডেটা — নতুন করে শুরু */ }
  return [{ id: 's' + Date.now(), segs: [], cur: 0 }];
}

function saveSessions() {
  try { localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions)); } catch {}
}

function activeSession() {
  return sessions.find((s) => s.cur != null) || null;
}

function closeActive(now) {
  const act = activeSession();
  if (!act) return;
  if (now > act.cur) act.segs.push([act.cur, now]);
  act.cur = null;
}

function sessionOf(task) {
  const ts = Number(task.createdAt);
  return sessions.find((s) => {
    if (s.cur != null && ts >= s.cur) return true;
    return (s.segs || []).some(([a, b]) => ts >= a && ts < b);
  }) || null;
}

function openSession(id) {
  const s = sessions.find((x) => x.id === id);
  if (!s || s.cur != null) return;
  closeActive(Date.now());
  s.cur = Date.now();
  saveSessions();
}

let modalSave = null;
let pendingFiles = [];
// স্ক্রিন থেকে ঘেরা অংশগুলো — ছবি আগেই workspace/uploads-এ পড়া আছে, তাই শুধু রেফারেন্স ধরে রাখি
let pendingShows = [];

const MAX_ATTACH = 25 * 1024 * 1024;
const MAX_ATTACH_FILES = 3;

// ---------- voice (মাইক → AI কথা বলে) ----------

const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
const DEFAULT_PLACEHOLDER = document.querySelector('#prompt')?.placeholder || '';

let voiceOn = false;
let voiceSuspended = false;
let voicePaused = false;
let voiceScreenOpen = false;
let voiceGreeting = false;
let voiceStage = 'idle';
let voiceBase = '';
let voiceInterim = '';
let voiceTimer = null;
let voiceIdleTimer = null;
let voiceTaskId = null;
let voiceSpoken = false;
let speakOn = false;
let recognition = null;
let starRaf = 0;
let starResizeFn = null;
const lastTaskStatus = {};
const spokeTasks = new Set();

const VOICE_STATUS = {
  idle: 'ভয়েস চ্যাট',
  listening: 'শুনছি — বলুন…',
  thinking: 'AI ভাবছে…',
  speaking: 'AI বলছে…',
  paused: 'থামানো'
};

function setVoiceStage(stage, caption = '') {
  voiceStage = stage;
  const screen = $('#voice-screen');
  if (!screen) return;
  screen.dataset.state = stage;
  const status = $('#voice-status');
  const cap = $('#voice-caption');
  if (status) status.textContent = VOICE_STATUS[stage] || VOICE_STATUS.idle;
  if (cap) cap.textContent = String(caption || '').slice(0, 160);
}

// ---------- মাসকট: ভয়েস স্ক্রিনের মাঝের কার্টুন ----------

let mascotId = loadMascotId();

function applyMascot(id, remember = true) {
  const m = mascotById(id);
  mascotId = m.id;
  const bot = $('#voice-bot');
  if (bot) bot.innerHTML = mascotLayers(m.id);
  paintGaze();
  const screen = $('#voice-screen');
  if (screen) {
    if (m.glow) screen.style.setProperty('--mascot-glow', m.glow);
    else screen.style.removeProperty('--mascot-glow');
  }
  for (const chip of document.querySelectorAll('.vp-item')) {
    const on = chip.dataset.mascot === mascotId;
    chip.classList.toggle('on', on);
    chip.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  if (remember) saveMascotId(mascotId);
}

function voicePickerOpen() {
  const box = $('#voice-picker');
  return !!box && !box.classList.contains('hidden');
}

function showVoicePicker() {
  const box = $('#voice-picker');
  if (!box) return;
  if (!box.children.length) {
    for (const m of MASCOTS) {
      const chip = el('button', {
        class: 'vp-item',
        type: 'button',
        dataset: { mascot: m.id },
        title: m.name,
        'aria-label': m.name
      });
      chip.innerHTML = mascotSvg(m.id, 'vp-svg');
      chip.addEventListener('click', () => {
        applyMascot(m.id);
        hideVoicePicker();
      });
      box.appendChild(chip);
    }
  }
  box.classList.remove('hidden');
  applyMascot(mascotId, false);
  $('#voice-mascot')?.setAttribute('aria-expanded', 'true');
}

function hideVoicePicker() {
  $('#voice-picker')?.classList.add('hidden');
  $('#voice-mascot')?.setAttribute('aria-expanded', 'false');
}

// ---------- চোখ: মাউস যেদিকে যায় কার্টুন সেদিকে তাকায় ----------

const gaze = { x: 0, y: 0, tx: 0, ty: 0 };
let gazeTimer = 0;
let lastPointer = 0;

function paintGaze() {
  const bot = $('#voice-bot');
  if (!bot) return;
  bot.style.setProperty('--gx', (gaze.x * 9).toFixed(2));
  bot.style.setProperty('--gy', (gaze.y * 6.5).toFixed(2));
}

function gazeTo(x, y) {
  const bot = $('#voice-bot');
  if (!bot) return;
  const r = bot.getBoundingClientRect();
  // মুখের কেন্দ্র থেকে পর্দার প্রান্ত পর্যন্ত দূরত্বই তার সীমা
  const span = Math.max(150, Math.min(window.innerWidth, window.innerHeight) * 0.42);
  gaze.tx = Math.max(-1, Math.min(1, (x - r.left - r.width / 2) / span));
  gaze.ty = Math.max(-1, Math.min(1, (y - r.top - r.height / 2) / span));
  lastPointer = performance.now();
}

function stepGaze(now) {
  if (now - lastPointer > 3500) {
    // মাউস স্থির থাকলে হালকা ঘোরে, যেন চোখ মৃত না লাগে
    gaze.tx = Math.sin(now / 2100) * 0.42;
    gaze.ty = Math.cos(now / 2900) * 0.28;
  }
  gaze.x += (gaze.tx - gaze.x) * 0.16;
  gaze.y += (gaze.ty - gaze.y) * 0.16;
  paintGaze();
}

window.addEventListener('pointermove', (event) => {
  if (voiceScreenOpen) gazeTo(event.clientX, event.clientY);
}, { passive: true });
window.addEventListener('pointerdown', (event) => {
  if (voiceScreenOpen) gazeTo(event.clientX, event.clientY);
}, { passive: true });

// ---------- মাঝে মাঝে নিজে থেকেই খুশি হয়ে ওঠে ----------

let happyTimer = 0;
let happyOff = 0;

function setHappy(on) {
  $('#voice-bot')?.classList.toggle('is-happy', !!on);
}

function flashHappy(ms = 2600) {
  if (!voiceScreenOpen || !mascotById(mascotId).happy) return;
  setHappy(true);
  clearTimeout(happyOff);
  happyOff = setTimeout(() => setHappy(false), ms);
}

function armHappy() {
  clearTimeout(happyTimer);
  happyTimer = setTimeout(() => {
    flashHappy(2400 + Math.random() * 1800);
    armHappy();
  }, 8000 + Math.random() * 12000);
}

// ---------- কথা বলার সময় সত্যিকারের আওয়াজ মেপে মুখ দোলে ----------

let ttsAnalyser = null;
let ttsWave = null;
let talkTimer = 0;
let talkLevel = 0;
// --vibe: ০→১ আওয়াজের মাত্রা। কার্টুনের শরীর, পুতুল, ভ্রু, গাল আর আভা সব এতেই বদলায়।
let excite = 0;
let excitedOn = false;
let vibeRef = null;

function ensureAnalyser() {
  if (ttsAnalyser || !ttsCtx) return;
  try {
    ttsAnalyser = ttsCtx.createAnalyser();
    ttsAnalyser.fftSize = 512;
    ttsAnalyser.smoothingTimeConstant = 0.5;
    ttsWave = new Uint8Array(ttsAnalyser.fftSize);
  } catch {
    ttsAnalyser = null;
  }
}

/// ইউজার কথা বলছে / মাইক চেপেছে — কার্টুন আনন্দে তৈরি হয়
function bumpExcite() {
  excite = 1;
  const screen = $('#voice-screen');
  if (screen && !excitedOn) {
    excitedOn = true;
    screen.classList.add('is-excited');
  }
}

function paintMouth(level) {
  const open = 0.55 + 1.5 * level;
  const wide = 1.1 - 0.22 * level;
  for (const m of document.querySelectorAll('#voice-bot .mouth')) {
    m.style.transform = `scale(${wide.toFixed(3)}, ${open.toFixed(3)})`;
  }
}

function calmMouth() {
  const bot = $('#voice-bot');
  if (!bot || !bot.classList.contains('talk-live')) return;
  bot.classList.remove('talk-live');
  for (const m of bot.querySelectorAll('.mouth')) m.style.removeProperty('transform');
}

function paintVibe(v) {
  if (!vibeRef) vibeRef = $('#voice-screen');
  if (vibeRef) vibeRef.style.setProperty('--vibe', v.toFixed(3));
}

function startTalkLoop() {
  if (talkTimer) return;
  talkTimer = setInterval(() => {
    let level = 0;
    if (ttsAnalyser && ttsSource) {
      ttsAnalyser.getByteTimeDomainData(ttsWave);
      let sum = 0;
      for (let i = 0; i < ttsWave.length; i++) {
        const d = (ttsWave[i] - 128) / 128;
        sum += d * d;
      }
      level = Math.min(1, Math.sqrt(sum / ttsWave.length) * 4.4);
    }
    if (!level && voiceStage === 'speaking') {
      // ব্রাউজারের নিজস্ব ভয়েস (speechSynthesis) — আওয়াজ মাপার উপায় নেই, তাই ছন্দে দোলায়
      const t = performance.now() / 1000;
      level = (0.34 + 0.3 * Math.abs(Math.sin(t * 6.4))) * (0.65 + 0.35 * Math.sin(t * 1.9));
    }
    talkLevel += (level - talkLevel) * (level > talkLevel ? 0.65 : 0.2);
    excite *= 0.972;
    const vibe = Math.max(talkLevel, excite);
    paintVibe(vibe);
    if (excitedOn && excite < 0.14) {
      excitedOn = false;
      $('#voice-screen')?.classList.remove('is-excited');
    }
    const bot = $('#voice-bot');
    if (!bot) return;
    if (talkLevel > 0.03) {
      bot.classList.add('talk-live');
      paintMouth(talkLevel);
    } else {
      talkLevel = 0;
      calmMouth();
    }
  }, 33);
}

function stopTalkLoop() {
  clearInterval(talkTimer);
  talkTimer = 0;
  talkLevel = 0;
  excite = 0;
  excitedOn = false;
  paintVibe(0);
  $('#voice-screen')?.classList.remove('is-excited');
  calmMouth();
}

async function openVoiceScreen() {
  const screen = $('#voice-screen');
  if (!screen) return;
  voiceScreenOpen = true;
  screen.classList.remove('hidden');
  hideVoicePicker();
  startStars();
  if (!gazeTimer) gazeTimer = setInterval(() => stepGaze(performance.now()), 40);
  startTalkLoop();
  bumpExcite();
  armHappy();
  try {
    const p = screen.requestFullscreen?.();
    if (p && p.catch) p.catch(() => {});
  } catch { /* overlay works without fullscreen too */ }
  setVoiceStage('speaking', 'বলুন — আমি শুনছি');
  voiceGreeting = true;
  startListening();
  await speakAloud('বলুন, কী করতে হবে — আমি শুনছি।');
  if (voiceGreeting) {
    voiceGreeting = false;
    if (voiceOn && !voiceSuspended && !voicePaused) setVoiceStage('listening', '');
  }
}

function closeVoiceScreen() {
  const screen = $('#voice-screen');
  voiceScreenOpen = false;
  clearInterval(gazeTimer);
  gazeTimer = 0;
  stopTalkLoop();
  clearTimeout(happyTimer);
  clearTimeout(happyOff);
  setHappy(false);
  if (screen) {
    screen.classList.add('hidden');
    setVoiceStage('idle');
  }
  stopStars();
  try {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  } catch { /* noop */ }
}

function startStars() {
  const cv = $('#voice-stars');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const TINTS = ['#e6efff', '#cfe2ff', '#b7d2ff', '#ffead0', '#ffd6ec'];
  const TAU = Math.PI * 2;
  let w = 0;
  let h = 0;
  let stars = [];
  let shoot = null;
  let nextShoot = performance.now() + 5000 + Math.random() * 7000;

  const build = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    w = cv.offsetWidth || window.innerWidth;
    h = cv.offsetHeight || window.innerHeight;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.max(120, Math.min(260, Math.round((w * h) / 6800)));
    stars = Array.from({ length: n }, () => {
      const big = Math.random() > 0.94;
      return {
        x: Math.random() * w,
        y: Math.random() * h,
        r: big ? 1.5 + Math.random() * 1.2 : 0.35 + Math.random() * 1,
        vy: 0.04 + Math.random() * 0.26,
        vx: (Math.random() - 0.5) * 0.05,
        ph: Math.random() * TAU,
        sp: 0.7 + Math.random() * 2.1,
        tint: TINTS[(Math.random() * TINTS.length) | 0],
        big
      };
    });
  };

  const frame = (now) => {
    if (!voiceScreenOpen || !w) return;
    ctx.clearRect(0, 0, w, h);
    for (const s of stars) {
      s.y -= s.vy;
      s.x += s.vx;
      if (s.y < -3) {
        s.y = h + 3;
        s.x = Math.random() * w;
      }
      if (s.x < -3) s.x = w + 3;
      else if (s.x > w + 3) s.x = -3;
      const a = 0.2 + 0.8 * (0.5 + 0.5 * Math.sin((now / 1000) * s.sp + s.ph));
      ctx.globalAlpha = a;
      ctx.fillStyle = s.tint;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, TAU);
      ctx.fill();
      if (s.big) {
        ctx.globalAlpha = a * 0.15;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r * 4.8, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = a * 0.42;
        ctx.strokeStyle = s.tint;
        ctx.lineWidth = 0.8;
        const L = s.r * 5.4;
        ctx.beginPath();
        ctx.moveTo(s.x - L, s.y);
        ctx.lineTo(s.x + L, s.y);
        ctx.moveTo(s.x, s.y - L);
        ctx.lineTo(s.x, s.y + L);
        ctx.stroke();
      }
    }
    if (!shoot && now > nextShoot) {
      const fromTop = Math.random() > 0.5;
      shoot = {
        x: Math.random() * w * 0.7,
        y: fromTop ? Math.random() * h * 0.35 : h * (0.4 + Math.random() * 0.4),
        vx: 5.5 + Math.random() * 3.5,
        vy: (fromTop ? 1 : -1) * (1.4 + Math.random()),
        life: 1
      };
    }
    if (shoot) {
      shoot.x += shoot.vx;
      shoot.y += shoot.vy;
      shoot.life -= 0.018;
      const tail = 90;
      const g = ctx.createLinearGradient(shoot.x, shoot.y, shoot.x - shoot.vx * 9, shoot.y - shoot.vy * 9);
      g.addColorStop(0, `rgba(232, 242, 255, ${Math.max(0, shoot.life) * 0.9})`);
      g.addColorStop(1, 'rgba(232, 242, 255, 0)');
      ctx.globalAlpha = 1;
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.7;
      ctx.beginPath();
      ctx.moveTo(shoot.x, shoot.y);
      ctx.lineTo(shoot.x - shoot.vx * 9 - tail * 0.1, shoot.y - shoot.vy * 9);
      ctx.stroke();
      if (shoot.life <= 0 || shoot.x > w + 120 || shoot.y < -120 || shoot.y > h + 120) {
        shoot = null;
        nextShoot = now + 7000 + Math.random() * 11000;
      }
    }
    ctx.globalAlpha = 1;
  };

  build();
  frame(performance.now());
  if (starResizeFn) window.removeEventListener('resize', starResizeFn);
  starResizeFn = () => {
    build();
    frame(performance.now());
  };
  window.addEventListener('resize', starResizeFn);
  stopStars();
  starRaf = requestAnimationFrame(function tick(now) {
    if (!voiceScreenOpen) return;
    frame(now);
    starRaf = requestAnimationFrame(tick);
  });
}

function stopStars() {
  if (starRaf) cancelAnimationFrame(starRaf);
  starRaf = 0;
}

function turnVoiceOff() {
  voiceOn = false;
  voiceSuspended = false;
  voicePaused = false;
  voiceGreeting = false;
  clearTimeout(voiceTimer);
  clearTimeout(voiceIdleTimer);
  stopListening();
  stopTts();
  voiceBase = '';
  voiceInterim = '';
  voiceButtons();
  closeVoiceScreen();
}

function voiceButtons() {
  const mic = $('#btn-voice');
  const spk = $('#btn-speak');
  if (mic) {
    mic.classList.toggle('active', voiceOn);
    mic.classList.toggle('paused', voiceOn && voiceSuspended);
    mic.title = voiceOn ? (voiceSuspended ? 'AI কাজ করছে — তারপর আবার শুনব' : 'ভয়েস বন্ধ করো') : 'ভয়েসে কথা বলো';
  }
  if (spk) {
    spk.classList.toggle('active', speakOn);
    spk.title = speakOn ? 'AI ভয়েস বন্ধ করো' : 'AI ভয়েজে উত্তর দিক';
  }
  const vmic = $('#voice-mic');
  if (vmic) vmic.classList.toggle('active', voiceOn && !voicePaused);
  const box = $('#prompt');
  if (box) {
    box.placeholder = voiceOn ? (voiceSuspended ? 'AI ভাবছে — একটু পরে বলুন…' : 'শুনছি — বলুন…') : DEFAULT_PLACEHOLDER;
  }
}

function cleanForSpeech(text) {
  return plainText(text)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/ডেটা:[^\n]*/g, ' ')
    .replace(/[*_`#>~|]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 600);
}

let ttsCtx = null;
let ttsSource = null;

function primeTts() {
  try {
    if (!ttsCtx) ttsCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (ttsCtx && ttsCtx.state === 'suspended') ttsCtx.resume().catch(() => {});
  } catch { /* audio context unavailable */ }
}

function stopTts() {
  try { window.speechSynthesis?.cancel(); } catch { /* noop */ }
  try { ttsSource?.stop(); } catch { /* noop */ }
  ttsSource = null;
}

function hasBengaliVoice() {
  try {
    return window.speechSynthesis.getVoices().some((v) => /^bn|bengali/i.test(v.lang));
  } catch {
    return false;
  }
}

function nativeSpeak(text) {
  if (!('speechSynthesis' in window)) {
    toast('এই ব্রাউজারে AI ভয়েস (TTS) সাপোর্ট নেই');
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'bn-BD';
    const bn = window.speechSynthesis.getVoices().find((v) => /^bn|bengali/i.test(v.lang));
    if (bn) utter.voice = bn;
    utter.onend = resolve;
    utter.onerror = (event) => {
      if (event && (event.error === 'canceled' || event.error === 'interrupted')) resolve();
      else {
        toast('AI ভয়েস আউটপুট সমস্যা — স্পিকার/সাউন্ড চেক করো');
        resolve();
      }
    };
    window.speechSynthesis.speak(utter);
  });
}

function splitTtsText(text) {
  const parts = [];
  let cur = '';
  const flush = () => {
    if (cur.trim()) parts.push(cur.trim());
    cur = '';
  };
  for (const ch of text) {
    cur += ch;
    if ('।.!?'.includes(ch) || cur.length >= 180) flush();
  }
  flush();
  return parts.slice(0, 6);
}

function playTtsBuffer(buffer) {
  return new Promise((resolve) => {
    try {
      const src = ttsCtx.createBufferSource();
      src.buffer = buffer;
      ensureAnalyser();
      if (ttsAnalyser) {
        src.connect(ttsAnalyser);
        ttsAnalyser.connect(ttsCtx.destination);
      } else {
        src.connect(ttsCtx.destination);
      }
      ttsSource = src;
      src.onended = () => {
        if (ttsSource === src) ttsSource = null;
        resolve();
      };
      src.start();
      setTimeout(resolve, Math.ceil(buffer.duration * 1000) + 400);
    } catch {
      resolve();
    }
  });
}

async function speakViaGoogle(text) {
  primeTts();
  if (!ttsCtx) throw new Error('no-audio');
  if (ttsCtx.state !== 'running') {
    try { await ttsCtx.resume(); } catch { /* try anyway */ }
  }
  if (ttsCtx.state !== 'running') throw new Error('audio-suspended');
  for (const part of splitTtsText(text)) {
    const res = await fetch(`/api/tts?text=${encodeURIComponent(part)}`);
    if (!res.ok) throw new Error('tts-http');
    const buf = await res.arrayBuffer();
    const decoded = await ttsCtx.decodeAudioData(buf);
    await playTtsBuffer(decoded);
  }
}

async function speakAloud(text) {
  const clean = cleanForSpeech(text);
  if (!clean) return;
  stopTts();
  if (hasBengaliVoice()) {
    await nativeSpeak(clean);
    return;
  }
  try {
    await speakViaGoogle(clean);
  } catch {
    await nativeSpeak(clean);
  }
}

async function speakFinal(task) {
  const label = task.status === 'done'
    ? task.result
    : `কাজটা আটকে গেছে — ${task.error || TASK_LABEL[task.status] || task.status}`;
  const screenOpen = voiceScreenOpen;
  if (screenOpen) setVoiceStage('speaking', cleanForSpeech(label).slice(0, 160));
  if (screenOpen && task.status === 'done') flashHappy(4200);
  await speakAloud(label);
  if (screenOpen && voiceOn) setVoiceStage('listening', '');
}

function armIdleHint() {
  clearTimeout(voiceIdleTimer);
  voiceIdleTimer = setTimeout(() => {
    if (voiceOn && !voiceSuspended && !voicePaused && voiceScreenOpen && !($('#prompt')?.value || '').trim()) {
      setVoiceStage('listening', 'কিছু শুনতে পাচ্ছি না — মাইকের কাছে কথা বলুন, না হলে ✕ চেপে টাইপ করে পাঠান');
    }
  }, 9000);
}

function ensureRecognition() {
  if (recognition) return recognition;
  recognition = new SpeechRec();
  recognition.lang = 'bn-BD';
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.onstart = () => {
    console.log('[voice] শোনা শুরু');
    armIdleHint();
  };
  recognition.onaudiostart = () => {
    console.log('[voice] মাইকে আওয়াজ আসছে');
  };
  recognition.onspeechstart = () => {
    if (voiceGreeting) {
      voiceGreeting = false;
      stopTts();
    }
    if (voiceScreenOpen && !voiceSuspended && !voicePaused) {
      bumpExcite();
      setVoiceStage('listening', 'বলছেন — শুনছি…');
    }
  };
  recognition.onresult = (event) => {
    if (voiceSuspended || voicePaused) return;
    if (voiceGreeting) {
      voiceGreeting = false;
      stopTts();
    }
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const part = event.results[i];
      if (part.isFinal) {
        const said = String(part[0].transcript || '').trim();
        if (said) voiceBase = [voiceBase, said].filter(Boolean).join(' ').trim();
      } else {
        interim += String(part[0].transcript || '');
      }
    }
    voiceInterim = interim.trim();
    const live = [voiceBase, voiceInterim].filter(Boolean).join(' ').trim();
    if (live) bumpExcite();
    const box = $('#prompt');
    if (box) box.value = live;
    if (voiceScreenOpen) setVoiceStage('listening', live);
    clearTimeout(voiceIdleTimer);
    clearTimeout(voiceTimer);
    // Final না এলেও শোনা কথাটাই পাঠিয়ে দিই (1.6s চুপ থাকলে)
    voiceTimer = setTimeout(() => {
      const text = ($('#prompt')?.value || '').trim();
      if (voiceOn && !voiceSuspended && !voicePaused && text) submitPromptFromVoice();
    }, 1600);
  };
  recognition.onerror = (event) => {
    console.warn('[voice] error:', event.error);
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      toast('মাইক্রোফোনের অনুমতি দাও — ঠিকানা বারের লক/ক্যামেরা আইকনে ক্লিক করে Allow করো');
      turnVoiceOff();
    } else if (event.error === 'network') {
      if (voiceScreenOpen) setVoiceStage('listening', 'ভয়েস সার্ভিসে সমস্যা — আবার চেষ্টা হচ্ছে…');
    } else if (event.error === 'audio-capture') {
      if (voiceScreenOpen) setVoiceStage('listening', 'মাইক পাওয়া যাচ্ছে না — মাইক চেক করে আবার চেষ্টা করুন');
    }
  };
  recognition.onend = () => {
    if (voiceOn && !voiceSuspended && !voicePaused) {
      try { recognition.start(); } catch { /* already started */ }
    }
  };
  return recognition;
}

function startListening() {
  clearTimeout(voiceIdleTimer);
  armIdleHint();
  try {
    ensureRecognition().start();
  } catch {
    /* already listening */
  }
}

function stopListening() {
  clearTimeout(voiceIdleTimer);
  try { recognition?.stop(); } catch { /* noop */ }
}

function voicePauseForTask() {
  if (!voiceOn) return false;
  voiceSuspended = true;
  voicePaused = false;
  clearTimeout(voiceTimer);
  clearTimeout(voiceIdleTimer);
  stopListening();
  voiceSpoken = false;
  voiceButtons();
  if (voiceScreenOpen) setVoiceStage('thinking');
  return true;
}

function voiceResumeAfterTask() {
  if (!voiceOn) return;
  voiceSuspended = false;
  voicePaused = false;
  voiceButtons();
  if (voiceScreenOpen) setVoiceStage('listening', '');
  startListening();
}

async function submitPromptFromVoice() {
  clearTimeout(voiceTimer);
  clearTimeout(voiceIdleTimer);
  const text = ($('#prompt')?.value || '').trim();
  if (!text || voiceSuspended) return;
  voiceSuspended = true;
  voicePaused = false;
  stopListening();
  voiceBase = '';
  voiceInterim = '';
  voiceSpoken = false;
  voiceButtons();
  if (voiceScreenOpen) setVoiceStage('thinking', text);
  const task = await submitPrompt(text);
  if (task) voiceTaskId = task.id;
  else voiceResumeAfterTask();
}

async function voiceTick() {
  if (!state) return;
  const final = (s) => ['done', 'error', 'need_login', 'cancelled'].includes(s);

  if (voiceTaskId && !voiceSpoken) {
    const task = state.tasks.find((t) => t.id === voiceTaskId);
    if (task && final(task.status)) {
      voiceSpoken = true;
      spokeTasks.add(task.id);
      voiceTaskId = null;
      await speakFinal(task);
      voiceResumeAfterTask();
    }
  }

  for (const task of state.tasks || []) {
    const prev = lastTaskStatus[task.id];
    if (prev && final(prev) && !final(task.status)) spokeTasks.delete(task.id);
    if (prev && prev !== task.status && final(task.status) && speakOn && !spokeTasks.has(task.id) && task.id !== voiceTaskId) {
      spokeTasks.add(task.id);
      await speakFinal(task);
    }
    lastTaskStatus[task.id] = task.status;
  }
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'on') {
      for (const [evt, fn] of Object.entries(value)) node.addEventListener(evt, fn);
    } else if (key === 'style') Object.assign(node.style, value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  for (const child of children.flat(4)) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

async function api(path, method = 'GET', body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function toast(message, ms = 3200) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.add('hidden'), ms);
}

function fmtTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('bn-BD', { hour: '2-digit', minute: '2-digit' });
}

async function toggleHat() {
  try {
    const st = await api('/api/widget');
    // running = ইচ্ছে, alive = এনফোর্সারের ছাপা — ছাপা না মিললে বোতামে ক্লিক করলে হাট আবার উঠবে
    const action = st.running && st.alive ? 'stop' : 'start';
    await api('/api/widget', 'POST', { action });
    toast(action === 'stop' ? 'হাট বন্ধ হয়েছে' : 'ডান কোণায় হাট খুলছে…');
  } catch (err) {
    toast(`হাট চলেনি — ${err.message}`);
  }
}

function fmtSize(bytes) {
  if (!bytes) return '0B';
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${bytes}B`;
}

function fileExt(name) {
  const ext = String(name || '').split('.').pop();
  return ext && ext !== name ? ext.slice(0, 4).toUpperCase() : 'FILE';
}

function addFiles(list) {
  for (const file of list || []) {
    if (pendingFiles.length >= MAX_ATTACH_FILES) {
      toast(`সর্বোচ্চ ${MAX_ATTACH_FILES}টি ফাইল একসাথে দেওয়া যায়`);
      break;
    }
    if (!file.size) {
      toast(`${file.name} খালি ফাইল`);
      continue;
    }
    if (file.size > MAX_ATTACH) {
      toast(`${file.name} অনেক বড় — সর্বোচ্চ ২৫MB`);
      continue;
    }
    if (pendingFiles.some((f) => f.name === file.name && f.size === file.size)) continue;
    pendingFiles.push(file);
  }
  renderPendingFiles();
  if (voiceScreenOpen) {
    setVoiceStage(voiceStage, pendingFiles.length ? `${pendingFiles.length} ফাইল যোগ হয়েছে — কথা বলুন…` : '');
  }
}

function renderPendingFiles() {
  const box = $('#attach-chips');
  if (!box) return;
  clear(box);
  box.hidden = !pendingFiles.length && !pendingShows.length;
  pendingFiles.forEach((file, index) => {
    box.append(
      el(
        'div',
        { class: 'attach-chip', title: `${file.name} · ${fmtSize(file.size)}` },
        el('span', { class: 'attach-ext', text: fileExt(file.name) }),
        el('span', { class: 'attach-name', text: file.name }),
        el('span', { class: 'attach-size', text: fmtSize(file.size) }),
        el('button', {
          class: 'attach-x',
          type: 'button',
          text: '×',
          'aria-label': 'ফাইল সরাও',
          on: {
            click: () => {
              pendingFiles.splice(index, 1);
              renderPendingFiles();
            }
          }
        })
      )
    );
  });
  pendingShows.forEach((show, index) => {
    box.append(
      el(
        'div',
        { class: 'attach-chip attach-show', title: show.detail },
        el('span', { class: 'attach-ext', text: show.kind === 'window' ? 'উইন্ডো' : show.kind === 'point' ? 'বিন্দু' : 'অংশ' }),
        el('span', { class: 'attach-name', text: show.title || (show.kind === 'point' ? 'যে জায়গা দেখালো' : 'স্ক্রিনের অংশ') }),
        el('span', { class: 'attach-size', text: show.coord }),
        el('button', {
          class: 'attach-x',
          type: 'button',
          text: '×',
          'aria-label': 'স্ক্রিনের অংশ সরাও',
          on: {
            click: () => {
              pendingShows.splice(index, 1);
              renderPendingFiles();
              syncSnipMarker();
            }
          }
        })
      )
    );
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = () => reject(new Error(`${file.name} পড়া যায়নি`));
    reader.readAsDataURL(file);
  });
}

// ---------- স্ক্রিন থেকে ঘেরো (পুরো ডেস্কটপ জুড়ে সিলেক্ট ওভারলে) ----------

// একটাই [দেখানো …] ব্লক ধরে রাখি — প্রতিবার নতুন করে যোগ করা হয়, পুরোনোটা মোড়ানো থাকে
const SNIP_MARK_RE = /\s*\[দেখানো[^\]]*\]\s*/g;

function syncSnipMarker() {
  const box = $('#prompt');
  if (!box) return;
  const own = box.value.replace(SNIP_MARK_RE, ' ').trim();
  const bits = pendingShows.map((s) => s.detail);
  box.value = bits.length ? `${own ? `${own} ` : ''}[দেখানো · ${bits.join(' · ')}] ` : own;
}

function closeSnipMenu() {
  const menu = $('#snip-menu');
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  $('#btn-snip')?.classList.remove('on');
  $('#btn-snip')?.setAttribute('aria-expanded', 'false');
}

function toggleSnipMenu() {
  const menu = $('#snip-menu');
  if (!menu) return;
  const open = menu.hidden;
  menu.hidden = !open;
  $('#btn-snip')?.classList.toggle('on', open);
  $('#btn-snip')?.setAttribute('aria-expanded', String(open));
}

async function snipPick(mode) {
  closeSnipMenu();
  if (pendingFiles.length + pendingShows.length >= MAX_ATTACH_FILES) {
    toast(`সর্বোচ্চ ${MAX_ATTACH_FILES}টি সংযুক্তি — আগে একটা সরাও`);
    return;
  }
  toast('পুরো স্ক্রিনে ঘেরো / ক্লিক করো — Esc দিলে বাতিল');
  try {
    const j = await api('/api/pick', 'POST', { mode });
    if (j.cancelled) return toast('সিলেক্ট বাতিল হয়েছে');
    if (!j.ok) throw new Error(j.error || 'সিলেক্ট ওভারলে চালু হয়নি');
    let rect = j.rect;
    if (j.kind === 'point') {
      rect = [Math.max(0, j.point[0] - 160), Math.max(0, j.point[1] - 110), 320, 220];
    }
    const c = await api('/api/screen/crop', 'POST', { x: rect[0], y: rect[1], w: rect[2], h: rect[3] });
    const [rx, ry, rw, rh] = c.rect;
    const base = Array.isArray(c.origin) ? c.origin : [0, 0];
    const abs = [base[0] + rx, base[1] + ry];
    // ] ব্লকের শেষ চিহ্ন, তাই টাইটেল থেকে সরিয়ে ফেলতে হয়
    const t = String(j.title || '').replace(/[[\]]/g, '').trim();
    const coord =
      j.kind === 'point' ? `${abs[0]},${abs[1]}` : `${rx},${ry} ${rw}×${rh}`;
    const detail =
      j.kind === 'window'
        ? `উইন্ডো "${t}" — স্ক্রিনের ${abs[0]},${abs[1]} থেকে ${rw}×${rh} অংশ, সংযুক্ত ছবিতে পুরো উইন্ডোটা আছে`
        : j.kind === 'point'
          ? `স্ক্রিনের পয়েন্ট ${abs[0]},${abs[1]} — ওই জায়গার কাছের ছবি সংযুক্ত`
          : `স্ক্রিনের অংশ ${rx},${ry} ${rw}×${rh} (বাম-উপরের কোণ ${abs[0]},${abs[1]}) — সংযুক্ত ছবিতে ঘেরা অংশটুকুই আছে`;
    pendingShows.push({ kind: j.kind, title: t, coord, detail, attachment: c.attachment });
    renderPendingFiles();
    syncSnipMarker();
    $('#prompt').focus();
    toast('স্ক্রিনের অংশটা যোগ হয়েছে — এখন কী বলতে চাও লিখে পাঠাও');
  } catch (err) {
    toast(err.message);
  }
}

function providerMeta(key) {
  return state?.providers?.[key] || { label: key, color: '#7ab8ff' };
}

function providerBadge(key) {
  const meta = providerMeta(key);
  return el('span', {
    class: 'badge',
    text: meta.label,
    style: {
      color: meta.color,
      borderColor: `${meta.color}55`,
      background: `${meta.color}18`
    }
  });
}

function renderAll() {
  if (!state) return;
  renderEngine();
  renderAccounts();
  renderBots();
  renderTasks();
  renderLive();
  renderMemory();
  renderDockAvatar();
  renderDockChat();
  if (dockPanel === 'search') renderDockSearch();
  voiceTick();
}

function browserOpen() {
  return Object.values(state?.browsers || {}).some((b) => b.open);
}

function renderEngine() {
  const open = browserOpen();
  const node = $('#engine');
  node.textContent = open ? 'ONLINE' : 'STANDBY';
  node.classList.add('on');
}

const ICONS = {
  up: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/></svg>',
  down: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/></svg>',
  retry: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15.36-6.36L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.36 6.36L3 16"/><path d="M3 21v-5h5"/></svg>',
  reply: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m9 17-5-5 5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>',
  more: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>'
};

function msgIcons(task) {
  const row = el('div', { class: 'msg-icons' });
  const btn = (html, title, fn) =>
    el('button', {
      type: 'button',
      title,
      on: {
        click: (event) => {
          event.preventDefault();
          event.stopPropagation();
          fn();
        }
      }
    }, el('span', { innerHTML: html }));
  row.append(
    btn(ICONS.up, 'ভালো হয়েছে', () => toast('ধন্যবাদ!')),
    btn(ICONS.down, 'ভালো হয়নি', () => toast('ঠিক আছে — পরের কাজে আরও ভালো করব')),
    btn(ICONS.retry, 'আবার চালাও', async () => {
      if (!['error', 'need_login', 'cancelled'].includes(task.status)) return;
      try {
        await api('/api/task/retry', 'POST', { id: task.id });
        toast('যেখানে থেমেছিল সেখান থেকেই আবার শুরু হচ্ছে');
      } catch (err) {
        toast(err.message);
      }
    }),
    btn(ICONS.reply, 'উত্তর দাও', () => $('#prompt').focus()),
    btn(ICONS.more, 'বিস্তারিত', () => toast(`টাস্ক: ${task.id} · ${(task.turns || []).length} ধাপ`))
  );
  return row;
}

// সার্ভারেও JSON সমতল বাংলায় রূপায়; এটা শেষ আসর — কাঁচা JSON ব্রেস/কী-নাম চেটের ভিতরে যাবে না
function plainText(value) {
  const t = String(value ?? '');
  if (!/[{}]/.test(t)) return t;
  return t
    .replace(/```[a-z]*/gi, ' ')
    .replace(/"[^"\n]{1,48}"\s*:/g, ' ')
    .replace(/"[^"\n]{0,48}$/g, '')
    .replace(/[{}[\],]/g, ' ')
    .replace(/"/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function aiBubble(tag, text, cls) {
  return el('div', { class: 'msg' },
    el('div', { class: 'avatar', text: tag }),
    el('div', { class: `bubble${cls ? ' ' + cls : ''}`, text: plainText(text) }));
}

// খালি চেট: নমুনা কথোপকথনের লেআউট — বামে AI, ডানে ইউজার (আসল চেটের মতোই)
function emptyThread() {
  const thread = el('div', { class: 'empty-thread' });
  const ghost = (text) => el('div', { class: 'msg user ghost' }, el('div', { class: 'bubble', text }));
  thread.append(aiBubble('AI', 'হ্যালো! আমি প্রস্তুত — কী কাজ বলবে?'));
  thread.append(ghost('যেমন: আজকের ঢাকার আবহাওয়া আর ডলার রেট…'));
  thread.append(aiBubble('AI', 'যেকোনো কাজ লিখে পাঠাও — আগের চেটগুলো বাঁ পাশের ইতিহাসে জমা আছে'));
  thread.append(ghost('আজকের ডলার রেট'));
  const chips = quickChips();
  chips.classList.add('hero-chips');
  thread.append(chips);
  return thread;
}

function quickChips() {
  const SUGGESTIONS = [
    'আজকের ঢাকার আবহাওয়া',
    'আজকের ডলার রেট',
    'ইউটিউবে গান চালাও',
    'সর্বশেষ খবর দেখাও',
    'আমার ফাইলগুলো দেখাও'
  ];
  const row = el('div', { class: 'quick-chips' });
  for (const text of SUGGESTIONS) {
    row.append(el('button', {
      type: 'button',
      class: 'chip',
      text,
      on: {
        click: (event) => {
          event.stopPropagation();
          const box = $('#prompt');
          if (box) {
            box.value = text;
            box.focus();
          }
        }
      }
    }));
  }
  return row;
}

function loadingBubble() {
  const dots = el('span', { class: 'dots' });
  for (let i = 0; i < 5; i += 1) dots.append(el('span'));
  return el('div', { class: 'msg' },
    el('div', { class: 'avatar', text: '…' }),
    el('div', { class: 'bubble load' }, dots));
}

function turnBubble(turn) {
  if (turn.kind === 'bot') {
    return aiBubble(String(turn.botName || 'AI').trim().charAt(0) || 'A', turn.say || '…');
  }
  if (turn.kind === 'tool') {
    const text = (turn.results || []).map((r) => `${r.ok ? '✓' : '✗'} ${r.tool || '?'}`).join('   ');
    return aiBubble('⚙', text);
  }
  if (turn.kind === 'team') {
    const stage = turn.stage === 'plan' ? 'পরিকল্পনা' : turn.stage === 'build' ? 'নকশা' : turn.stage === 'error' ? 'দল: সমস্যা' : 'দল';
    return aiBubble('দ', `${stage}: ${String(turn.say || '').slice(0, 170)}`);
  }
  if (turn.kind === 'eye') {
    const mark = turn.verdict === 'yes' ? '✓' : turn.verdict === 'no' ? '✗' : '•';
    return aiBubble('E', `${mark} স্ক্রিন দেখে: ${String(turn.seen || '').slice(0, 150)}${turn.problem ? ` — বাকি: ${String(turn.problem).slice(0, 90)}` : ''}`);
  }
  if (turn.kind === 'boss') {
    const verdictText = turn.verdict === 'fix' ? 'সংশোধন: ' : turn.verdict === 'skip' ? 'বাদ: ' : 'ঠিক আছে: ';
    return aiBubble('B', verdictText + String(turn.reason || '').slice(0, 140));
  }
  if (turn.kind === 'note' && turn.say) {
    // ফাস্ট-লেনের একই নোট লাইন প্রতিটা চ্যাটে বারবার বসত — ফিডে দেখাই না
    if (/^সাধারণ কথাবার্তা/.test(String(turn.say).trim())) return null;
    return aiBubble('i', turn.say);
  }
  return null;
}

// চলতি সেশনের বার্তাগুলোই দেখায় — অন্য চেটের বার্তা এখানে আসে না।
function renderLive(opts = {}) {
  const box = $('#live-chat');
  if (!box || !state) return;
  const stick = opts.toBottom || box.scrollHeight - box.scrollTop - box.clientHeight < 160;
  clear(box);
  const act = activeSession();
  const tasks = act ? state.tasks.filter((t) => sessionOf(t) === act).reverse() : [];

  if (!tasks.length) {
    box.classList.add('empty');
    box.append(emptyThread());
    return;
  }
  box.classList.remove('empty');

  const lastId = tasks[tasks.length - 1].id;
  for (const task of tasks) {
    const isLast = task.id === lastId;
    const block = el('div', { class: 'thread-block', dataset: { id: task.id } });
    block.append(el('div', { class: 'msg user' }, el('div', { class: 'bubble', text: task.prompt })));
    block.append(
      el('div', {
        class: 'msg-meta user',
        text: `${TASK_LABEL[task.status] || task.status} · ${fmtTime(task.createdAt)}${
          task.attachments?.length ? ` · ${task.attachments.length} ফাইল` : ''
        }`
      })
    );

    const recent = (task.turns || [])
      .filter((t) => ['bot', 'tool', 'boss', 'note', 'team', 'eye'].includes(t.kind))
      .slice(isLast ? -4 : -2);
    if (!recent.length && (task.status === 'running' || task.status === 'queued')) {
      const line =
        task.chat || task.fast
          ? 'উত্তর দিচ্ছি…'
          : task.status === 'queued'
            ? 'লাইনে আছে — আগের কাজ শেষ হলেই শুরু হবে…'
            : 'কাজ শুরু হচ্ছে…';
      block.append(aiBubble('AI', line));
    }
    for (const turn of recent) {
      const bubble = turnBubble(turn);
      if (bubble) block.append(bubble);
    }

    if (task.status === 'done' && task.result) {
      block.append(aiBubble('✓', String(task.result).slice(0, isLast ? 200 : 160), 'ok'));
    } else if (task.error) {
      block.append(aiBubble('!', String(task.error).slice(0, 200), 'err'));
    } else if (task.status === 'running' || task.status === 'queued') {
      block.append(loadingBubble());
    }
    if (isLast) block.append(msgIcons(task));
    box.append(block);
  }
  if (stick) box.scrollTop = box.scrollHeight;
}

function scrollToTask(taskId) {
  const box = $('#live-chat');
  if (!box) return;
  const block = [...box.children].find((n) => n.dataset?.id === taskId);
  if (block) block.scrollIntoView({ block: 'start', behavior: 'smooth' });
  else box.scrollIntoView({ block: 'nearest' });
}

function renderMemory() {
  const box = $('#memory');
  if (!box || !state) return;
  clear(box);
  const notes = state.notes || [];
  const lessons = state.lessons || [];
  const fails = notes.filter((n) => n.outcome === 'fail').length;
  $('#memory-count').textContent = `${notes.length ? `${notes.length} নোট${fails ? ` · ${fails} ব্যর্থ` : ''}` : lessons.length ? `${lessons.length} পাঠ` : '0 নোট'}`;
  if (!notes.length && !lessons.length) {
    box.append(
      el('p', {
        class: 'note',
        text: 'কাজ শেষ হলেই এখানে নোট জমা হবে — পরে একই কাজ দিলে এজেন্ট নোট দেখে ব্রাউজার-সার্চ ছাড়াই করবে। ভুল হলে পাঠও এখানে জমা হবে।'
      })
    );
    return;
  }
  if (lessons.length) {
    box.append(el('h3', { class: 'panel-sub', text: 'শেখা পাঠ (ভুল থেকে)' }));
    for (const l of lessons) {
      const details = el('details', { class: 'memory-item lesson' });
      const summary = el('summary');
      const label = String(l.tool || 'সাধারণ') + (l.code ? ' · ' + l.code : '');
      summary.append(
        el('span', { class: 'memory-title', text: label }),
        el('span', {
          class: 'memory-meta',
          text: `${l.count || 1} বার${l.wins ? ` · ✓ ${l.wins} বার পরে সফল` : ''} · ${fmtTime(l.at)}`
        })
      );
      const body = el('div', { class: 'memory-body' });
      body.append(el('p', { class: 'memory-prompt', text: l.lesson }));
      details.append(summary, body);
      box.append(details);
    }
  }
  for (const note of notes) {
    const failed = note.outcome === 'fail';
    const details = el('details', { class: `memory-item${failed ? ' failed' : ''}` });
    const summary = el('summary');
    summary.append(
      el('span', { class: `mem-badge ${failed ? 'bad' : 'good'}`, text: failed ? '✗ ব্যর্থ' : '✓ সফল' }),
      el('span', { class: 'memory-title', text: note.title || 'নোট' }),
      el('span', {
        class: 'memory-meta',
        text: `${note.uses || 1} বার · ${fmtTime(note.lastUsed || note.createdAt)}${
          failed ? '' : ` · ✓${note.okCount || 1}/✗${note.failCount || 0}`
        }`
      })
    );
    const body = el('div', { class: 'memory-body' });
    body.append(el('p', { class: 'memory-prompt', text: note.prompt }));
    if (failed) body.append(el('p', { class: 'memory-error', text: `ব্যর্থতার কারণ: ${note.error || 'জানা নেই'}` }));
    if (note.result) body.append(el('pre', { class: 'memory-result', text: plainText(note.result) }));
    if (note.tools?.length) {
      const best = new Map();
      for (const t of note.tools) {
        if (!t.tool) continue;
        const prev = best.get(t.tool);
        best.set(t.tool, !prev || prev.ok ? t : prev);
      }
      body.append(
        el(
          'p',
          { class: 'memory-tools' },
          ...[...best.entries()].map(
            ([name, t]) =>
              el('span', {
                class: `mem-tool ${t.ok === false ? 'bad' : 'good'}`,
                text: `${t.ok === false ? '✗' : '✓'} ${name}${t.ok === false && t.code ? ` · ${t.code}` : ''}`
              })
          )
        )
      );
    }
    body.append(
      el('button', {
        class: 'btn ghost small',
        text: 'নোট মুছুন',
        on: {
          click: async (event) => {
            event.preventDefault();
            try {
              await api(`/api/notes?id=${encodeURIComponent(note.id)}`, 'DELETE');
              await refresh();
              toast('নোট মুছে ফেলা হয়েছে');
            } catch (err) {
              toast(err.message);
            }
          }
        }
      })
    );
    details.append(summary, body);
    box.append(details);
  }
}

// কোন লেন দিয়ে কাজ চলবে — মালিকের হাতে: শুধু API, শুধু ফ্রি ওয়েব AI, কিংবা দুটোই (ডিফল্ট)
const ROUTE_MODES = [
  {
    id: 'api',
    label: 'শুধু API',
    hint: 'API কী দিয়েই চলবে — ChatGPT/জেমিনির ব্রাউজার ট্যাব খোলে না। কোনো লেন ব্যর্থ হলে কাজ থামে, ওয়েবে যায় না।'
  },
  {
    id: 'both',
    label: 'দুটোই (ডিফল্ট)',
    hint: 'আগে API — না চললে বা ব্যর্থ হলে সঙ্গে সঙ্গে ফ্রি ChatGPT/জেমিনি ওয়েব লেন। দ্রুততম আর সবচেয়ে নির্ভরযোগ্য।'
  },
  {
    id: 'web',
    label: 'শুধু ওয়েব AI',
    hint: 'লেগ-ইন করা ChatGPT/জেমিনি/DeepSeek ট্যাব দিয়ে চলবে — কোনো API কী ব্যবহার হয় না, খরচ একদম শূন্য।'
  }
];

function currentRouteMode() {
  const s = state.settings || {};
  if (ROUTE_MODES.some((m) => m.id === s.routeMode)) return s.routeMode;
  return s.preferApi === false ? 'web' : 'both';
}

function routeModeRow(onPick, getActive = currentRouteMode) {
  const wrap = el('div', { class: 'lane-mode' });
  const draw = () => {
    clear(wrap);
    const active = getActive();
    const seg = el('div', { class: 'lane-seg' });
    for (const m of ROUTE_MODES) {
      seg.append(
        el('button', {
          class: `lane-seg-btn${m.id === active ? ' on' : ''}`,
          type: 'button',
          text: m.label,
          on: { click: () => m.id !== active && onPick(m.id) }
        })
      );
    }
    wrap.append(
      el('span', { class: 'micro', text: 'কী দিয়ে চলবে' }),
      seg,
      el('p', { class: 'muted small', text: ROUTE_MODES.find((m) => m.id === active).hint })
    );
  };
  draw();
  return { node: wrap, draw };
}

function renderAccounts() {
  const box = $('#accounts');
  clear(box);
  for (const account of state.accounts) {
    const row = el('div', { class: 'account' });
    const head = el('div', { class: 'account-head' },
      el('span', { class: 'acct-avatar', text: (account.name || '?').trim().charAt(0) }),
      el('div', { class: 'account-name' }, el('span', { text: account.name }), el('span', { class: 'muted small', text: account.browser }))
    );
    row.append(head);
    const chips = el('div', { class: 'login-row' });
    const connected = (state.connect && state.connect.providers) || {};
    for (const [key, meta] of Object.entries(state.providers)) {
      if (meta.api) continue;
      const ok = Boolean(connected[key] && connected[key].ok);
      const chip = el('button', {
        class: `login-chip${ok ? ' ok' : ''}`,
        title: ok ? 'সংযুক্ত — কাজের জন্য প্রস্তুত' : 'একবার লগইন করলেই চলবে',
        on: {
          click: async () => {
            try {
              toast(`${meta.label} খোলা হচ্ছে — ব্রাউজারে লগইন করুন`);
              await api('/api/login', 'POST', { accountId: account.id, provider: key });
            } catch (err) {
              toast(err.message);
            }
          }
        }
      });
      chip.append(el('i', { style: { background: meta.color } }), el('span', { text: `${meta.label}${ok ? ' ✓' : ' লগইন'}` }));
      chips.append(chip);
    }
    row.append(chips);
    row.append(
      el('button', {
        class: 'btn ghost small',
        type: 'button',
        text: 'সংযোগ পাতা',
        title: 'এক পাতায় সব সাইটের লগইন ও টেরাবক্স',
        on: { click: () => window.open('/setup', '_blank') }
      })
    );
    box.append(row);
  }

  const s = state.settings || {};
  const apiNames = [];
  if (s.geminiApiKey) apiNames.push('Gemini');
  if (s.openaiApiKey) apiNames.push('OpenAI');
  if (s.deepseekApiKey) apiNames.push('DeepSeek');
  for (const custom of s.customApis || []) apiNames.push(custom.name || 'Custom');
  const apiLine = apiNames.length ? `চালু: ${apiNames.join(', ')}` : 'কোনো API কী নেই — ব্রাউজার লগইনেই চলবে';
  // 'শুধু API' মোডে কী না থাকলে এজেন্টের কিছুই করার থাকে না — সেটা এখানেই দেখাও
  const apiModeBlind = currentRouteMode() === 'api' && !apiNames.length;

  const picker = routeModeRow(async (m) => {
    const cfg = currentConfig();
    cfg.settings = { ...cfg.settings, routeMode: m, preferApi: m !== 'web' };
    try {
      await api('/api/config', 'PUT', cfg);
      toast(`পথ বদলে গেছে: ${ROUTE_MODES.find((r) => r.id === m).label}`);
      await refresh();
    } catch (err) {
      toast(`সেভ হয়নি: ${err.message}`);
    }
  });

  box.append(
    el(
      'div',
      { class: 'api-box' },
      picker.node,
      el(
        'div',
        { class: 'lane-mode-foot' },
        el('button', { class: 'btn ghost small', type: 'button', text: '+ API কী যোগ করো', on: { click: openApiModal } }),
        el('span', {
          class: `muted small${apiModeBlind ? ' lane-blind' : ''}`,
          text: apiModeBlind ? '⚠ কোনো API কী নেই — এই মোডে কাজ থামবে। কী দাও বা "দুটোই" বেছে নাও।' : apiLine
        })
      )
    ),
    localModelBox()
  );
}

// ইন্টারনেট থেকে নামানো লোকাল মডেল + বাংলা কর্পাস — এখানেই চালু/থামানো যায়
function localModelBox() {
  const wrap = el('div', { class: 'api-box lane-mode' }, el('p', { class: 'micro', text: 'লোকাল মডেল…' }));
  const paint = async () => {
    let j;
    try {
      const r = await fetch('/api/models');
      j = await r.json();
    } catch {
      return;
    }
    clear(wrap);
    const kn = j.knowledge || {};
    const bn = (n) => Number(n || 0).toLocaleString('bn-BD');
    wrap.append(
      el('p', {
        class: 'micro',
        text: `লোকাল মডেল ও বাংলা কর্পাস — ${bn(kn.pairs)} জোড়া ডেটা, ${bn(j.freeMemMB)} MB ফাঁকা RAM`
      })
    );
    const seg = el('div', { class: 'lane-seg' });
    for (const m of j.models || []) {
      seg.append(
        el('button', {
          class: `lane-seg-btn${m.present ? ' on' : ''}`,
          type: 'button',
          text: `${m.label} ${m.present ? (m.runsLocally ? '✓' : '⚠ RAM কম') : '↓ নামেনি'}`,
          title: `${m.file} · ${((m.localBytes || 0) / 1073741824).toFixed(2)} GB`
        })
      );
    }
    wrap.append(seg);
    const toggle = el('button', {
      class: `btn small ${j.enabled ? '' : 'ghost'}`,
      type: 'button',
      text: j.enabled ? `লোকাল মডেল চালু${j.running ? ` (${j.loaded})` : ''}` : 'লোকাল মডেল বন্ধ',
      on: {
        click: async () => {
          toggle.disabled = true;
          try {
            const r = await api('/api/models', 'POST', { action: 'toggle', enabled: !j.enabled });
            toast(r.enabled ? 'লোকাল মডেল চালু — প্রশ্নের উত্তর এখন দল/ওয়েব AI-এর আগে নিজে দেবে' : 'লোকাল মডেল বন্ধ');
            await refresh();
          } catch (err) {
            toast(`ব্যর্থ: ${err.message}`);
          } finally {
            toggle.disabled = false;
          }
        }
      }
    });
    const stop = el('button', {
      class: 'btn ghost small',
      type: 'button',
      text: j.running ? 'সার্ভার থামাও' : 'টেস্ট চালু',
      on: {
        click: async () => {
          stop.disabled = true;
          try {
            const r = await api('/api/models', 'POST', { action: j.running ? 'stop' : 'start' });
            toast(j.running ? 'লোকাল সার্ভার থেমে গেছে' : r.ok ? `চালু হয়েছে: ${r.loaded}` : `চলেনি: ${r.error}`);
            paint();
          } catch (err) {
            toast(err.message);
          } finally {
            stop.disabled = false;
          }
        }
      }
    });
    wrap.append(el('div', { class: 'lane-mode-foot' }, toggle, stop));
    if (j.error) wrap.append(el('p', { class: 'micro lane-blind', text: String(j.error).slice(0, 160) }));
  };
  paint();
  return wrap;
}

function isAutoTeamGroup(groupId) {
  return String(groupId).startsWith('team-');
}

function mapBots() {
  const active = new Set((state.tasks || []).filter((t) => t.status === 'running' || t.status === 'queued').map((t) => t.id));
  let latestTeam = '';
  for (const group of state.groups || []) if (group.ephemeral) latestTeam = group.taskId || '';
  const liveTeams = new Set(
    state.bots.filter((b) => isAutoTeamGroup(b.group) && b.status === 'busy').map((b) => b.group)
  );
  return state.bots.filter(
    (bot) =>
      isAutoTeamGroup(bot.group)
        ? liveTeams.has(bot.group)
        : !bot.ephemeral || active.has(bot.taskId) || (!active.size && bot.taskId === latestTeam)
  );
}

function renderBots() {
  const box = $('#bots');
  clear(box);
  const legend = $('#net-legend');
  clear(legend);
  const onMap = mapBots();
  const counts = new Map();
  for (const bot of onMap) counts.set(bot.provider, (counts.get(bot.provider) || 0) + 1);
  for (const [key, n] of counts) {
    const meta = providerMeta(key);
    const item = el('span', { class: 'legend-item' });
    item.append(
      el('i', { style: { background: meta.color } }),
      el('span', { class: 'lbl', text: meta.label }),
      el('span', { class: 'n', text: String(n) })
    );
    legend.append(item);
  }
  window.AgentNet?.setBots(onMap, state.providers);

  const grouped = new Map();
  for (const group of state.groups) grouped.set(group.id, []);
  for (const bot of onMap) {
    if (!grouped.has(bot.group)) grouped.set(bot.group, []);
    grouped.get(bot.group).push(bot);
  }
  for (const [groupId, bots] of grouped) {
    if (!bots.length) continue;
    if (groupId === 'forge') continue;
    const group = state.groups.find((g) => g.id === groupId);
    const groupWorkers = bots.filter((b) => b.role !== 'boss');
    const groupBoss = bots.find((b) => b.role === 'boss');
    const groupLabel = el('span', { class: 'group-label' },
      el('span', { text: group?.name || groupId }),
      group?.ephemeral
        ? el('span', {
            class: 'team-tag',
            text: group.uses > 1 ? `সেভ করা দল · ${group.uses} বার` : 'স্বয়ংক্রিয় দল',
            title: group.purpose || ''
          })
        : null
    );
    box.append(
      el('div', { class: 'group-title' }, groupLabel)
    );
    for (const bot of [...groupWorkers, ...(groupBoss ? [groupBoss] : [])]) {
      const card = el('div', {
        class: `bot-card${bot.role === 'boss' ? ' boss' : ''}${bot.ephemeral ? ' ephemeral' : ''}`,
        on: { click: () => openBotEditor(bot) }
      });
      const meta = providerMeta(bot.provider);
      const avatar = el('div', { class: 'avatar-wrap' },
        el('span', {
          class: 'bot-avatar',
          style: { color: meta.color },
          text: (bot.name || '?').trim().charAt(0)
        }),
        el('span', { class: `dot ${bot.status || 'idle'}`, title: STATUS_LABEL[bot.status] || bot.status })
      );
      card.append(avatar);
      const main = el('div', { class: 'bot-main' });
      const nameRow = el('div', { class: 'bot-name' }, el('span', { text: bot.name }));
      if (bot.role === 'boss') nameRow.append(el('span', { class: 'boss-tag', text: 'Boss' }));
      if (bot.ephemeral) nameRow.append(el('span', { class: 'team-tag', text: 'দল' }));
      nameRow.append(providerBadge(bot.provider));
      main.append(nameRow);
      card.append(main);
      box.append(card);
    }
  }
}

function renderTasks() {
  const box = $('#tasks');
  clear(box);
  $('#queue-info').textContent = state.queue ? `${state.queue.running} run · ${state.queue.waiting} wait` : '';
  if (!state.tasks.length) {
    box.append(el('div', { class: 'empty', text: 'এখনো কোনো কাজ চালানো হয়নি।' }));
    return;
  }
  for (const task of state.tasks) {
    const item = el('div', {
      class: `task-item${task.id === selectedTaskId ? ' active' : ''}`,
      dataset: { status: task.status },
      on: {
        click: () => {
          dockJump(task.id);
          renderTasks();
        }
      }
    });
    const meta = el('div', { class: 'm' });
    meta.append(
      ...[
        el('span', { class: 'status-pill ' + task.status, text: TASK_LABEL[task.status] || task.status }),
        task.team ? el('span', { class: 'team-tag', text: task.team.groupName }) : null,
        el('span', { text: fmtTime(task.createdAt) }),
        el('span', { text: `${(task.turns || []).filter((t) => t.kind === 'bot').length} ধাপ` })
      ].filter(Boolean)
    );
    item.append(el('div', { class: 't', text: task.prompt }), meta);
    if (task.id === selectedTaskId) {
      const actions = el('div', { class: 'task-actions' });
      if (task.status === 'running' || task.status === 'queued') {
        actions.append(
          el('button', {
            class: 'btn danger small',
            text: 'থামাও',
            on: {
              click: async (event) => {
                event.stopPropagation();
                try {
                  await api('/api/task/cancel', 'POST', { id: task.id });
                  toast('থামানোর অনুরোধ পাঠানো হয়েছে');
                } catch (err) {
                  toast(err.message);
                }
              }
            }
          })
        );
      } else if (['error', 'need_login', 'cancelled'].includes(task.status)) {
        actions.append(
          el('button', {
            class: 'btn primary small',
            text: 'আবার চালাও',
            on: {
              click: async (event) => {
                event.stopPropagation();
                try {
                  await api('/api/task/retry', 'POST', { id: task.id });
                  toast('যেখানে থেমেছিল সেখান থেকেই আবার শুরু হচ্ছে');
                  await refresh();
                } catch (err) {
                  toast(err.message);
                }
              }
            }
          })
        );
      }
      if (actions.childNodes.length) item.append(actions);
    }
    box.append(item);
  }
}

function openModal(title, bodyBuilder, onSave) {
  $('#modal-title').textContent = title;
  const body = $('#modal-body');
  clear(body);
  bodyBuilder(body);
  modalSave = onSave;
  $('#modal-save').classList.toggle('hidden', !onSave);
  $('#modal').classList.remove('hidden');
}

function closeModal() {
  $('#modal').classList.add('hidden');
  modalSave = null;
}

function currentConfig() {
  return {
    settings: { ...(state.settings || {}) },
    accounts: state.accounts.map((a) => ({ id: a.id, name: a.name, browser: a.browser, profile: a.profile })),
    groups: state.groups.map((g) => ({
      id: g.id,
      name: g.name,
      boss: g.boss || null,
      ...(g.ephemeral ? { ephemeral: true, taskId: g.taskId } : {}),
      // দল চেনার তথ্য — এটা গেলে সেভ করা দল আর মিলত না
      ...(g.purpose ? { purpose: g.purpose } : {}),
      ...(g.keywords?.length ? { keywords: g.keywords } : {}),
      ...(g.leadId ? { leadId: g.leadId } : {}),
      ...(g.uses ? { uses: g.uses, lastUsed: g.lastUsed, createdAt: g.createdAt } : {})
    })),
    bots: state.bots.map((b) => ({
      id: b.id,
      name: b.name,
      group: b.group,
      provider: b.provider,
      account: b.account,
      role: b.role,
      system: b.system,
      ...(b.ephemeral ? { ephemeral: true, taskId: b.taskId } : {})
    }))
  };
}

function phonePanel(share) {
  const box = el('div', { class: 'share-box' });
  const secure = share?.secureUrls?.length ? `${share.secureUrls[0]}?key=${share.key}` : '';
  const link = secure || (share?.urls?.length ? `${share.urls[0]}/?key=${share.key}` : '');
  const input = el('input', { class: 'share-link', value: link, readonly: true });
  const list = el('div', { class: 'dev-list' });

  const load = async () => {
    try {
      const r = await api('/api/devices');
      const devices = r.devices || [];
      list.textContent = '';
      if (!devices.length) {
        list.append(el('p', { class: 'muted small', text: 'এখনো কোনো ফোন যুক্ত হয়নি — উপরের লিংকটি ফোনে খুলুন।' }));
        return;
      }
      for (const d of devices) {
        const row = el(
          'div',
          { class: 'dev-row' },
          el('span', { class: `dev-dot ${d.online ? 'on' : ''}` }),
          el('span', { class: 'dev-name', text: d.name }),
          el('span', {
            class: 'dev-meta',
            text: `${d.platform}${d.battery != null ? ` · ${Math.round(d.battery)}%` : ''} · ${d.online ? 'অনলাইন' : 'অফলাইন'}`
          }),
          el('button', {
            class: 'btn small',
            type: 'button',
            text: '🔊',
            on: {
              click: async () => {
                const r2 = await api('/api/device/command', 'POST', { id: d.id, type: 'speak', text: 'এজেন্ট শুনছে — ফোন কন্ট্রোল চলছে।' });
                toast(r2.ok ? `${d.name}-ে কমান্ড পাঠানো হয়েছে` : r2.error || 'পাঠানো যায়নি');
              }
            }
          }),
          el('button', {
            class: 'btn small',
            type: 'button',
            text: '✕',
            on: {
              click: async () => {
                await api('/api/device', 'DELETE', { id: d.id });
                toast(`${d.name} মুছে ফেলা হয়েছে`);
                load();
              }
            }
          })
        );
        list.append(row);
      }
    } catch {
      list.textContent = 'ডিভাইস তালিকা আনা যায়নি।';
    }
  };

  box.append(
    el('div', { class: 'micro', text: 'ফোন কন্ট্রোল · একই WiFi' }),
    el('p', {
      class: 'muted small',
      text: link
        ? secure
          ? 'এই লিংকটি ফোনের Chrome-এ খুলুন — সবুজ তালা/Warning এলে “Advanced → Continue” দিন (নিজেই বানানো সার্টিফিকেট)। তাহলে ফোনে মাইক, এজেন্টের কমান্ড আর 📸 স্ক্রিনশট পাঠানো সব চলবে (মোবাইল ব্রাউজারে লাইভ স্ক্রিন শেয়ার চলে না, তাই স্ক্রিন দেখাতে স্ক্রিনশট পাঠাতে হয়)। এজেন্ট এখন ফোন আর PC দুটোই চালাতে পারবে।'
          : 'ফোনে HTTP লিংক খুললে শুধু লিখে কাজ পাঠানো যাবে; মাইক আর 📸 স্ক্রিনশট পাঠানো চলবে না (সেগুলোর জন্য HTTPS দরকার, এখনো চালু হয়নি)।'
        : 'কোনো LAN IP পাওয়া যায়নি — WiFi সংযোগ দেখুন।'
    })
  );
  if (link) {
    box.append(
      el(
        'div',
        { class: 'share-row' },
        input,
        el('button', {
          class: 'btn small',
          type: 'button',
          text: 'কপি',
          on: {
            click: async () => {
              try {
                await navigator.clipboard.writeText(link);
                toast('ফোনের লিংক কপি হয়েছে');
              } catch {
                input.select();
                toast('লিংক সিলেক্ট করা হয়েছে — কপি করুন');
              }
            }
          }
        })
      )
    );
  }
  box.append(el('div', { class: 'share-row' }, el('span', { class: 'micro', text: 'যুক্ত ডিভাইস' }), el('button', { class: 'btn small', type: 'button', text: 'তাজা করো', on: { click: load } })));
  box.append(list);
  load();
  const timer = setInterval(() => {
    if (document.contains(box)) load();
    else clearInterval(timer);
  }, 6000);
  return box;
}

function openSettings() {
  const cfg = currentConfig();
  openModal(
    'সেটিংস · config.json',
    (body) => {
      const share = state.share;
      if (share) body.append(phonePanel(share));
      body.append(
        el('p', { class: 'muted small', text: 'বট, গ্রুপ, অ্যাকাউন্ট যোগ/বদল করতে নিচের JSON সম্পাদনা করুন।' }),
        el('textarea', { id: 'config-editor', value: JSON.stringify(cfg, null, 2), spellcheck: false })
      );
    },
    async () => {
      try {
        const next = JSON.parse($('#config-editor').value);
        await api('/api/config', 'PUT', next);
        closeModal();
        toast('সেটিংস সেভ হয়েছে');
        await refresh();
      } catch (err) {
        toast(`সেভ হয়নি: ${err.message}`);
      }
    }
  );
}

function openApiModal() {
  const s = state.settings || {};
  const customs = (s.customApis || []).map((a) => ({ ...a }));
  const textInput = (value, placeholder = '') => el('input', { value: value || '', placeholder, spellcheck: false });
  const passInput = (value, placeholder = 'sk-…') =>
    el('input', { type: 'password', value: value || '', placeholder, spellcheck: false, autocomplete: 'off' });
  const field = (labelText, input) => el('label', {}, el('span', { text: labelText }), input);
  const section = (labelText) => el('p', { class: 'micro', text: labelText });

  // কী কাজ করছে কিনা — এই ফর্মে যা লেখা আছে সেটাই পাঠিয়ে দেখে (সেভ ছাড়াই)
  const testRow = (gather) => {
    const out = el('span', { class: 'api-test' });
    const btn = el('button', {
      class: 'btn small ghost',
      type: 'button',
      text: 'টেস্ট',
      on: {
        click: async () => {
          btn.disabled = true;
          btn.textContent = 'চেক…';
          out.className = 'api-test';
          out.textContent = '';
          try {
            const r = await api('/api/providers/test', 'POST', gather());
            out.textContent = r.ok
              ? `✓ কাজ করছে · ${r.ms}ms${r.reply ? ` · “${r.reply.slice(0, 28)}”` : ''}`
              : `✗ ${r.error || 'কাজ করছে না'}`;
            out.classList.add(r.ok ? 'ok' : 'bad');
          } catch (err) {
            out.textContent = `✗ ${err.message}`;
            out.classList.add('bad');
          }
          btn.disabled = false;
          btn.textContent = 'টেস্ট';
        }
      }
    });
    return el('div', { class: 'api-test-row' }, btn, out);
  };

  let geminiKey, geminiModel, openaiKey, openaiModel, openaiBase, dsKey, dsModel;
  let routeSel = currentRouteMode();

  openModal(
    'API কী · যেকোনো মডেল',
    (body) => {
      body.append(
        el(
          'p',
          { class: 'muted small' },
          'কী দিলে সেই মডেল সরাসরি API দিয়ে চলবে — ব্রাউজার লগইন লাগবে না। কীগুলো শুধু এই কম্পিউটারের config.json-এ থাকে।'
        )
      );

      // লেনের নিয়ম: কোন মোড চলছে সেটা এখান থেকেই বাছো (সেভ বোতাম চাপলে বসবে)
      const picker = routeModeRow(
        (m) => {
          routeSel = m;
          picker.draw();
          renderLanes();
        },
        () => routeSel
      );
      const laneBoard = el('div', { class: 'lane-board' });
      async function renderLanes() {
        clear(laneBoard);
        if (routeSel === 'web') {
          laneBoard.append(
            el('p', { class: 'muted small', text: 'এখন সব কাজ ফ্রি ওয়েব AI (জেমিনি/ChatGPT) দিয়ে চলবে — কোনো API লেন ব্যবহার হবে না, খরচ বাঁচবে।' })
          );
          return;
        }
        let data = { lanes: [] };
        try {
          data = await api('/api/lanes');
        } catch {
          laneBoard.append(el('p', { class: 'muted small', text: 'লেনের অবস্থা দেখা যায়নি।' }));
          return;
        }
        if (!data.lanes.length) {
          laneBoard.append(
            el('p', {
              class: 'muted small',
              text:
                routeSel === 'api'
                  ? '⚠ "শুধু API" মোড কিন্তু কোনো লেন নেই — নিচে কী দাও, নাহলে কাজ থামবে (ওয়েব লেন বন্ধ)।'
                  : 'কোনো API লেন নেই — তাই কাজ ফ্রি ওয়েব AI-তে চলবে।'
            })
          );
          return;
        }
        const live = data.lanes.filter((l) => l.ok > 0).sort((a, b) => b.ok - a.ok)[0];
        laneBoard.append(
          el('p', {
            class: 'muted small',
            text: live
              ? `এই মুহূর্তে উত্তর আসছে: ${live.label} (${live.model}) · ${live.lastMs}ms · ${live.ok} বার`
              : routeSel === 'api'
                ? 'এখনো কোনো API লেন সফল হয়নি — "শুধু API" মোডে ব্যর্থ হলে ওয়েব লেন চলবে না।'
                : 'এখনো কোনো API লেন সফল হয়নি — ব্যর্থ হলে সঙ্গে সঙ্গে জেমিনি/ChatGPT ওয়েব লেন চলবে।'
          })
        );
        for (const l of data.lanes) {
          const state = !l.ready ? `✗ বন্ধ (${Math.round(l.coolingMs / 1000)}s পর আবার চেষ্টা)` : l.ok ? '✓ চলছে' : '• ইমপায়ার্ড';
          laneBoard.append(
            el('div', { class: 'lane-row' },
              el('span', { class: `lane-dot ${l.ready && l.ok !== 0 ? 'ok' : 'bad'}` }),
              el('span', { class: 'lane-name', text: `${l.label} · ${l.model}` }),
              el('span', { class: 'muted small', text: `${state}${l.fails ? ` · ব্যর্থ ${l.fails}` : ''}` })
            )
          );
          if (l.lastError) laneBoard.append(el('p', { class: 'muted tiny', text: l.lastError.slice(0, 110) }));
        }
      }
      body.append(picker.node, laneBoard);
      renderLanes();

      body.append(section('GEMINI'));
      const gemini = el('div', { class: 'form-grid' });
      geminiKey = passInput(s.geminiApiKey, 'AIza…');
      geminiModel = textInput(s.geminiApiModel, 'gemini-3.8-flash');
      gemini.append(field('KEY', geminiKey), field('MODEL', geminiModel));
      body.append(gemini, testRow(() => ({ kind: 'gemini', apiKey: geminiKey.value, model: geminiModel.value })));

      body.append(section('OPENAI / CHATGPT'));
      const openai = el('div', { class: 'form-grid' });
      openaiKey = passInput(s.openaiApiKey, 'sk-…');
      openaiModel = textInput(s.openaiApiModel, 'gpt-4o-mini');
      openaiBase = textInput(s.openaiBaseUrl, 'https://api.openai.com/v1');
      openai.append(field('KEY', openaiKey), field('MODEL', openaiModel), field('BASE URL', openaiBase));
      body.append(openai, testRow(() => ({ kind: 'openai', apiKey: openaiKey.value, model: openaiModel.value, baseUrl: openaiBase.value })));

      body.append(section('DEEPSEEK'));
      const ds = el('div', { class: 'form-grid' });
      dsKey = passInput(s.deepseekApiKey, 'sk-…');
      dsModel = textInput(s.deepseekApiModel, 'deepseek-chat');
      ds.append(field('KEY', dsKey), field('MODEL', dsModel));
      body.append(ds, testRow(() => ({ kind: 'openai', apiKey: dsKey.value, model: dsModel.value, baseUrl: 'https://api.deepseek.com' })));

      body.append(
        section('যেকোনো OpenAI-সামঞ্জস্যপূর্ণ API'),
        el('p', { class: 'muted small', text: 'OpenRouter, Groq, Mistral, Together, Ollama, LM Studio — যেকোনো base URL + key + model। বট এডিটরে provider হিসেবে এই নামটা বেছে নিতে পারবে।' })
      );
      const customsBox = el('div');
      const renderCustoms = () => {
        clear(customsBox);
        customs.forEach((api, idx) => {
          const grid = el('div', { class: 'form-grid' });
          const name = textInput(api.name, 'নাম (যেমন OpenRouter)');
          const base = textInput(api.baseUrl, 'https://api.openrouter.ai/api/v1');
          const model = textInput(api.model, 'model নাম');
          const key = passInput(api.key, 'sk-…');
          name.addEventListener('input', () => { api.name = name.value; });
          base.addEventListener('input', () => { api.baseUrl = base.value; });
          model.addEventListener('input', () => { api.model = model.value; });
          key.addEventListener('input', () => { api.key = key.value; });
          grid.append(field('NAME', name), field('MODEL', model), field('BASE URL', base), field('KEY', key));
          customsBox.append(
            el(
              'div',
              { class: 'api-row' },
              grid,
              testRow(() => ({ kind: 'openai', apiKey: key.value, model: model.value, baseUrl: base.value })),
              el('button', {
                class: 'btn danger small',
                type: 'button',
                text: 'বাদ দাও',
                on: {
                  click: () => {
                    customs.splice(idx, 1);
                    renderCustoms();
                  }
                }
              })
            )
          );
        });
        customsBox.append(
          el('button', {
            class: 'btn small',
            type: 'button',
            text: '+ আরেকটা API',
            on: {
              click: () => {
                customs.push({ id: `api-${Date.now().toString(36)}`, name: '', baseUrl: '', model: '', key: '' });
                renderCustoms();
              }
            }
          })
        );
      };
      renderCustoms();
      body.append(customsBox);
    },
    async () => {
      try {
        const cfg = currentConfig();
        cfg.settings = {
          ...cfg.settings,
          geminiApiKey: geminiKey.value.trim(),
          geminiApiModel: geminiModel.value.trim() || 'gemini-3.8-flash',
          openaiApiKey: openaiKey.value.trim(),
          openaiApiModel: openaiModel.value.trim() || 'gpt-4o-mini',
          openaiBaseUrl: openaiBase.value.trim() || 'https://api.openai.com/v1',
          deepseekApiKey: dsKey.value.trim(),
          deepseekApiModel: dsModel.value.trim() || 'deepseek-chat',
          preferApi: routeSel !== 'web',
          routeMode: routeSel,
          customApis: customs.filter((a) => a.baseUrl.trim() && a.key.trim()).map((a) => ({
            id: a.id,
            name: a.name.trim() || a.id,
            baseUrl: a.baseUrl.trim(),
            model: a.model.trim(),
            key: a.key.trim()
          }))
        };
        await api('/api/config', 'PUT', cfg);
        closeModal();
        toast('API সেটিংস সেভ হয়েছে');
        await refresh();
      } catch (err) {
        toast(`সেভ হয়নি: ${err.message}`);
      }
    }
  );
}

function openBotEditor(bot) {
  openModal(
    `বট · ${bot.name}`,
    (body) => {
      const grid = el('div', { class: 'form-grid' });
      const name = el('input', { value: bot.name });
      const provider = el('select');
      for (const [key, meta] of Object.entries(state.providers)) {
        provider.append(el('option', { value: key, text: meta.label }));
      }
      provider.value = bot.provider;
      const account = el('select');
      for (const acc of state.accounts) account.append(el('option', { value: acc.id, text: acc.name }));
      account.value = bot.account;
      const group = el('select');
      for (const g of state.groups) group.append(el('option', { value: g.id, text: g.name }));
      group.value = bot.group;
      grid.append(
        el('label', {}, el('span', { text: 'নাম' }), name),
        el('label', {}, el('span', { text: 'প্রোভাইডার' }), provider),
        el('label', {}, el('span', { text: 'অ্যাকাউন্ট' }), account),
        el('label', {}, el('span', { text: 'গ্রুপ' }), group),
        el('label', { class: 'full' }, el('span', { text: 'সিস্টেম প্রম্পট / ভূমিকা' }), el('textarea', { id: 'bot-system', value: bot.system }))
      );
      body.append(grid);
      body.dataset.botId = bot.id;
      body.dataset.values = '1';
      openBotEditor.fields = { name, provider, account, group };
    },
    async () => {
      const fields = openBotEditor.fields;
      try {
        await api('/api/bot', 'PUT', {
          id: bot.id,
          name: fields.name.value.trim() || bot.id,
          provider: fields.provider.value,
          account: fields.account.value,
          group: fields.group.value,
          system: $('#bot-system').value
        });
        closeModal();
        toast('বট সেভ হয়েছে');
        await refresh();
      } catch (err) {
        toast(`সেভ হয়নি: ${err.message}`);
      }
    }
  );
}

async function refresh() {
  state = await api('/api/state');
  if (!selectedTaskId && state.tasks.length) selectedTaskId = state.tasks[0].id;
  if (selectedTaskId && !state.tasks.some((t) => t.id === selectedTaskId)) {
    selectedTaskId = state.tasks[0]?.id || null;
  }
  renderAll();
}

function connect() {
  const es = new EventSource('/api/events');

  es.addEventListener('hello', (event) => {
    state = JSON.parse(event.data);
    if (!selectedTaskId && state.tasks.length) selectedTaskId = state.tasks[0].id;
    renderAll();
  });

  es.addEventListener('task', (event) => {
    if (!state) return;
    const task = JSON.parse(event.data);
    const index = state.tasks.findIndex((t) => t.id === task.id);
    if (index >= 0) state.tasks[index] = task;
    else {
      state.tasks.unshift(task);
      if (!selectedTaskId) selectedTaskId = task.id;
    }
    if (task.status === 'need_login' && task.id === selectedTaskId) {
      toast('লগইন দরকার — বাঁ দিক থেকে সাইটে লগইন করুন', 5000);
    }
    renderTasks();
    renderLive();
    if (task.status === 'done' || task.status === 'error') refresh().catch(() => {});
  });

  es.addEventListener('notes', () => {
    refresh().catch(() => {});
  });

  es.addEventListener('status', (event) => {
    if (!state) return;
    const map = JSON.parse(event.data);
    for (const bot of state.bots) bot.status = map[bot.id] || 'idle';
    renderBots();
  });

  es.addEventListener('browsers', () => {
    refresh().catch(() => {});
  });

  es.addEventListener('config', () => {
    refresh().catch(() => {});
  });

  es.onopen = () => {
    const node = $('#engine');
    node.classList.add('on');
    if (state) renderEngine();
    else node.textContent = 'LINK';
  };
  es.onerror = () => {
    const node = $('#engine');
    node.textContent = 'OFFLINE';
    node.classList.remove('on');
  };
}

async function submitPrompt(promptText) {
  const button = $('#btn-run');
  button.disabled = true;
  try {
    const attachments = [];
    for (let i = 0; i < pendingFiles.length; i += 1) {
      const file = pendingFiles[i];
      const data = await fileToBase64(file);
      const res = await api('/api/upload', 'POST', { name: file.name, mime: file.type, data });
      attachments.push(res.attachment);
    }
    // স্ক্রিন থেকে ঘেরা ছবিগুলো ডিস্কেই আছে — পাথ রেফারেন্স হিসেবে চলে
    attachments.push(...pendingShows.map((s) => s.attachment));
    const { task } = await api('/api/task', 'POST', {
      prompt: promptText,
      startBot: null,
      autoTeam: true,
      attachments
    });
    selectedTaskId = task.id;
    $('#prompt').value = '';
    pendingFiles = [];
    pendingShows = [];
    renderPendingFiles();
    renderTasks();
    renderLive({ toBottom: true });
    toast('কাজ শুরু হয়েছে — বটরা ব্রাউজারে কাজ করছে');
    return task;
  } catch (err) {
    toast(err.message);
    return null;
  } finally {
    button.disabled = false;
  }
}

// ---------- বাম পাশের ডক রেল + ডুকে-থাকা ডেক ----------

const DOCK_PANELS = {
  screen: 'ম্যাপ ও স্ক্রিন',
  accounts: 'অ্যাকাউন্ট',
  chat: 'চ্যাট ইতিহাস',
  search: 'খোঁজো',
  files: 'ফাইল',
  notes: 'নোট ও শেখা পাঠ',
  tasks: 'টাস্ক',
  bots: 'Bot দল'
};

let dockPanel = '';
let dockFiles = null;
let shotTimer = null;

function dockIsOpen() {
  return document.body.classList.contains('deck-open');
}

function dockPaint() {
  for (const btn of document.querySelectorAll('.dock-btn[data-dock]')) {
    const on = dockIsOpen() && btn.dataset.dock === dockPanel;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-expanded', on ? 'true' : 'false');
  }
  for (const panel of document.querySelectorAll('.deck-panel')) {
    panel.hidden = !(dockIsOpen() && panel.dataset.panel === dockPanel);
  }
  document.body.classList.toggle('dock-wide', dockIsOpen() && dockPanel === 'screen');
  const title = $('#deck-title');
  if (title) title.textContent = DOCK_PANELS[dockPanel] || 'কন্ট্রোল ডেক';
}

function dockShow(panel) {
  dockPanel = DOCK_PANELS[panel] ? panel : 'screen';
  document.body.classList.add('deck-open');
  dockPaint();
  if (dockPanel === 'files') loadDockFiles();
  if (dockPanel === 'search') renderDockSearch();
  if (dockPanel === 'screen') {
    startShots();
    // প্যানেল লুকানো অবস্থা থেকে চওড়া ওভারলেতে বড় হয় — ক্যানভাস আবার মাপ নেয়
    window.AgentNet?.resize();
    setTimeout(() => window.AgentNet?.resize(), 260);
  } else {
    stopShots();
  }
}

function dockHide() {
  dockPanel = '';
  document.body.classList.remove('deck-open');
  dockPaint();
  stopShots();
}

function dockToggle(panel) {
  if (dockIsOpen() && dockPanel === panel) dockHide();
  else dockShow(panel);
}

// এজেন্টের ব্রাউজারের লাইভ স্ক্রিন (প্যানেল খোলা থাকলেই টানে)
function stopShots() {
  clearInterval(shotTimer);
  shotTimer = null;
}

async function pullShot() {
  const img = $('#browser-shot');
  const empty = $('#shot-empty');
  const state = $('#shot-state');
  if (!img) return;
  try {
    const res = await fetch(`/api/browser/shot?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const old = img.src;
    img.src = url;
    img.hidden = false;
    if (empty) empty.hidden = true;
    await img.decode().catch(() => {});
    if (state) {
      state.textContent = img.naturalWidth
        ? `${Math.round(blob.size / 1024)}KB · ${img.naturalWidth}x${img.naturalHeight}`
        : `${Math.round(blob.size / 1024)}KB`;
    }
    if (old && old.startsWith('blob:')) URL.revokeObjectURL(old);
  } catch (err) {
    img.hidden = true;
    if (empty) {
      empty.hidden = false;
      empty.textContent = /404|নেই/.test(err.message)
        ? 'এজেন্টের ব্রাউজার এখন খোলা নেই — একটা কাজ চালাও, এখানে পুরো স্ক্রিন লাইভ দেখাবে।'
        : err.message;
    }
    if (state) state.textContent = 'বন্ধ';
  }
}

function startShots() {
  stopShots();
  pullShot();
  shotTimer = setInterval(pullShot, 2000);
}

function dockJump(taskId) {
  const task = state?.tasks.find((t) => t.id === taskId);
  if (task) {
    const s = sessionOf(task);
    if (s && s.cur == null) openSession(s.id);
  }
  selectedTaskId = taskId;
  renderLive();
  renderDockChat();
  scrollToTask(taskId);
}

function exportTranscript() {
  const payload = {
    exportedAt: new Date().toISOString(),
    workspace: state?.workspace || '',
    tasks: (state?.tasks || []).map((t) => ({
      id: t.id,
      prompt: t.prompt,
      status: t.status,
      result: t.result || '',
      error: t.error || '',
      createdAt: t.createdAt,
      finishedAt: t.finishedAt,
      turns: t.turns || []
    })),
    notes: state?.notes || [],
    lessons: state?.lessons || []
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: `pc-agent-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json` });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast('ট্রান্সক্রিপ্ট ডাউনলোড হচ্ছে');
}

function bindDock() {
  const deck = $('#deck');
  const rail = $('#dock-rail');
  if (!deck || !rail) return;
  dockPaint();

  for (const btn of rail.querySelectorAll('.dock-btn')) {
    const panel = btn.dataset.dock;
    if (panel) {
      // শুধু ক্লিকে খোলে/বন্ধ হয় — হোভারে কিছু হয় না
      btn.addEventListener('click', () => dockToggle(panel));
      continue;
    }
    btn.addEventListener('click', () => {
      const act = btn.dataset.act;
      if (act === 'voice') $('#btn-voice')?.click();
      else if (act === 'export') exportTranscript();
      else if (act === 'menu') openSettings();
      else if (act === 'hat') toggleHat();
    });
  }

  const close = $('#deck-close');
  if (close) close.addEventListener('click', dockHide);

  const refresh = $('#dock-files-refresh');
  if (refresh) refresh.addEventListener('click', () => loadDockFiles(true));

  const search = $('#dock-search');
  if (search) search.addEventListener('input', renderDockSearch);

  // বাইরে ক্লিক করলে বা Esc চাপলে বন্ধ
  document.addEventListener('pointerdown', (event) => {
    if (!dockIsOpen()) return;
    if (deck.contains(event.target) || rail.contains(event.target)) return;
    dockHide();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && dockIsOpen()) dockHide();
  });
}

function renderDockAvatar() {
  const node = $('#dock-avatar');
  if (!node) return;
  const name = state?.accounts?.[0]?.name || 'এজেন্ট';
  node.textContent = String(name).trim().charAt(0) || 'এ';
  node.title = name;
}

function renderDockChat() {
  const box = $('#dock-chat');
  if (!box || !state) return;
  clear(box);
  const rows = sessions
    .map((s) => {
      const tasks = (state.tasks || []).filter((t) => sessionOf(t) === s);
      const first = tasks.length
        ? tasks.reduce((a, b) => (Number(a.createdAt) < Number(b.createdAt) ? a : b))
        : null;
      const last = tasks.length
        ? tasks.reduce((a, b) => (Number(a.createdAt) > Number(b.createdAt) ? a : b))
        : null;
      return { s, tasks, first, last };
    })
    .filter((r) => r.tasks.length || r.s.cur != null)
    .sort((a, b) => Number(b.last?.createdAt || b.s.cur || 0) - Number(a.last?.createdAt || a.s.cur || 0));
  if (!rows.length) {
    box.append(el('p', { class: 'note', text: 'এখনো কোনো কাজ হয়নি — নিচের বক্সে প্রথম কাজটা লিখে পাঠাও।' }));
    return;
  }
  for (const { s, tasks, first, last } of rows) {
    const isActive = s.cur != null;
    box.append(
      el('div', {
        class: `dock-row${isActive ? ' active' : ''}`,
        on: {
          click: () => {
            if (!isActive) openSession(s.id);
            renderLive({ toBottom: true });
            renderDockChat();
          }
        }
      },
        el('span', { class: `dot ${isActive ? 'running' : 'done'}`, 'aria-hidden': 'true' }),
        el('span', { class: 'dock-row-main' },
          el('span', { class: 'dock-row-title', text: first ? first.prompt || '(ছবি/ফাইল)' : 'নতুন চেট' }),
          el('span', {
            class: 'dock-row-sub',
            text: isActive
              ? `চলতি চেট · ${tasks.length} বার্তা`
              : last
                ? `${tasks.length} বার্তা · ${fmtTime(last.createdAt)}`
                : 'ফাঁকা চেট'
          })
        ))
    );
  }
}

function dockHits(query) {
  const q = query.toLowerCase().trim();
  if (!q || !state) return [];
  const hits = [];
  const push = (kind, label, sub, fn) => {
    if (hits.length < 40) hits.push({ kind, label, sub, fn });
  };

  for (const task of state.tasks || []) {
    const said = (task.turns || []).map((t) => t.say || t.reason || '').join(' ');
    if (`${task.prompt} ${task.result || ''} ${task.error || ''} ${said}`.toLowerCase().includes(q)) {
      push('টাস্ক', task.prompt || '(ছবি/ফাইল)', TASK_LABEL[task.status] || task.status, () => dockJump(task.id));
    }
  }
  for (const note of state.notes || []) {
    if (`${note.title || ''} ${note.prompt || ''} ${note.result || ''}`.toLowerCase().includes(q)) {
      push('নোট', note.title || 'নোট', `${note.uses || 1} বার`, () => dockShow('notes'));
    }
  }
  for (const lesson of state.lessons || []) {
    if (`${lesson.lesson || ''} ${lesson.tool || ''}`.toLowerCase().includes(q)) {
      push('পাঠ', String(lesson.lesson || '').slice(0, 90), lesson.tool || 'সাধারণ', () => dockShow('notes'));
    }
  }
  for (const bot of state.bots || []) {
    if (`${bot.name} ${bot.groupName || ''} ${bot.providerLabel || ''}`.toLowerCase().includes(q)) {
      push('বট', bot.name, bot.groupName || bot.group, () => {
        dockShow('bots');
        openBotEditor(bot);
      });
    }
  }
  for (const file of dockFiles || []) {
    if (file.path.toLowerCase().includes(q)) {
      push('ফাইল', file.name, file.path, () => dockShow('files'));
    }
  }
  return hits;
}

function renderDockSearch() {
  const box = $('#dock-search-list');
  if (!box || !state) return;
  const query = $('#dock-search')?.value || '';
  clear(box);
  if (!query.trim()) {
    box.append(el('p', { class: 'note', text: 'টাস্ক, নোট, শেখা পাঠ, বট আর ফাইল — সবখানেই খুঁজবে। একটা শব্দ লেখো।' }));
    return;
  }
  const hits = dockHits(query);
  if (!hits.length) {
    box.append(el('p', { class: 'note', text: `"${query}" নামে কিছু পাওয়া যায়নি।` }));
    return;
  }
  let lastKind = '';
  for (const hit of hits) {
    if (hit.kind !== lastKind) {
      box.append(el('div', { class: 'dock-row-kind', text: hit.kind }));
      lastKind = hit.kind;
    }
    box.append(
      el('div', { class: 'dock-row', on: { click: hit.fn } },
        el('span', { class: 'dock-row-main' },
          el('span', { class: 'dock-row-title', text: hit.label }),
          el('span', { class: 'dock-row-sub', text: hit.sub })
        ))
    );
  }
}

function renderDockFiles() {
  const box = $('#dock-files');
  if (!box) return;
  clear(box);
  const files = dockFiles || [];
  if (!files.length) {
    box.append(el('p', { class: 'note', text: 'workspace-এ এখনো কোনো ফাইল নেই — এজেন্ট কাজ করলে এখানে দেখা যাবে।' }));
    return;
  }
  for (const file of files.slice(0, 60)) {
    box.append(
      el('div', {
        class: 'dock-row',
        title: 'ক্লিক করলে পাথ কপি হবে',
        on: {
          click: async () => {
            const full = `${state?.workspace || ''}/${file.path}`;
            try {
              await navigator.clipboard.writeText(full);
              toast('ফাইল পাথ কপি হয়েছে');
            } catch {
              toast(full);
            }
          }
        }
      },
        el('span', { class: 'dock-file-ext', text: (fileExt(file.name) || 'file').slice(0, 4) }),
        el('span', { class: 'dock-row-main' },
          el('span', { class: 'dock-row-title', text: file.path }),
          el('span', { class: 'dock-row-sub', text: `${fmtSize(file.size)} · ${new Date(file.mtime).toLocaleString('bn-BD', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}` })
        ))
    );
  }
}

async function loadDockFiles(force) {
  const box = $('#dock-files');
  if (!box) return;
  if (dockFiles && !force) {
    renderDockFiles();
    return;
  }
  clear(box);
  box.append(el('p', { class: 'note', text: 'ফাইলগুলো পড়া হচ্ছে…' }));
  try {
    const data = await api('/api/files');
    dockFiles = data.files || [];
    renderDockFiles();
    if (dockPanel === 'search') renderDockSearch();
  } catch (err) {
    clear(box);
    box.append(el('p', { class: 'note', text: err.message }));
  }
}

function bind() {
  $('#btn-run').addEventListener('click', async () => {
    primeTts();
    const prompt = $('#prompt').value.trim();
    if (!prompt && !pendingFiles.length && !pendingShows.length) {
      toast('আগে কাজটা লিখুন বা একটা ফাইল দিন');
      $('#prompt').focus();
      return;
    }
    const pausedVoice = voicePauseForTask();
    const task = await submitPrompt(prompt);
    if (task && pausedVoice) voiceTaskId = task.id;
    else if (pausedVoice) voiceResumeAfterTask();
  });

  $('#btn-voice').addEventListener('click', () => {
    primeTts();
    if (!SpeechRec) {
      toast('এই ব্রাউজারে ভয়েস ইনপুট নেই — Chrome বা Edge ব্যবহার করো');
      return;
    }
    if (voiceOn) {
      turnVoiceOff();
      toast('ভয়েস বন্ধ');
      return;
    }
    voiceOn = true;
    speakOn = true;
    voicePaused = false;
    voiceBase = ($('#prompt')?.value || '').trim();
    voiceInterim = '';
    voiceSuspended = false;
    voiceButtons();
    openVoiceScreen();
  });

  $('#btn-speak').addEventListener('click', () => {
    primeTts();
    speakOn = !speakOn;
    voiceButtons();
    toast(speakOn ? 'AI এখন ভয়েজে উত্তর দেবে' : 'AI ভয়েস বন্ধ');
  });

  $('#voice-close').addEventListener('click', () => {
    if (voiceScreenOpen) turnVoiceOff();
  });

  $('#voice-attach').addEventListener('click', () => {
    primeTts();
    $('#file-input').click();
  });

  $('#voice-mascot')?.addEventListener('click', () => {
    if (voicePickerOpen()) hideVoicePicker();
    else showVoicePicker();
  });

  document.addEventListener('pointerdown', (event) => {
    if (!voicePickerOpen()) return;
    const box = $('#voice-picker');
    if (box.contains(event.target) || event.target.closest?.('#voice-mascot')) return;
    hideVoicePicker();
  });

  $('#voice-mic').addEventListener('click', () => {
    if (!voiceScreenOpen || voiceSuspended) return;
    if (voicePaused) {
      voicePaused = false;
      voiceButtons();
      setVoiceStage('listening', '');
      bumpExcite();
      flashHappy(1500);
      startListening();
    } else {
      voicePaused = true;
      clearTimeout(voiceTimer);
      stopListening();
      voiceButtons();
      setVoiceStage('paused', '');
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    closeSnipMenu();
    if (voicePickerOpen()) hideVoicePicker();
    else if (voiceScreenOpen) turnVoiceOff();
  });

  if ('speechSynthesis' in window) {
    try {
      window.speechSynthesis.getVoices();
      window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
    } catch { /* voices may not be enumerable */ }
  }

  $('#btn-attach').addEventListener('click', () => $('#file-input').click());
  $('#file-input').addEventListener('change', (event) => {
    addFiles([...event.target.files]);
    event.target.value = '';
  });

  $('#btn-snip').addEventListener('click', (event) => {
    event.stopPropagation();
    toggleSnipMenu();
  });
  for (const opt of document.querySelectorAll('#snip-menu .snip-opt')) {
    opt.addEventListener('click', () => snipPick(opt.dataset.snip));
  }
  document.addEventListener('click', (event) => {
    if (event.target.closest('#snip-menu') || event.target.closest('#btn-snip')) return;
    closeSnipMenu();
  });

  const composer = $('.cmd');
  for (const type of ['dragenter', 'dragover']) {
    composer.addEventListener(type, (event) => {
      if (![...(event.dataTransfer?.types || [])].includes('Files')) return;
      event.preventDefault();
      composer.classList.add('drag');
    });
  }
  for (const type of ['dragleave', 'drop']) {
    composer.addEventListener(type, (event) => {
      event.preventDefault();
      if (type === 'dragleave' && composer.contains(event.relatedTarget)) return;
      composer.classList.remove('drag');
    });
  }
  composer.addEventListener('drop', (event) => {
    event.preventDefault();
    addFiles([...(event.dataTransfer?.files || [])]);
  });
  $('#prompt').addEventListener('paste', (event) => {
    const files = [...(event.clipboardData?.files || [])];
    if (files.length) addFiles(files);
  });

  $('#btn-settings').addEventListener('click', openSettings);
  $('#modal-close').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', (event) => {
    if (event.target === $('#modal')) closeModal();
  });
  $('#modal-save').addEventListener('click', () => {
    if (modalSave) modalSave();
  });

  const startNewChat = () => {
    const now = Date.now();
    closeActive(now);
    sessions.push({ id: 's' + now, segs: [], cur: now });
    saveSessions();
    renderLive({ toBottom: true });
    renderDockChat();
    $('#prompt').focus();
    toast('নতুন চেট শুরু — আগের চেট "চ্যাট ইতিহাস" প্যানেলে জমা হয়েছে');
  };

  $('#btn-new-chat').addEventListener('click', startNewChat);
  $('#btn-new-chat-mobile')?.addEventListener('click', startNewChat);

  $('#btn-newtab').addEventListener('click', async () => {
    try {
      const r = await api('/api/browser/newtab', 'POST', {});
      toast(r.closed ? `${r.closed}টি পুরনো ট্যাব বন্ধ — এখন থেকে সব কাজ একটাই ফাঁকা ট্যাবে চলবে` : 'ব্রাউজার খোলা নেই — পরের কাজ ফাঁকা ট্যাবে শুরু হবে');
      await refresh();
    } catch (err) {
      toast(err.message);
    }
  });

  $('#btn-close-browser').addEventListener('click', async () => {
    try {
      await api('/api/browser/close', 'POST', {});
      toast('ব্রাউজার বন্ধ করা হয়েছে');
      await refresh();
    } catch (err) {
      toast(err.message);
    }
  });

  $('#prompt').addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      $('#btn-run').click();
    }
  });

  if (window.AgentNet) {
    window.AgentNet.onPick = (id) => {
      const bot = state?.bots.find((b) => b.id === id);
      if (bot) openBotEditor(bot);
    };
  }

  bindDock();
  applyMascot(mascotId, false);
  // ফোনে ডক প্যানেল প্রবাহে সবসময় দেখা যায় — স্ক্রিন টানও সবসময় চলতে হবে
  if (window.matchMedia('(max-width: 1120px)').matches) startShots();

  const tickClock = () => {
    const node = $('#clock');
    if (node) node.textContent = `LOCAL ${new Date().toLocaleTimeString('en-GB', { hour12: false })}`;
  };
  tickClock();
  setInterval(tickClock, 1000);

  connect();
}

bind();
