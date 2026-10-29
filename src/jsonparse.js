import { jsonrepair } from 'jsonrepair';

function repairWindowsPaths(slice) {
  if (!/[A-Za-z]:\\/.test(slice)) return null;
  let out = '';
  let i = 0;
  while (i < slice.length) {
    if (slice[i] !== '"') {
      out += slice[i];
      i += 1;
      continue;
    }
    let j = i + 1;
    while (j < slice.length && slice[j] !== '"') {
      j += slice[j] === '\\' ? 2 : 1;
    }
    if (j >= slice.length) {
      out += slice.slice(i);
      break;
    }
    const body = slice.slice(i + 1, j);
    if (!/[A-Za-z]:\\|\\\\[A-Za-z]/.test(body)) {
      out += slice.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    out += '"';
    for (let k = 0; k < body.length; k += 1) {
      const ch = body[k];
      if (ch !== '\\') {
        out += ch;
        continue;
      }
      const nxt = body[k + 1];
      if (nxt === '"' || nxt === '\\' || nxt === '/') {
        out += ch + nxt;
        k += 1;
      } else if (nxt === 'u' && /^[0-9a-fA-F]{4}$/.test(body.slice(k + 2, k + 6))) {
        out += body.slice(k, k + 6);
        k += 5;
      } else {
        out += '\\\\';
      }
    }
    out += '"';
    i = j + 1;
  }
  return out;
}

function escapeDrivePaths(text) {
  return text.replace(/([A-Za-z]:)\\([^"\r\n]*)/g, (match, drive, rest) => {
    if (rest.startsWith('\\')) return match;
    return `${drive}\\\\${rest.replace(/\\/g, '\\\\')}`;
  });
}

function decodeEntities(text) {
  if (!/&(?:#x?[0-9a-f]+|quot|apos|lt|gt|nbsp|amp);/i.test(text)) return text;
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number.parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function parseLoose(slice) {
  const repaired = repairWindowsPaths(slice);
  const withPaths = escapeDrivePaths(slice);
  const candidates = [slice];
  if (withPaths !== slice) candidates.push(withPaths);
  if (repaired && !candidates.includes(repaired)) candidates.push(repaired);
  for (const raw of candidates) {
    try {
      return JSON.parse(raw);
    } catch {
      /* markdown-escaped JSON below */
    }
  }
  // Repair passes try the path-fixed variants first so jsonrepair can't eat backslashes.
  for (const raw of [...candidates].reverse()) {
    for (const variant of [raw, decodeEntities(raw)]) {
      // Chat models often escape markdown chars (\[\], \_, \*) which is invalid JSON.
      // Windows paths are doubled first, otherwise this strip would silently corrupt them.
      const cleaned = escapeDrivePaths(variant).replace(/\\(?![\\"/bfnrtu])/g, '');
      try {
        return JSON.parse(cleaned);
      } catch {
        /* fall through to the repair pass */
      }
      try {
        return JSON.parse(jsonrepair(cleaned));
      } catch {
        /* try next variant */
      }
    }
  }
  return null;
}

export function salvageEnvelope(text) {
  const raw = String(text || '');
  const next = raw.match(/"next"\s*:\s*"([^"]*)"/);
  const final = /"final"\s*:\s*true/i.test(raw);
  if (!next && !final) return null;
  const say = raw.match(/"say"\s*:\s*"([\s\S]*?)"\s*,\s*(?:"next"|"task"|"pc"|"final")/);
  return {
    say: say?.[1] || '',
    next: next && !/^(null|none|)$/i.test(next[1]) ? next[1] : null,
    final,
    salvaged: true
  };
}

export function extractJson(text) {
  const raw = String(text || '');
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1], raw].filter(Boolean);
  for (const c of candidates) {
    const start = c.indexOf('{');
    if (start < 0) continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < c.length; i += 1) {
      const ch = c[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
      } else if (ch === '"') inStr = true;
      else if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          const parsed = parseLoose(c.slice(start, i + 1));
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
          break;
        }
      }
    }
  }
  return null;
}
