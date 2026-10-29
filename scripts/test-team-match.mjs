// দল-মিল টেস্ট: সেভ করা দলের সঙ্গে নতুন কাজের শব্দ মিলছে কি না (কোনো লেখালেখি হয় না)
import { loadConfig } from '../src/config.js';
import { matchSavedTeam, normWords, teamSig } from '../src/teams.js';

const cfg = loadConfig();
const cases = [
  ['নোপ্যাড খুলে দেখাও যে নোটপ্যাড উইন্ডো খোলা হয়েছে', 'reuse'],
  ['নোটপ্যাড খোল', 'reuse'],
  ['নোপ্যাড খোলো', 'reuse'],
  ['নটপ্যাড জ্বালাও', 'reuse'],
  ['নোটপ্যাডে ' + '"হ্যালো" লেখো', 'new'],
  ['নোটপ্যাড মুছে দাও', 'new'],
  ['ফেসবুক খোল', 'reuse'],
  ['ফেসবুকে যাও', 'reuse'],
  ['ফেসবুক খুলে আমার নোটিফিকেশন দেখ', 'reuse'],
  ['ইউটিউব খুলে গান চালাও', 'reuse'],
  ['youtube ওপেন করো', 'reuse'],
  ['youtube খোল', 'reuse'],
  ['facebook খোল', 'reuse'],
  ['yt খুলে দাও', 'reuse'],
  ['ভলিউম বাড়াও', 'reuse'],
  ['সাউন্ড বাড়াও', 'reuse'],
  ['আওয়াজ কমাও', 'reuse'],
  // ফোল্ডার-দল এখন সেভ করা নেই (LRU-তে prune হয়েছে) → নতুন দল হওয়াই ঠিক
  ['ফোল্ডার বানাও', 'new'],
  ['ডেস্কটপে নতুন ফোল্ডার তৈরি কর', 'new'],
  ['আজকের খবর বলো', 'new'],
  ['আমার বন্ধুকে মেসেজ পাঠাও', 'new']
];
let bad = 0;
for (const [p, want] of cases) {
  const found = matchSavedTeam(cfg, p);
  const got = found ? 'reuse' : 'new';
  const mark = got === want ? 'ok ' : 'BAD';
  if (got !== want) bad += 1;
  console.log(
    `${mark} [${want}] ${p}\n     words=${JSON.stringify(normWords(p))} sig=${teamSig(p)} -> ${
      found ? `${found.group.id} (${found.group.name}) shared=${found.shared} content=${found.content}` : 'নতুন দল'
    }`
  );
}
console.log(`\nভুল: ${bad}/${cases.length}`);
