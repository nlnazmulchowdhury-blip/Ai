/* ফোন অ্যাপ — PC ড্যাশবোর্ডের একই গ্লাস থিম, একই অপশন, মোবাইল লেআউটে।
   ফোন → PC: চেট/মাইক দিয়ে কাজ, লাইভ দল/নোট/স্ক্রিন/ফাইল দেখা
   PC → ফোন: এজেন্টের কমান্ড (বলা, নোটিফিকেশন, কার্ড, লিংক, অ্যালার্ম, স্ক্রিন শেয়ার) */

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) node.addEventListener(ev, fn);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') node.innerHTML = v;
    else node.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    node.append(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  }
  return node;
};
const clear = (node) => {
  while (node.firstChild) node.firstChild.remove();
};
const fmtTime = (ms) => new Date(ms).toLocaleTimeString('bn-BD', { hour: '2-digit', minute: '2-digit' });
const fmtSize = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b > 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`);
const clip = (s, n) => String(s || '').slice(0, n);

let state = null;
let deviceId = localStorage.getItem('pa.device') || '';
let deviceName = '';
let speakReplies = localStorage.getItem('pa.voice') !== 'off';
let tab = localStorage.getItem('pa.tab') || 'chat';
let shareOn = false;
let shareStream = null;
let wakeLock = null;
let ringNode = null;
let pcAuto = localStorage.getItem('pa.pcauto') === 'on';
let pcSource = localStorage.getItem('pa.pcsrc') || 'desktop';
let lastSeenTask = '';
let pendingBot = '';
const seenCmds = new Set();
const doneSeen = new Set(JSON.parse(localStorage.getItem('pa.done') || '[]'));

/* ---------------- টোস্ট / বলা ---------------- */
let toastTimer = null;
function toast(msg, ms = 2600) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

function say(text, force) {
  if (!text) return;
  if (!force && !speakReplies) return;
  try {
    const u = new SpeechSynthesisUtterance(plainText(text).slice(0, 600));
    u.lang = 'bn-BD';
    const bn = window.speechSynthesis.getVoices().find((v) => /^bn|bengali/i.test(v.lang));
    if (bn) u.voice = bn;
    u.rate = 1.02;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch {
    /* বলা না চললে চুপ থাকবে */
  }
}

function buzz(pattern) {
  try {
    if (navigator.vibrate) navigator.vibrate(pattern || [90, 60, 120]);
  } catch {
    /* ভাইব্রেশন নেই */
  }
}

/* ---------------- চেট থ্রেড ---------------- */
const THREAD_KEY = 'pa.thread';
let thread = JSON.parse(localStorage.getItem(THREAD_KEY) || '[]');

function saveThread() {
  thread = thread.slice(-160);
  localStorage.setItem(THREAD_KEY, JSON.stringify(thread));
}

// কাঁচা JSON চেটে/থ্রেডে দেখাবে না — ব্রেস আর ইংরেজি কী-নাম কেটে সমতল লেখা
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

function pushLine(kind, text, meta) {
  if (!text) return;
  thread.push({ kind, text: plainText(text), meta: meta || '', at: Date.now() });
  saveThread();
  renderChat();
}

const TASK_LABEL = { queued: 'লাইন-আপে', running: 'চলছে', done: 'সম্পন্ন', error: 'ব্যর্থ', cancelled: 'থামানো', need_login: 'লগইন লাগবে' };

function msgRow(avatar, text, cls) {
  return el('div', { class: `msg${cls ? ` ${cls}` : ''}` }, el('div', { class: 'avatar', text: avatar }), el('div', { class: 'bubble', text: plainText(text) }));
}

function quickChips() {
  const SUGGEST = ['আজকের ঢাকার আবহাওয়া', 'আজকের ডলার রেট', 'ইউটিউবে গান চালাও', 'PC-র স্ক্রিন দেখে বলো কী খোলা', 'আমার ফাইলগুলো দেখাও'];
  const row = el('div', { class: 'quick-chips' });
  for (const text of SUGGEST) {
    row.append(el('button', { type: 'button', class: 'chip', text, on: { click: () => { $('text').value = text; $('text').focus(); } } }));
  }
  row.append(el('button', { type: 'button', class: 'chip', text: 'আরও…', on: { click: () => openSheet() } }));
  return row;
}

function emptyThread() {
  const box = el('div', { class: 'empty-thread' });
  box.append(msgRow('AI', 'হ্যালো! আমি প্রস্তুত — কী কাজ বলবে?'));
  box.append(el('div', { class: 'msg user' }, el('div', { class: 'bubble', text: 'যেমন: আজকের ঢাকার আবহাওয়া আর ডলার রেট…' })));
  box.append(msgRow('AI', 'এই ফোন থেকেই PC চালাতে পারবে — স্ক্রিন দেখা, ক্লিক-টাইপ, ফাইল, দল, নোট সব ট্যাবে আছে'));
  box.append(quickChips());
  return box;
}

function renderChat() {
  const box = $('chat');
  if (!box) return;
  const stick = box.parentElement.scrollHeight - box.parentElement.scrollTop - box.parentElement.clientHeight < 200;
  clear(box);
  const hasUser = thread.some((l) => l.kind === 'me');
  for (const line of thread) {
    if (line.kind === 'me') {
      box.append(el('div', { class: 'msg user' }, el('div', { class: 'bubble', text: line.text })));
      if (line.meta) box.append(el('div', { class: 'msg-meta user', text: line.meta }));
    } else if (line.kind === 'tool') {
      box.append(msgRow('⚙', line.text));
    } else if (line.kind === 'boss') {
      box.append(msgRow('B', line.text));
    } else if (line.kind === 'phone') {
      box.append(msgRow('📱', line.text));
    } else if (line.kind === 'err') {
      box.append(msgRow('!', line.text, 'err'));
    } else {
      box.append(msgRow('AI', line.text));
    }
  }
  if (!hasUser) box.append(emptyThread());
  const running = (state?.tasks || []).find((t) => t.status === 'running' || t.status === 'queued');
  if (running) box.append(runningCard(running));
  if (stick) box.parentElement.scrollTop = box.parentElement.scrollHeight;
}

function runningCard(t) {
  const turns = (t.turns || []).filter((x) => ['bot', 'tool', 'boss', 'eye', 'team'].includes(x.kind)).slice(-3);
  const box = el('div', { class: 'thread-block' });
  for (const turn of turns) {
    if (turn.kind === 'tool') box.append(msgRow('⚙', (turn.results || []).map((r) => `${r.ok === false ? '✗' : '✓'} ${r.tool || '?'}`).join('   ')));
    else if (turn.kind === 'eye') box.append(msgRow('E', `${turn.verdict === 'yes' ? '✓' : turn.verdict === 'no' ? '✗' : '•'} স্ক্রিন দেখে: ${clip(turn.seen, 130)}`));
    else if (turn.kind === 'team') box.append(msgRow('দ', `${turn.stage === 'plan' ? 'পরিকল্পনা' : turn.stage === 'build' ? 'নকশা' : 'দল'}: ${clip(turn.say, 140)}`));
    else if (turn.kind === 'boss') box.append(msgRow('B', `${turn.verdict === 'fix' ? 'সংশোধন: ' : 'ঠিক আছে: '}${clip(turn.reason, 130)}`));
    else box.append(msgRow(clip(String(turn.botName || 'AI'), 1), turn.say || '…'));
  }
  if (!turns.length) box.append(msgRow('AI', t.chat || t.fast ? 'উত্তর দিচ্ছি…' : t.status === 'queued' ? 'লাইন-আপে অপেক্ষা করছে…' : 'কাজ শুরু হচ্ছে…'));
  box.append(
    el(
      'div',
      { class: 'p-row', style: 'border-top:0' },
      el('span', { class: 'tag', text: `${TASK_LABEL[t.status] || t.status} · ${(t.turns || []).length} ধাপ` }),
      el('span', { class: 'grow' }),
      el('button', {
        class: 'p-btn',
        type: 'button',
        text: 'বাতিল',
        on: {
          click: async () => {
            await api('/api/task/cancel', 'POST', { id: t.id });
            toast('কাজ থামানো হচ্ছে');
          }
        }
      }),
      el('button', {
        class: 'p-btn',
        type: 'button',
        text: 'বিস্তারিত',
        on: { click: () => openSheet(() => taskSheet(t)) }
      })
    )
  );
  return box;
}

function taskSheet(t) {
  const box = el('div', {});
  box.append(el('button', { class: 'opt', type: 'button', text: `${TASK_LABEL[t.status] || t.status} · ${t.id} · ধাপ ${(t.turns || []).length}` }));
  for (const turn of (t.turns || []).slice(-14)) {
    const text = turn.kind === 'tool'
      ? `⚙ ${(turn.results || []).map((r) => `${r.ok === false ? '✗' : '✓'}${r.tool}`).join(' ')}`
      : `${turn.kind === 'boss' ? 'B' : 'AI'} ${plainText(clip(turn.say || turn.reason || turn.text || '', 120))}`;
    box.append(el('button', { class: 'opt', type: 'button', text }));
  }
  if (t.result) box.append(el('button', { class: 'opt', type: 'button', text: `ফলাফল: ${clip(plainText(typeof t.result === 'string' ? t.result : JSON.stringify(t.result)), 160)}` }));
  if (t.error) box.append(el('button', { class: 'opt danger', type: 'button', text: `ত্রুটি: ${clip(t.error, 160)}` }));
  if (['error', 'cancelled', 'need_login'].includes(t.status)) {
    box.append(el('button', {
      class: 'opt',
      type: 'button',
      text: '↻ আবার চালাও',
      on: {
        click: async () => {
          await api('/api/task/retry', 'POST', { id: t.id });
          closeSheet();
          toast('আবার শুরু হয়েছে');
        }
      }
    }));
  }
  return box;
}

/* ---------------- দল / নোট / ফাইল ---------------- */
function renderTeam() {
  const rows = $('teamRows');
  clear(rows);
  const bots = state?.bots || [];
  if (!bots.length) rows.append(el('div', { class: 'p-row', text: 'কোনো বট নেই' }));
  for (const b of bots) {
    rows.append(
      el(
        'div',
        { class: 'p-row' },
        el('span', { class: 'p-dot', id: `bot-${b.id}`, style: b.status && b.status !== 'idle' ? 'background:var(--cyan);box-shadow:0 0 8px rgba(168,200,255,.6)' : '' }),
        el('span', { class: 'grow' }, el('span', { class: 't', text: b.name }), el('span', { class: 's', text: `${b.groupName || b.group} · ${b.providerLabel || b.provider}` })),
        el('span', { class: 'tag', text: b.role === 'boss' ? 'বস' : b.status === 'idle' ? 'খালি' : b.status || 'খালি' })
      )
    );
  }
  const gr = $('groupRows');
  clear(gr);
  for (const g of state?.groups || []) {
    const crew = bots.filter((b) => b.group === g.id);
    gr.append(
      el(
        'div',
        { class: 'p-row' },
        el('span', { class: 'grow' }, el('span', { class: 't', text: g.name }), el('span', { class: 's', text: `${crew.filter((b) => b.role === 'boss').length} বস · ${crew.filter((b) => b.role !== 'boss').length} কর্মী${g.uses > 1 ? ` · সেভ করা · ${g.uses} বার` : ''}` })),
        el('button', {
          class: 'p-btn',
          type: 'button',
          text: 'কাজ দাও',
          on: {
            click: () => {
              $('text').value = `${g.name} দিয়ে `;
              switchTab('chat');
              $('text').focus();
            }
          }
        })
      )
    );
  }
}

function renderNotes() {
  const notes = state?.notes || [];
  const lessons = state?.lessons || [];
  const fails = notes.filter((n) => n.outcome === 'fail').length;
  $('notesHead').textContent = `${notes.length} নোট · ${fails} ব্যর্থ`;
  const rows = $('noteRows');
  clear(rows);
  if (!notes.length) rows.append(el('div', { class: 'p-row', text: 'এখনো কোনো নোট নেই' }));
  for (const n of notes) {
    const tools = new Map();
    for (const t of n.tools || []) {
      const prev = tools.get(t.tool);
      if (!prev || prev.ok) tools.set(t.tool, t);
    }
    rows.append(
      el(
        'div',
        { class: 'p-row' },
        el('span', { class: 'tag', text: n.outcome === 'fail' ? '✗' : '✓', style: n.outcome === 'fail' ? 'color:var(--red)' : 'color:var(--green)' }),
        el('span', {
          class: 'grow',
          onclick: () => toast(clip(n.outcome === 'fail' ? n.error || n.prompt : n.result || n.prompt, 160), 4200)
        },
          el('span', { class: 't', text: clip(n.prompt, 60) }),
          el('span', { class: 's', text: `${n.uses || 1} বার · ✓${n.okCount || 0}/✗${n.failCount || 0} · ${[...tools.keys()].slice(0, 4).join(' ') || 'টুলহীন'}` })
        ),
        el('button', {
          class: 'p-btn',
          type: 'button',
          text: '✕',
          on: {
            click: async () => {
              await fetch(`/api/notes?id=${encodeURIComponent(n.id)}`, { method: 'DELETE' });
              toast('নোট মুছে ফেলা হয়েছে');
              refresh();
            }
          }
        })
      )
    );
  }
  const lr = $('lessonRows');
  clear(lr);
  if (!lessons.length) lr.append(el('div', { class: 'p-row', text: 'কোনো শেখা পাঠ নেই' }));
  for (const l of lessons.slice(0, 20)) {
    lr.append(
      el('div', { class: 'p-row' },
        el('span', { class: 'grow' }, el('span', { class: 't', text: clip(l.lesson, 90) }), el('span', { class: 's', text: `${l.tool || '—'}${l.count > 1 ? ` · ${l.count} বার` : ''}${l.wins ? ` · ✓ পরে ${l.wins} বার সফল` : ''}` }))
      )
    );
  }
}

async function loadFiles() {
  const rows = $('fileRows');
  clear(rows);
  try {
    const j = await api('/api/files');
    $('filesHead').textContent = `${(j.files || []).length} ফাইল · ${clip(j.workspace, 30)}`;
    for (const f of (j.files || []).slice(0, 60)) {
      rows.append(
        el('div', { class: 'p-row' },
          el('span', { class: 'grow' }, el('span', { class: 't', text: f.path }), el('span', { class: 's', text: `${fmtSize(f.size)} · ${fmtTime(f.mtime)}` })),
          el('button', {
            class: 'p-btn',
            type: 'button',
            text: 'পড়ে বলো',
            on: { click: () => send(`${f.path} ফাইলটি পড়ে সংক্ষেপে কী আছে বলো।`) }
          })
        )
      );
    }
  } catch (err) {
    rows.append(el('div', { class: 'p-row', text: `ফাইল আনা যায়নি: ${err.message}` }));
  }
}

/* ---------------- স্ক্রিন ট্যাব ---------------- */
let pcTimer = null;
async function pullPc(force) {
  const box = $('pcShot');
  const img = $('pcImg');
  if (img.complete && img.naturalWidth && !force && !pcAuto) return;
  box.classList.add('busy');
  const src = pcSource === 'browser' ? '/api/browser/shot' : `/api/screen/live?ms=3500&t=${Date.now()}`;
  try {
    const r = await fetch(src);
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const old = img.src;
    img.src = url;
    if (old?.startsWith('blob:')) URL.revokeObjectURL(old);
    $('pcStamp').textContent = `${pcSource === 'browser' ? 'ব্রাউজার' : 'PC'} · ${fmtTime(Date.now())}`;
    $('hint').textContent = '';
  } catch (err) {
    $('hint').textContent = `স্ক্রিন আনা যায়নি: ${err.message}`;
  } finally {
    box.classList.remove('busy');
  }
}

function setPcAuto(on) {
  pcAuto = on;
  localStorage.setItem('pa.pcauto', on ? 'on' : 'off');
  $('btnPcAuto').classList.toggle('on', on);
  $('btnPcAuto').textContent = on ? 'অটো চালু' : 'অটো';
  clearInterval(pcTimer);
  if (on) pcTimer = setInterval(() => {
    if (tab === 'screen' && !document.hidden) pullPc(true);
  }, 5000);
}

function updateShareState() {
  const live = shareOn;
  const ageMin = lastShotAt ? Math.floor((Date.now() - lastShotAt) / 60000) : null;
  $('shareState').textContent = live
    ? 'লাইভ শেয়ার চালু — এজেন্ট এখন আপনার ফোনের স্ক্রিন দেখতে পাচ্ছে'
    : lastShotAt
      ? `শেষ স্ক্রিনশট পাঠানো হয়েছে ${ageMin <= 0 ? 'এইমাত্র' : `${ageMin} মিনিট আগে`} — এজেন্ট phone_screen দিয়ে সেটা দেখতে পাবে`
      : 'এজেন্ট এখনও ফোনের স্ক্রিন দেখেনি';
  $('btnShare').classList.toggle('on', live);
  $('btnShare').textContent = live ? 'বন্ধ করো' : 'লাইভ শেয়ার';
  $('btnShare').style.display = canLiveShare() ? '' : 'none';
  $('shareHelp').textContent = canLiveShare()
    ? 'লাইভ শেয়ার চালিয়ে রাখলে প্রতি ৩ সেকেন্ডে ফ্রেম যাবে; না চাইলে 📸 বোতামে একটা স্ক্রিনশট পাঠাও।'
    : 'ফোন ধরে Power + Volume down চাপুন, তারপর নিচের 📸 বোতামে নতুন ছবিটা বাছুন।';
}

/* ---------------- ট্যাব ---------------- */
function setPlaceholder() {
  const bot = pendingBot ? (state?.bots || []).find((b) => b.id === pendingBot) : null;
  $('text').placeholder = bot
    ? `${bot.name} দিয়ে কাজ লিখুন…`
    : tab === 'chat' ? 'এজেন্টকে বলো…' : 'যেকোনো ট্যাব থেকেই কাজ লেখা যায়…';
}

function switchTab(next) {
  tab = next;
  localStorage.setItem('pa.tab', next);
  for (const b of document.querySelectorAll('.p-tab')) b.classList.toggle('active', b.dataset.tab === next);
  for (const p of document.querySelectorAll('.p-pane')) p.classList.toggle('active', p.id === `pane-${next}`);
  if (next === 'screen') pullPc(false);
  if (next === 'files') loadFiles();
  if (next === 'team') renderTeam();
  if (next === 'notes') renderNotes();
  if (next === 'chat') renderChat();
  setPlaceholder();
}

/* ---------------- শিট (ক্লিক-অনলি) ---------------- */
function openSheet(builder) {
  const rows = $('sheetRows');
  clear(rows);
  rows.append(
    el('button', { class: `opt${speakReplies ? ' on' : ''}`, type: 'button', onclick: () => { speakReplies = !speakReplies; localStorage.setItem('pa.voice', speakReplies ? 'on' : 'off'); toast(speakReplies ? 'উত্তর জোরে পড়া হবে' : 'চুপ থাকবে'); closeSheet(); } },
      el('span', { text: '🔊 উত্তর জোরে পড়ো' }), el('span', { class: 'k', text: speakReplies ? 'চালু' : 'বন্ধ' })),
    el('button', { class: `opt${shareOn ? ' on' : ''}`, type: 'button', onclick: () => { closeSheet(); canLiveShare() ? toggleShare() : pickShot(); } },
      el('span', { text: canLiveShare() ? '📱 ফোনের স্ক্রিন লাইভ শেয়ার' : '📸 ফোনের স্ক্রিনশট পাঠাও' }),
      el('span', { class: 'k', text: shareOn ? 'চালু' : lastShotAt ? 'আগের স্ক্রিনশট আছে' : 'ছবি বেছে নাও' })),
    el('button', { class: `opt${pcAuto ? ' on' : ''}`, type: 'button', onclick: () => { closeSheet(); switchTab('screen'); setPcAuto(!pcAuto); pullPc(true); } },
      el('span', { text: '🖥 PC স্ক্রিন অটো-রিফ্রেশ' }), el('span', { class: 'k', text: pcAuto ? 'চালু' : 'বন্ধ' })),
    el('button', { class: `opt${wakeLock ? ' on' : ''}`, type: 'button', onclick: () => { closeSheet(); toggleWake(); } },
      el('span', { text: '☀ স্ক্রিন জ্বালিয়ে রাখো' }), el('span', { class: 'k', text: wakeLock ? 'চালু' : 'বন্ধ' })),
    el('button', { class: `opt${ringNode ? ' on' : ''}`, type: 'button', onclick: () => { closeSheet(); ringNode ? stopRing() : startRing(); } },
      el('span', { text: '🔔 অ্যালার্ম (এজেন্টও বাজাতে পারে)' }), el('span', { class: 'k', text: ringNode ? 'বাজছে' : 'থামাও/চালাও' })),
    el('button', { class: 'opt', type: 'button', onclick: () => { closeSheet(); openSheet(botPicker); } },
      el('span', { text: '🎯 বট বেছে কাজ দাও' }),
      el('span', { class: 'k', text: (state?.bots || []).find((b) => b.id === pendingBot)?.name || 'স্বয়ংক্রিয় দল' })),
    el('button', { class: 'opt', type: 'button', onclick: () => { closeSheet(); send('PC-র স্ক্রিনের ছবি তুলে দেখাও এখন কী খোলা আছে।'); } },
      el('span', { text: '👁 স্ক্রিন দেখে বলো' })),
    el('button', { class: 'opt', type: 'button', onclick: () => { closeSheet(); send('phone_list দিয়ে দেখো কোন ফোন যুক্ত আছে, তারপর এই ফোনে speak কমান্ড পাঠাও "এজেন্ট শুনছে" বলে।'); } },
      el('span', { text: '📡 ফোন কন্ট্রোল পরীক্ষা' })),
    el('button', { class: 'opt', type: 'button', onclick: () => { closeSheet(); archiveAndNew(); } },
      el('span', { text: '✚ নতুন চেট (আগেরটা ইতিহাসে জমা)' })),
    el('button', { class: 'opt', type: 'button', onclick: () => { closeSheet(); showArchive(); } },
      el('span', { text: '🗂 পুরনো চেট দেখাও' }), el('span', { class: 'k', text: `${JSON.parse(localStorage.getItem('pa.archived') || '[]').length} টি` })),
    el('button', { class: 'opt', type: 'button', onclick: () => { closeSheet(); refresh(); toast('ডেটা তাজা হয়েছে'); } },
      el('span', { text: '↻ ডেটা তাজা করো' })),
    el('button', { class: 'opt', type: 'button', onclick: () => { closeSheet(); toast(`${deviceName || 'ফোন'} · ${deviceId} · ${state?.share?.secureUrls?.[0] || location.origin}`); } },
      el('span', { text: 'ℹ️ এই ডিভাইস' })),
    el('button', { class: 'opt danger', type: 'button', onclick: () => { closeSheet(); forget(); } },
      el('span', { text: '🔌 এই ফোন ভুলে যাও' }))
  );
  if (builder) {
    rows.prepend(el('div', { class: 'p-row', style: 'border-top:0' }));
    rows.prepend(builder());
  }
  $('scrim').classList.add('show');
  $('sheet').classList.add('show');
  $('btnMore').setAttribute('aria-expanded', 'true');
}

function closeSheet() {
  $('scrim').classList.remove('show');
  $('sheet').classList.remove('show');
  $('btnMore').setAttribute('aria-expanded', 'false');
}

function archiveAndNew() {
  if (thread.length) {
    const arch = JSON.parse(localStorage.getItem('pa.archived') || '[]');
    arch.unshift({ at: Date.now(), lines: thread });
    localStorage.setItem('pa.archived', JSON.stringify(arch.slice(0, 20)));
  }
  thread = [];
  saveThread();
  switchTab('chat');
  renderChat();
  toast('নতুন চেট শুরু — আগেরটা ইতিহাসে জমা আছে');
}

function botPicker() {
  const box = el('div', {});
  const bots = state?.bots || [];
  if (!bots.length) box.append(el('button', { class: 'opt', type: 'button', text: 'কোনো বট নেই' }));
  for (const b of bots) {
    box.append(
      el('button', {
        class: `opt${b.id === pendingBot ? ' on' : ''}`,
        type: 'button',
        onclick: () => {
          pendingBot = b.id;
          closeSheet();
          switchTab('chat');
          setPlaceholder();
          $('text').focus();
        }
      },
        el('span', { text: `${b.name}${b.id === pendingBot ? ' ✓' : ''}` }),
        el('span', { class: 'k', text: `${b.role === 'boss' ? 'বস' : 'কর্মী'} · ${clip(b.providerLabel || b.provider, 10)}` })
      )
    );
  }
  return box;
}

function showArchive() {
  const arch = JSON.parse(localStorage.getItem('pa.archived') || '[]');
  openSheet(() => {
    const box = el('div', {});
    if (!arch.length) box.append(el('button', { class: 'opt', type: 'button', text: 'কোনো পুরনো চেট নেই' }));
    arch.forEach((a, i) => {
      box.append(el('button', {
        class: 'opt',
        type: 'button',
        text: `${fmtTime(a.at)} · ${a.lines.length} লাইন · ${clip((a.lines.find((l) => l.kind === 'me') || {}).text || 'চেট', 40)}`,
        on: {
          click: () => {
            closeSheet();
            thread = [{ kind: 'ai', text: `— ${fmtTime(a.at)} এর পুরনো চেট —` }, ...a.lines];
            saveThread();
            renderChat();
          }
        }
      }));
    });
    return box;
  });
}

/* ---------------- কাজ পাঠানো ---------------- */
async function api(path, method, body) {
  const r = await fetch(path, {
    method: method || 'GET',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

async function send(text) {
  const prompt = String(text || '').trim();
  if (!prompt) return;
  const startBot = pendingBot;
  pendingBot = '';
  $('text').value = '';
  setPlaceholder();
  pushLine('me', prompt, TASK_LABEL.queued);
  switchTab('chat');
  try {
    const j = await api('/api/task', 'POST', { prompt, autoTeam: true, startBot });
    const id = j.task?.id || j.id;
    if (id) thread[thread.length - 1].meta = `${TASK_LABEL.queued} · ${id}`;
    saveThread();
    renderChat();
  } catch (err) {
    pushLine('err', `পাঠানো যায়নি: ${err.message}`);
  }
}

/* ---------------- এজেন্টের কমান্ড ---------------- */
function flash(ms) {
  $('orb').classList.add('hot');
  setTimeout(() => {
    if (!ringNode && !(state?.queue?.running > 0)) $('orb').classList.remove('hot');
  }, ms || 5200);
}

function startRing() {
  if (ringNode) return;
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = 880;
  gain.gain.value = 0.13;
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  const lfo = setInterval(() => {
    osc.frequency.setValueAtTime(Math.random() > 0.5 ? 880 : 640, ctx.currentTime);
    buzz(120);
  }, 700);
  ringNode = { stop() { clearInterval(lfo); try { osc.stop(); ctx.close(); } catch { /* বন্ধ */ } } };
  flash(0);
  pushLine('phone', '🔔 অ্যালার্ম বাজছে — থামাতে ⋯ → অ্যালার্ম');
}

function stopRing() {
  if (!ringNode) return;
  ringNode.stop();
  ringNode = null;
  $('orb').classList.remove('hot');
  pushLine('phone', '🔕 অ্যালার্ম থেমেছে');
}

async function runCommand(cmd) {
  if (!cmd || !cmd.id || seenCmds.has(cmd.id)) return;
  seenCmds.add(cmd.id);
  if (seenCmds.size > 200) seenCmds.delete(seenCmds.values().next().value);
  if (cmd.type === 'speak') {
    say(cmd.text, true);
    pushLine('phone', `এজেন্ট বলেছে: ${cmd.text || ''}`);
  } else if (cmd.type === 'show') {
    pushLine('phone', `${cmd.title ? `${cmd.title}: ` : ''}${cmd.text || ''}`);
    say(cmd.text, true);
    buzz([120, 60, 160]);
    flash(9000);
  } else if (cmd.type === 'notify') {
    buzz();
    flash();
    pushLine('phone', `🔔 ${cmd.title || 'নোটিফিকেশন'}: ${cmd.text || ''}`);
    if ('Notification' in window && Notification.permission === 'granted') new Notification(cmd.title || 'PC Agent', { body: cmd.text || '' });
    else if ('Notification' in window && Notification.permission !== 'denied') Notification.requestPermission();
  } else if (cmd.type === 'open_url') {
    window.open(cmd.url, '_blank');
    pushLine('phone', `ফোনে লিংক খোলা হয়েছে: ${cmd.url || ''}`);
  } else if (cmd.type === 'ring') {
    if (cmd.stop) stopRing();
    else startRing();
  } else if (cmd.type === 'vibrate') {
    buzz(Math.min(3000, Number(cmd.ms) || 300));
  } else if (cmd.type === 'screen') {
    if (cmd.stop) {
      stopShare();
      pushLine('phone', 'স্ক্রিন শেয়ার বন্ধ হয়েছে');
      return;
    }
    if (shareOn) {
      const sent = await pushFrame();
      pushLine('phone', sent ? 'ফোনের স্ক্রিনের একটা ফ্রেম এজেন্টকে পাঠানো হয়েছে' : 'ফ্রেম পাঠানো যায়নি');
      return;
    }
    // লাইভ শেয়ার এই ব্রাউজারে নেই (মোবাইল) — স্ক্রিনশট পাঠানোর পথটা দেখানো হয়
    pendingScreenAsk = true;
    if (lastShotAt && Date.now() - lastShotAt < 90_000) {
      pushLine('phone', 'এজেন্ট স্ক্রিন দেখতে চাইছে — সদ্য পাঠানো স্ক্রিনশটটাই সে দেখতে পাবে');
      return;
    }
    switchTab('screen');
    pushLine('err', 'এজেন্ট আপনার ফোনের স্ক্রিন দেখতে চাইছে — স্ক্রিনটা ধরে Power + Volume down চাপুন, তারপর 📸 স্ক্রিনশট পাঠাও বোতামে নতুন ছবিটা বাছুন');
    toast('📸 স্ক্রিনশট পাঠাও');
    say('স্ক্রিন দেখাতে হয় — একটা স্ক্রিনশট তুলে 📸 বোতামে পাঠান', true);
  } else if (cmd.type === 'close_card') {
    stopRing();
  } else if (cmd.type === 'stop') {
    stopRing();
    say('থামানো হয়েছে', true);
  } else {
    pushLine('phone', `অজানা কমান্ড: ${cmd.type}`);
  }
}

/* ---------------- স্ক্রিন পাঠানো ---------------- */
// অ্যান্ড্রয়েড/iPhone-এর কোনো ব্রাউজারেই getDisplayMedia নেই — তাই সেখানে স্ক্রিনশট-টাই একমাত্র পথ
const canLiveShare = () => !!navigator.mediaDevices?.getDisplayMedia;
let lastShotAt = 0;
let pendingScreenAsk = false;

function pickShot() {
  $('shot').click();
}

async function sendShot(file) {
  if (!file) return false;
  if (!deviceId) {
    toast('ফোন এখনও PC-র সাথে যুক্ত নয় — পেজ রিলোড করো');
    return false;
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = () => rej(new Error('ছবি পড়া যায়নি'));
      img.src = url;
    });
    const scale = Math.min(1, 760 / Math.max(img.width, img.height));
    const cvs = document.createElement('canvas');
    cvs.width = Math.round(img.width * scale);
    cvs.height = Math.round(img.height * scale);
    cvs.getContext('2d').drawImage(img, 0, 0, cvs.width, cvs.height);
    const r = await fetch('/api/phone/frame', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: deviceId, dataUrl: cvs.toDataURL('image/jpeg', 0.7) })
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
    lastShotAt = Date.now();
    const wasAsked = pendingScreenAsk;
    pendingScreenAsk = false;
    updateShareState();
    pushLine('phone', `📸 স্ক্রিনশট পাঠানো হয়েছে (${cvs.width}×${cvs.height}) — ${wasAsked ? 'এজেন্টের অনুরোধ মিটেছে, সে এখনই স্ক্রিন দেখতে পাবে' : 'এজেন্ট এখন phone_screen দিয়ে দেখতে পাবে'}`);
    toast('স্ক্রিনশট এজেন্টের কাছে পৌঁছেছে');
    return true;
  } catch (err) {
    toast(`ছবি পাঠানো যায়নি: ${err.message}`);
    return false;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function startShare(silent) {
  if (!canLiveShare()) {
    $('shareHelp').textContent = 'এই ব্রাউজারে লাইভ স্ক্রিন শেয়ার নেই — Power + Volume down চেপে স্ক্রিনশট তুলে 📸 বোতাম দিয়ে পাঠান।';
    toast('লাইভ শেয়ার মোবাইল ক্রোমে চলে না — 📸 স্ক্রিনশট পাঠাও');
    return false;
  }
  try {
    shareStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 2 }, audio: false });
    $('cam').srcObject = shareStream;
    await $('cam').play();
    shareOn = true;
    shareStream.getVideoTracks()[0].addEventListener('ended', stopShare);
    $('hint').textContent = '';
    updateShareState();
    if (!silent) pushLine('phone', '📱 স্ক্রিন শেয়ার চালু — এজেন্ট এখন ফোন দেখতে পাবে');
    return true;
  } catch {
    $('hint').textContent = 'স্ক্রিন শেয়ারের অনুমতি দিতে হবে — পপ-আপে “Start sharing” চাপুন।';
    return false;
  }
}

function stopShare() {
  shareOn = false;
  try {
    (shareStream?.getTracks() || []).forEach((t) => t.stop());
  } catch {
    /* ইতিমধ্যে বন্ধ */
  }
  shareStream = null;
  $('cam').srcObject = null;
  updateShareState();
}

async function toggleShare() {
  if (shareOn) {
    stopShare();
    return;
  }
  await startShare(false);
}

async function pushFrame() {
  if (!shareOn || !deviceId) return false;
  const w = $('cam').videoWidth;
  const h = $('cam').videoHeight;
  if (!w || !h) return false;
  const scale = Math.min(1, 560 / w);
  const cvs = document.createElement('canvas');
  cvs.width = Math.round(w * scale);
  cvs.height = Math.round(h * scale);
  cvs.getContext('2d').drawImage($('cam'), 0, 0, cvs.width, cvs.height);
  try {
    const r = await fetch('/api/phone/frame', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: deviceId, dataUrl: cvs.toDataURL('image/jpeg', 0.62) })
    });
    return r.ok;
  } catch {
    return false;
  }
}

async function toggleWake() {
  try {
    if (wakeLock) {
      await wakeLock.release();
      wakeLock = null;
      toast('স্ক্রিন এখন নিভবে');
      return;
    }
    wakeLock = await navigator.wakeLock.request('screen');
    toast('স্ক্রিন জ্বলে থাকবে');
  } catch {
    toast('এই ব্রাউজারে ওয়েক লক চলে না');
  }
}

/* ---------------- পেয়ারিং + চ্যানেল ---------------- */
async function pair() {
  const ua = navigator.userAgent;
  const guess = /android/i.test(ua) ? 'অ্যান্ড্রয়েড ফোন' : /iphone|ipad/i.test(ua) ? 'আইফোন' : 'ফোন';
  const j = await api('/api/phone/pair', 'POST', { name: guess, ua });
  deviceId = j.device.id;
  deviceName = j.device.name;
  localStorage.setItem('pa.device', deviceId);
}

async function beat() {
  if (!deviceId) return;
  try {
    const body = { id: deviceId };
    if (navigator.getBattery) {
      const b = await navigator.getBattery();
      body.battery = b.level * 100;
      body.charging = b.charging;
    }
    const r = await fetch('/api/phone/beat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status === 404) {
      deviceId = '';
      localStorage.removeItem('pa.device');
      await pair();
      setDot(true);
      return;
    }
    const j = await r.json();
    setDot(true);
    for (const c of j.commands || []) await runCommand(c);
  } catch {
    setDot(false, true);
  }
}

function setDot(on, bad) {
  const d = $('dot');
  d.classList.toggle('on', !!on);
  d.classList.toggle('bad', !!bad);
  $('devline').textContent = on
    ? `${deviceName || 'ফোন'} যুক্ত · ${state?.queue ? `${state.queue.running} চলছে, ${state.queue.waiting} লাইনে` : 'প্রস্তুত'}`
    : 'PC খুঁজে পাওয়া যাচ্ছে না — একই WiFi দেখুন';
}

function listenChannel() {
  if (!deviceId) return;
  const es = new EventSource(`/api/phone/stream?id=${encodeURIComponent(deviceId)}`);
  es.addEventListener('cmd', (e) => {
    try {
      runCommand(JSON.parse(e.data));
    } catch {
      /* বাদ */
    }
  });
  es.onerror = () => {
    es.close();
    setTimeout(listenChannel, 6000);
  };
}

async function forget() {
  try {
    await api('/api/device', 'DELETE', { id: deviceId });
  } catch {
    /* ইতিমধ্যে মোছা */
  }
  localStorage.removeItem('pa.device');
  deviceId = '';
  deviceName = '';
  setDot(false, true);
  toast('ফোনটি PC থেকে সরানো হয়েছে — পেজ রিলোড করলে আবার যুক্ত হবে');
}

/* ---------------- স্টেট ---------------- */
function renderState() {
  setDot(!!deviceId);
  $('queuePill').textContent = state?.queue ? `${state.queue.running}·${state.queue.waiting}` : '—';
  $('queuePill').classList.toggle('on', (state?.queue?.running || 0) > 0);
  if ((state?.queue?.running || 0) > 0) $('orb').classList.add('hot');
  else if (!ringNode) $('orb').classList.remove('hot');
  if (tab === 'team') renderTeam();
  if (tab === 'notes') renderNotes();
  renderChat();
  syncTasks();
}

function saveDone() {
  localStorage.setItem('pa.done', JSON.stringify([...doneSeen].slice(-60)));
}

let seeded = false;
function syncTasks() {
  if (!seeded) {
    seeded = true;
    for (const t of state?.tasks || []) {
      if (['done', 'error', 'cancelled'].includes(t.status) && !thread.some((l) => l.meta && l.meta.includes(t.id))) doneSeen.add(t.id);
    }
    saveDone();
  }
  for (const t of state?.tasks || []) {
    if (t.status === 'done' && !doneSeen.has(t.id)) {
      doneSeen.add(t.id);
      saveDone();
      const text = typeof t.result === 'string' ? t.result : JSON.stringify(t.result || '');
      const mine = [...thread].reverse().findIndex((l) => l.meta && l.meta.includes(t.id));
      if (mine >= 0) {
        const idx = thread.length - 1 - mine;
        thread[idx].meta = `${TASK_LABEL.done} · ${fmtTime(t.createdAt)}`;
        saveThread();
      }
      pushLine('ai', clip(text, 1400));
      say(clip(text, 480));
      buzz([60, 40, 60]);
    } else if (t.status === 'error' && !doneSeen.has(t.id)) {
      doneSeen.add(t.id);
      saveDone();
      pushLine('err', `ব্যর্থ: ${clip(t.error || 'কাজটি হয়নি', 300)}`);
      buzz([120, 60, 120]);
    }
  }
}

async function refresh() {
  state = await api('/api/state');
  renderState();
}

function watchPc() {
  const es = new EventSource('/api/events');
  es.addEventListener('hello', (e) => {
    state = JSON.parse(e.data);
    renderState();
  });
  es.addEventListener('task', (e) => {
    const t = JSON.parse(e.data);
    const list = state?.tasks || [];
    const i = list.findIndex((x) => x.id === t.id);
    if (i >= 0) list[i] = t;
    else list.unshift(t);
    renderState();
  });
  es.addEventListener('notes', () => {
    if (tab === 'notes') refresh();
  });
  es.onerror = () => {
    es.close();
    setTimeout(watchPc, 7000);
  };
}

/* ---------------- মাইক ---------------- */
function startVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    $('hint').textContent = 'ভয়েস চলছে না — HTTPS লিংক দিয়ে খুলুন আর Chrome ব্যবহার করুন।';
    return;
  }
  const rec = new SR();
  rec.lang = 'bn-BD';
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  $('mic').classList.add('live');
  $('hint').textContent = 'শুনছি… বলুন।';
  rec.onresult = (e) => {
    const t = e.results?.[0]?.[0]?.transcript || '';
    if (t) send(t);
  };
  rec.onerror = (e) => {
    $('hint').textContent = e.error === 'not-allowed' ? 'মাইকের অনুমতি দিন (ব্রাউজার → Permission → Microphone)।' : 'ভালো শোনা যায়নি — আবার চেষ্টা করুন।';
  };
  rec.onend = () => {
    $('mic').classList.remove('live');
    $('hint').textContent = '';
  };
  rec.start();
}

/* ---------------- শুরু ---------------- */
function wire() {
  for (const b of document.querySelectorAll('.p-tab')) b.addEventListener('click', () => switchTab(b.dataset.tab));
  $('btnMore').addEventListener('click', (e) => {
    e.stopPropagation();
    $('sheet').classList.contains('show') ? closeSheet() : openSheet();
  });
  $('scrim').addEventListener('click', closeSheet);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSheet();
  });
  $('btnSend').addEventListener('click', () => send($('text').value));
  $('text').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') send(e.target.value);
  });
  $('mic').addEventListener('click', startVoice);
  $('pcShot').addEventListener('click', () => pullPc(true));
  $('btnPcRefresh').addEventListener('click', () => pullPc(true));
  $('btnPcAuto').addEventListener('click', () => setPcAuto(!pcAuto));
  $('btnBrowser').addEventListener('click', () => {
    pcSource = pcSource === 'browser' ? 'desktop' : 'browser';
    localStorage.setItem('pa.pcsrc', pcSource);
    $('btnBrowser').classList.toggle('on', pcSource === 'browser');
    $('btnBrowser').textContent = pcSource === 'browser' ? 'পুরো PC' : 'ব্রাউজার ট্যাব';
    $('pcAsk').textContent = pcSource === 'browser' ? 'Gemini/ChatGPT ট্যাব' : 'টেপ করলেই নতুন ছবি';
    pullPc(true);
  });
  $('btnShare').addEventListener('click', toggleShare);
  $('btnShot').addEventListener('click', pickShot);
  $('shot').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) await sendShot(file);
  });
  $('btnFilesRefresh').addEventListener('click', loadFiles);
  setPcAuto(pcAuto);
  updateShareState();
  switchTab(tab);
}

async function boot() {
  wire();
  try {
    if (deviceId) {
      const j = await api('/api/devices');
      deviceName = (j.devices.find((d) => d.id === deviceId) || {}).name || '';
      if (!deviceName) {
        deviceId = '';
        localStorage.removeItem('pa.device');
      }
    }
    if (!deviceId) await pair();
    setDot(true);
  } catch {
    setDot(false, true);
    $('hint').textContent = 'PC-এর সাথে সংযোগ হয়নি — একই WiFi আর ঠিক লিংক (https://PC-IP:4781/phone) দেখুন।';
  }
  try {
    await refresh();
  } catch {
    /* SSE-র অপেক্ষা */
  }
  listenChannel();
  watchPc();
  setInterval(beat, 10_000);
  setInterval(() => {
    if (shareOn) pushFrame();
    else if (lastShotAt && tab === 'screen') updateShareState();
  }, 6000);
  beat();
  if (!thread.length) pushLine('phone', `${deviceName || 'ফোন'} এখন PC Agent-এর সাথে যুক্ত — ট্যাবগুলো থেকে দল/নোট/স্ক্রিন/ফাইল দেখুন, নিচে লিখে বা মাইক চেপে কাজ দিন।`);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    beat();
    if (wakeLock) navigator.wakeLock.request('screen').then((l) => { wakeLock = l; }).catch(() => {});
    if (tab === 'screen') pullPc(true);
  }
});

boot();
