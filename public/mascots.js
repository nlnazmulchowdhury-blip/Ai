// ভয়েস স্ক্রিনের মাঝের কার্টুন (মাসকট) — সবগুলো 240x240 ভিউবক্সে, একই ক্লাস হুক:
// body = যে অংশ সবসময় থাকে, face = মুখ (চোখ/ভ্রু/মুখ), happy = মাঝে মাঝে নিজে থেকেই খুশি হওয়ার মুখ
// চোখের ভেতরে .pupil থাকলে সেটা মাউস ধরে ওদিক-এদিক সরে

const DARK = '#0a192f';

// "Bluey" — the blueberry focus friend from github.com/rbrown101010/bluey-by-riley (public domain).
// Body geometry mapped from iOS/Sources/BlobShape.swift + FaceView.swift (820x700 design box → 200x170 here).
const BERRY_INK = '#1C1F66';
const BERRY_PUPIL = '#17151F';
const BLUEY_BLOB =
  'M124 44 C177 44 220 87 220 139 C220 181 179 214 128 214 C80 214 20 182 20 143 C20 99 67 44 124 44 Z';
// Eyes/blush use objectBoundingBox gradients so both eyes paint themselves from the same defs.
const BLUEY_BODY = `
  <defs>
    <linearGradient id="bb-skin" gradientUnits="userSpaceOnUse" x1="70" y1="50" x2="176" y2="212">
      <stop offset="0" stop-color="#c8d8ff" />
      <stop offset=".24" stop-color="#8ba6fb" />
      <stop offset=".54" stop-color="#4f63e2" />
      <stop offset=".8" stop-color="#33379e" />
      <stop offset="1" stop-color="#1d1f5e" />
    </linearGradient>
    <radialGradient id="bb-shine" gradientUnits="userSpaceOnUse" cx="82" cy="74" r="70">
      <stop offset="0" stop-color="#fff" stop-opacity=".5" />
      <stop offset=".55" stop-color="#fff" stop-opacity=".12" />
      <stop offset="1" stop-color="#fff" stop-opacity="0" />
    </radialGradient>
    <radialGradient id="bb-depth" gradientUnits="userSpaceOnUse" cx="152" cy="196" r="96">
      <stop offset="0" stop-color="#0b0c3a" stop-opacity=".5" />
      <stop offset="1" stop-color="#0b0c3a" stop-opacity="0" />
    </radialGradient>
    <radialGradient id="bb-eye">
      <stop offset="0" stop-color="#fff" />
      <stop offset=".7" stop-color="#f6f9ff" />
      <stop offset="1" stop-color="#cfdcff" />
    </radialGradient>
    <radialGradient id="bb-cheek">
      <stop offset="0" stop-color="#ff9fd0" stop-opacity=".62" />
      <stop offset="1" stop-color="#ff9fd0" stop-opacity="0" />
    </radialGradient>
    <radialGradient id="bb-rim">
      <stop offset="0" stop-color="#bcd0ff" stop-opacity=".34" />
      <stop offset="1" stop-color="#bcd0ff" stop-opacity="0" />
    </radialGradient>
    <clipPath id="bb-clip"><path d="${BLUEY_BLOB}" /></clipPath>
  </defs>
  <path d="${BLUEY_BLOB}" fill="url(#bb-skin)" />
  <path d="${BLUEY_BLOB}" fill="url(#bb-depth)" />
  <g clip-path="url(#bb-clip)">
    <path d="${BLUEY_BLOB}" fill="url(#bb-shine)" />
    <ellipse cx="84" cy="58" rx="19" ry="7.5" fill="#fff" opacity=".34" transform="rotate(-13 84 58)" />
    <ellipse cx="64" cy="86" rx="6" ry="14" fill="#fff" opacity=".18" transform="rotate(-17 64 86)" />
    <ellipse cx="168" cy="190" rx="40" ry="15" fill="url(#bb-rim)" />
  </g>
  <g transform="translate(120 45) scale(1.3) translate(-120 -45)">
    <path class="sparkle" d="M120 39.5 122.1 43.5 127.6 42.2 123.5 46.3 125.5 50.3 120 47.6 114.6 50.3 116.6 46.3 112.5 42.2 118 43.5Z" fill="${BERRY_INK}" />
  </g>
  <ellipse class="cheek" cx="66" cy="122" rx="14" ry="8" fill="url(#bb-cheek)" />
  <ellipse class="cheek" cx="174" cy="122" rx="14" ry="8" fill="url(#bb-cheek)" />
`;
const BLUEY_CALM = `
  <path class="brow" d="M77.5 62.5Q86.8 58.1 96.1 62.5" stroke="${BERRY_INK}" stroke-width="3.4" fill="none" stroke-linecap="round" />
  <path class="brow" d="M144 62.5Q153.3 58.1 162.6 62.5" stroke="${BERRY_INK}" stroke-width="3.4" fill="none" stroke-linecap="round" />
  <g class="eye">
    <circle cx="87" cy="91" r="25" fill="url(#bb-eye)" />
    <g class="pupil">
      <circle cx="90" cy="93" r="12" fill="${BERRY_PUPIL}" />
      <circle cx="83.5" cy="84.5" r="4.2" fill="#fff" />
      <circle cx="94.5" cy="97.5" r="1.8" fill="#fff" opacity=".9" />
    </g>
  </g>
  <g class="eye">
    <circle cx="153" cy="91" r="25" fill="url(#bb-eye)" />
    <g class="pupil">
      <circle cx="150" cy="93" r="12" fill="${BERRY_PUPIL}" />
      <circle cx="143.5" cy="84.5" r="4.2" fill="#fff" />
      <circle cx="154.5" cy="97.5" r="1.8" fill="#fff" opacity=".9" />
    </g>
  </g>
  <ellipse class="mouth" cx="120" cy="125" rx="7.6" ry="5" fill="${BERRY_INK}" />
`;
const BLUEY_HAPPY = `
  <path class="brow" d="M75.5 57Q86.8 51 98 57" stroke="${BERRY_INK}" stroke-width="3.4" fill="none" stroke-linecap="round" />
  <path class="brow" d="M142 57Q153.3 51 164.5 57" stroke="${BERRY_INK}" stroke-width="3.4" fill="none" stroke-linecap="round" />
  <path d="M72 100Q87 77 102 100" stroke="${BERRY_PUPIL}" stroke-width="6.4" fill="none" stroke-linecap="round" />
  <path d="M138 100Q153 77 168 100" stroke="${BERRY_PUPIL}" stroke-width="6.4" fill="none" stroke-linecap="round" />
  <path class="mouth" d="M107 120.5Q120 135 133 120.5Z" fill="${BERRY_INK}" />
`;

