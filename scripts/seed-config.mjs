import fs from 'node:fs';
import { loadConfig, CONFIG_FILE, ROOT } from '../src/config.js';

const existed = fs.existsSync(CONFIG_FILE);
const cfg = loadConfig();
const apiKeys = [cfg.settings.geminiApiKey, cfg.settings.openaiApiKey, cfg.settings.deepseekApiKey].filter(Boolean).length;
console.log(
  `${existed ? 'config found' : 'config created'} -> ${CONFIG_FILE}\n` +
    `  bots: ${cfg.bots.length}, groups: ${cfg.groups.length}, accounts: ${cfg.accounts.length}\n` +
    `  route: ${cfg.settings.routeMode}, api keys: ${apiKeys} (0 is fine - web login is enough)\n` +
    `  root: ${ROOT}`
);
