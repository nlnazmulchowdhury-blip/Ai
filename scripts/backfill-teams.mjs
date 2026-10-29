// একবারের স্ক্রিপ্ট: পুরনো team-* গ্রুপে purpose/keywords/uses বসায়,
// যাতে সেগুলো নতুন কাজে মিলে আবার ব্যবহার হতে পারে (নতুন দল বানানো না লাগে)।
// সার্ভার বন্ধ অবস্থায় চালাতে হবে (config.json লেখে)। DRY=1 হলে কিছু লেখে না।
import fs from 'node:fs';
import { loadConfig, saveConfig } from '../src/config.js';
import { normWords } from '../src/teams.js';

const read = (rel) => JSON.parse(fs.readFileSync(new URL(rel, import.meta.url), 'utf8'));

export function backfill(cfg, tasks, notesAll, force = false) {
  const report = [];
  for (const group of cfg.groups) {
    if (!String(group.id).startsWith('team-')) continue;
    if (!force && Array.isArray(group.keywords) && group.keywords.length) continue;
    const task = tasks.find((t) => t.id === group.taskId);
    const mine = notesAll.filter((n) => group.name && n.team === group.name);
    const words = [];
    if (task?.prompt) words.push(...normWords(task.prompt));
    for (const n of mine) {
      const kw = Array.isArray(n.keywords) && n.keywords.length ? n.keywords : [n.prompt || ''];
      words.push(...normWords(kw.join(' ')));
    }
    words.push(...normWords(group.name));
    const keywords = [...new Set(words.filter(Boolean))].slice(0, 26);
    if (!keywords.length) {
      report.push(`${group.id} (${group.name}) — কিছুই মিলল না`);
      continue;
    }
    group.keywords = keywords;
    group.purpose = String(task?.prompt || mine[0]?.prompt || group.name).slice(0, 220);
    group.uses = mine.length || 1;
    group.lastUsed = Math.max(group.lastUsed || 0, ...mine.map((n) => n.lastUsed || n.createdAt || 0)) || Date.now();
    group.createdAt = group.createdAt || group.lastUsed;
    const lead = cfg.bots.find((b) => b.group === group.id && b.role !== 'boss');
    if (lead && !group.leadId) group.leadId = lead.id;
    report.push(`${group.id} (${group.name}) uses=${group.uses} kw=${keywords.join(',')}`);
  }
  return report;
}

const direct = process.argv[1] && process.argv[1].replace(/\\/g, '/').includes('backfill-teams');
if (direct && !process.env.DRY) {
  const cfg = loadConfig();
  const rawTasks = read('../data/tasks.json');
  const rawNotes = read('../data/memory.json');
  const report = backfill(
    cfg,
    Array.isArray(rawTasks) ? rawTasks : rawTasks.tasks || [],
    Array.isArray(rawNotes) ? rawNotes : rawNotes.notes || [],
    Boolean(process.env.FORCE)
  );
  saveConfig(cfg);
  console.log(report.join('\n') || 'কোনো গ্রুপ বদলায়নি');
}