export const MASCOTS = [
  {
    id: 'bowtie',
    name: 'বো-টাই',
    glow: '',
    body: `
      <path class="wing-l" d="M120 106 C88 84 52 76 41 96 C31 116 52 134 85 128 C101 124 114 116 120 112 Z" fill="#3fb950" />
      <path class="wing-r" d="M120 106 C152 84 188 76 199 96 C209 116 188 134 155 128 C139 124 126 116 120 112 Z" fill="#3fb950" />
      <rect x="106" y="98" width="28" height="22" rx="7" fill="#2e9e44" />
    `,
    face: `
      <g class="eye"><g class="pupil"><circle cx="120" cy="54" r="9" fill="${DARK}" /></g></g>
      <g class="eye"><g class="pupil"><circle cx="120" cy="88" r="9" fill="${DARK}" /></g></g>
    `,
    happy: `
      <path d="M110 58Q120 44 130 58" stroke="${DARK}" stroke-width="7" fill="none" stroke-linecap="round" />
      <path d="M110 92Q120 78 130 92" stroke="${DARK}" stroke-width="7" fill="none" stroke-linecap="round" />
    `
  },
  {
    id: 'blob',
    name: 'নীল ব্লব',
    glow: 'radial-gradient(circle, rgba(126,168,255,0.8) 0%, rgba(59,110,245,0.22) 44%, rgba(59,110,245,0) 72%)',
    body: `
      <path d="M120 36c46 0 80 32 80 74 0 42-36 70-80 70s-80-28-80-70c0-42 34-74 80-74Z" fill="#3b6ef5" />
      <path d="M120 36c46 0 80 32 80 74 0 7-1 14-3 20-7-40-39-62-77-62s-70 22-77 62c-2-6-3-13-3-20 0-42 34-74 80-74Z" fill="#78a3ff" opacity=".8" />
      <path d="M120 30l4 10 10 4-10 4-4 10-4-10-10-4 10-4Z" fill="${DARK}" opacity=".85" />
      <ellipse class="cheek" cx="60" cy="148" rx="13" ry="8" fill="#ff7aa8" opacity=".32" />
      <ellipse class="cheek" cx="180" cy="142" rx="13" ry="8" fill="#ff7aa8" opacity=".32" />
    `,
    face: `
      <path class="brow" d="M76 78 114 88" stroke="${DARK}" stroke-width="9" stroke-linecap="round" />
      <g class="eye">
        <ellipse cx="96" cy="116" rx="21" ry="25" fill="#f4f8ff" />
        <g class="pupil"><circle cx="91" cy="110" r="10" fill="${DARK}" /><circle cx="87" cy="105" r="3.2" fill="#fff" opacity=".9" /></g>
      </g>
      <g class="eye">
        <ellipse cx="147" cy="110" rx="21" ry="25" fill="#f4f8ff" />
        <g class="pupil"><circle cx="142" cy="104" r="10" fill="${DARK}" /><circle cx="138" cy="99" r="3.2" fill="#fff" opacity=".9" /></g>
      </g>
      <ellipse class="mouth" cx="121" cy="162" rx="10" ry="12" fill="${DARK}" />
    `,
    happy: `
      <path class="brow" d="M74 82 112 76" stroke="${DARK}" stroke-width="9" stroke-linecap="round" />
      <path d="M80 118Q96 94 112 118" stroke="${DARK}" stroke-width="8" fill="none" stroke-linecap="round" />
      <path d="M131 112Q147 88 163 112" stroke="${DARK}" stroke-width="8" fill="none" stroke-linecap="round" />
      <path class="mouth" d="M104 152Q121 180 138 152Z" fill="${DARK}" />
    `
  },
  {
    id: 'bluey',
    name: 'ব্লুবেরি',
    glow: 'radial-gradient(circle, rgba(169,188,255,0.7) 0%, rgba(66,84,214,0.22) 44%, rgba(66,84,214,0) 72%)',
    body: BLUEY_BODY,
    face: BLUEY_CALM,
    happy: BLUEY_HAPPY
  },
  {
    id: 'bluey-happy',
    name: 'ব্লুবেরি খুশি',
    glow: 'radial-gradient(circle, rgba(169,188,255,0.7) 0%, rgba(66,84,214,0.22) 44%, rgba(66,84,214,0) 72%)',
    body: BLUEY_BODY,
    face: BLUEY_HAPPY
  },
  {
    id: 'robot',
    name: 'রোবট',
    glow: 'radial-gradient(circle, rgba(180,214,255,0.72) 0%, rgba(120,170,255,0.2) 44%, rgba(120,170,255,0) 72%)',
    body: `
      <path d="M120 44v16" stroke="#8fb6ff" stroke-width="5" stroke-linecap="round" />
      <circle cx="120" cy="38" r="7" fill="#8fb6ff" />
      <rect x="38" y="98" width="14" height="36" rx="7" fill="#8fb6ff" />
      <rect x="188" y="98" width="14" height="36" rx="7" fill="#8fb6ff" />
      <rect x="52" y="60" width="136" height="116" rx="32" fill="#13233c" stroke="#8fb6ff" stroke-width="4" />
      <rect x="70" y="84" width="100" height="48" rx="18" fill="#080f1c" />
    `,
    face: `
      <g class="eye"><g class="pupil"><circle cx="98" cy="108" r="11" fill="#7fd6ff" /></g></g>
      <g class="eye"><g class="pupil"><circle cx="142" cy="108" r="11" fill="#7fd6ff" /></g></g>
      <g class="mouth">
        <rect x="94" y="146" width="52" height="12" rx="6" fill="#8fb6ff" />
        <rect x="106" y="146" width="4" height="12" fill="#13233c" />
        <rect x="130" y="146" width="4" height="12" fill="#13233c" />
      </g>
    `,
    happy: `
      <path d="M88 111Q98 94 108 111" stroke="#7fd6ff" stroke-width="7" fill="none" stroke-linecap="round" />
      <path d="M132 111Q142 94 152 111" stroke="#7fd6ff" stroke-width="7" fill="none" stroke-linecap="round" />
      <path class="mouth" d="M96 146Q120 168 144 146" stroke="#8fb6ff" stroke-width="9" fill="none" stroke-linecap="round" />
    `
  },
  {
    id: 'ghost',
    name: 'ঘোস্ট',
    glow: 'radial-gradient(circle, rgba(232,241,255,0.8) 0%, rgba(180,205,255,0.18) 44%, rgba(180,205,255,0) 72%)',
    body: `
      <path d="M120 38c35 0 62 27 62 62v70c0 9-10 13-16 6l-8-9c-5-5-12-4-16 2l-5 8c-5 7-13 7-18 0l-5-8c-4-6-11-7-16-2l-8 9c-6 7-16 3-16-6v-70c0-35 27-62 62-62Z" fill="#e9f0ff" opacity=".94" />
    `,
    face: `
      <g class="eye"><g class="pupil"><ellipse cx="98" cy="106" rx="11" ry="15" fill="${DARK}" /></g></g>
      <g class="eye"><g class="pupil"><ellipse cx="142" cy="106" rx="11" ry="15" fill="${DARK}" /></g></g>
      <ellipse class="mouth" cx="120" cy="146" rx="12" ry="14" fill="${DARK}" />
    `,
    happy: `
      <path d="M88 108Q98 90 108 108" stroke="${DARK}" stroke-width="7" fill="none" stroke-linecap="round" />
      <path d="M132 108Q142 90 152 108" stroke="${DARK}" stroke-width="7" fill="none" stroke-linecap="round" />
      <path class="mouth" d="M108 140Q120 162 132 140Z" fill="${DARK}" />
    `
  },
  {
    id: 'cat',
    name: 'বিড়াল',
    glow: 'radial-gradient(circle, rgba(206,224,255,0.75) 0%, rgba(143,182,255,0.2) 44%, rgba(143,182,255,0) 72%)',
    body: `
      <path d="M64 96 58 42 104 68Z" fill="#b9cdf2" />
      <path d="M176 96 182 42 136 68Z" fill="#b9cdf2" />
      <path d="M68 90 64 56 94 72Z" fill="#7fa8e8" />
      <path d="M172 90 176 56 146 72Z" fill="#7fa8e8" />
      <circle cx="120" cy="124" r="66" fill="#d7e4fb" />
      <path d="M120 138l-7 6h14Z" fill="${DARK}" />
      <path d="M56 132h26M58 146l24-4M184 132h-26M182 146l-24-4" stroke="#8fa9d6" stroke-width="3" stroke-linecap="round" />
    `,
    face: `
      <g class="eye">
        <g class="pupil">
          <ellipse cx="97" cy="116" rx="12" ry="16" fill="${DARK}" />
          <circle cx="93" cy="110" r="4" fill="#fff" opacity=".85" />
        </g>
      </g>
      <g class="eye">
        <g class="pupil">
          <ellipse cx="143" cy="116" rx="12" ry="16" fill="${DARK}" />
          <circle cx="139" cy="110" r="4" fill="#fff" opacity=".85" />
        </g>
      </g>
      <g class="mouth">
        <path d="M120 146v8" stroke="${DARK}" stroke-width="4" stroke-linecap="round" />
        <path d="M120 154c-7 8-17 7-22 1M120 154c7 8 17 7 22 1" stroke="${DARK}" stroke-width="4" fill="none" stroke-linecap="round" />
      </g>
    `,
    happy: `
      <path d="M85 118Q97 100 109 118" stroke="${DARK}" stroke-width="7" fill="none" stroke-linecap="round" />
      <path d="M131 118Q143 100 155 118" stroke="${DARK}" stroke-width="7" fill="none" stroke-linecap="round" />
      <path class="mouth" d="M120 146v6M120 152c-8 11-21 9-26 1M120 152c8 11 21 9 26 1" stroke="${DARK}" stroke-width="4" fill="none" stroke-linecap="round" />
    `
  }
];

