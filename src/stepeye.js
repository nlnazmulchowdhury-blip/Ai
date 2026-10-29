// ধাপে ধাপে চোখ: প্রতিটি পরিবর্তনের ঠিক পরে স্ক্রিনের ছবি তুলে AI-কে দেখায় (API-র vision লেন
// আগে, জেমিনি ওয়েব ট্যাব শেষে), তার উত্তর নিয়ে ছবিটি সঙ্গে সঙ্গে মুছে দেয় —
// কাজ শেষ হওয়ার পর আলাদা যাচাই-দৌড় লাগে না।
// (পুরনো ছবি captureScreenFile-ই নিজে থেকে মুছে দেয়, এখানে শুধু চোখের ছবিটি সরানো হয়।)
import fs from 'node:fs';
import { captureScreenFile, takePendingShot } from './pctools.js';
import { extractJson } from './jsonparse.js';

// চোখ যেন কাজে দেরি না লাগায়: ছবি আপলোড ২০ সেকেন্ডের বেশি ধরা না খেলেই ছেড়ে দেয়
const EYE_TIMEOUT_SEC = 90;
const EYE_UPLOAD_MS = 20_000;

// এই টুলগুলোর পর স্ক্রিনে দৃশ্য পরিবর্তন আসে — ছবি দেখেই বোঝা যায় হয়েছে কি না
const EYE_TOOLS = new Set([
  'open_url',
  'open_path',
  'window_focus',
  'mouse_control',
  'type_text',
  'press_keys',
  'resolve',
  'youtube_play',
  'youtube_pause',
  'browser_screenshot'
]);
const LAUNCH_RE = /\b(start|explorer|notepad|msedge|chrome|firefox|taskkill|control|settings|\.exe)\b/i;

export function needsEye(calls) {
  return (calls || []).some((c) => {
    const tool = String(c.tool || '');
    if (EYE_TOOLS.has(tool)) return true;
    if (tool === 'run_command') return LAUNCH_RE.test(String(c.command || ''));
    return false;
  });
}

function eyePrompt(intent, results) {
  return `তুমি এই পিসির স্ক্রিনের যাচাই-চোখ। নিচের কাজটি করার ঠিক পরেই ছবিটি তোলা হয়েছে — ছবি দেখে বলো কাজটি সত্যিই হয়েছে কি না।

কাজের উদ্দেশ্য: ${String(intent || '').slice(0, 700)}

চলানো টুল ও ফলাফল:
${JSON.stringify((results || []).map((r) => ({ tool: r.tool, ok: r.ok, out: String(r.output || '').slice(0, 220) }))).slice(0, 1400)}

শুধু একটি JSON অবজেক্ট দাও, কোনো ব্যাখ্যা বা markdown নয়:
{"seen":"স্ক্রিনে আসলে কী দেখা যাচ্ছে (এক লাইন)","done":"yes|no|na","problem":"no হলে কী বাকি আছে, না হলে খালি"}

- done "yes" = উদ্দিষ্ট পরিবর্তন স্ক্রিনে স্পষ্ট দেখা যাচ্ছে
- done "no" = পরিবর্তন দেখা যাচ্ছে না (ভুল উইন্ডো, খালি পেজ, লোডিং, কোনো পরিবর্তন নেই)
- done "na" = এই কাজের ফল স্ক্রিনে দেখার বিষয় না (যেমন ফাইলে লেখা, ডেটা আনা)
স্ক্রিনে যা নেই তা বানিও না।`;
}

// ছবি তুলে দেখিয়ে ফলাফল দেয়; ছবি সবসময় মুছে যায়
export async function eyeVerify({ intent, results, account }) {
  let file = '';
  try {
    // resolve/actshot কল ইতিমধ্যে লক্ষ্য উইন্ডো সামনে থাকতেই ছবি তুলেছে —
    // এখন আবার স্ক্রিন তুললে Qoder সামনে এসে ভুল ছবি যেতে পারে, তাই সেই ছবিটাই দেখি
    const shot = takePendingShot();
    file = shot || (await captureScreenFile()).file;
    const { lookAtImage } = await import('./lanes.js');
    const prompt = eyePrompt(intent, results);
    // আগে API-র vision লেন (ব্রাউজার খোলে না), না পেলে তবেই জেমিনি ওয়েব
    const raw = await lookAtImage(prompt, file, {
      account,
      timeoutSec: EYE_TIMEOUT_SEC,
      apiTimeoutSec: EYE_TIMEOUT_SEC,
      uploadWaitMs: EYE_UPLOAD_MS
    });
    const text = String(raw.text || '').trim();
    const parsed = extractJson(text) || {};
    const done = String(parsed.done || '').toLowerCase().trim();
    const verdict = done === 'yes' || done === 'no' || done === 'na' ? done : 'na';
    return {
      checked: true,
      verdict,
      seen: String(parsed.seen || text).slice(0, 400),
      problem: String(parsed.problem || '').slice(0, 300)
    };
  } catch (err) {
    return { checked: false, verdict: 'na', error: String(err.message || err).slice(0, 200) };
  } finally {
    if (file) {
      try {
        fs.unlinkSync(file);
      } catch {
        /* মুছতে না পারলে পরের প্রুনে চলবে */
      }
    }
  }
}