export const MASCOT_KEY = 'pc-agent.mascot';

export function mascotById(id) {
  return MASCOTS.find((m) => m.id === id) || MASCOTS[0];
}

export function loadMascotId() {
  try {
    return localStorage.getItem(MASCOT_KEY) || MASCOTS[0].id;
  } catch {
    return MASCOTS[0].id;
  }
}

export function saveMascotId(id) {
  try {
    localStorage.setItem(MASCOT_KEY, id);
  } catch { /* privet mode — চলবে না */ }
}

/// পিকারের ছোট চিপ — শুধু শান্ত মুখ
export function mascotSvg(id, cls = '') {
  const m = mascotById(id);
  return `<svg viewBox="0 0 240 240" class="${cls}" aria-hidden="true">${m.body}${m.face}</svg>`;
}

/// ভয়েস স্ক্রিনের বড় মুখ — বডি + দুটো মুখের লেয়ার (খুশি লেয়ার লুকানো থাকে, .is-happy থাকলে দেখায়)
/// .bot-vibe = JS-এর --vibe অনুযায়ী হালকা বড়-ছোট (কথা বললে আনন্দে ফুলে ওঠে),
/// .bot-shell = শ্বাস নেওয়ার মতো শান্ত ওঠানামা। দুটো আলাদা গ্রুপ, না হলে ট্রান্সফর্মগুলো একটাকে আরেকটা বাতিল করে।
export function mascotLayers(id) {
  const m = mascotById(id);
  return `<g class="bot-vibe"><g class="bot-shell">${m.body}<g class="face face-calm">${m.face}</g>` +
    (m.happy ? `<g class="face face-happy">${m.happy}</g>` : '') +
    '</g></g>';
}
