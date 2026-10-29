import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { DATA_DIR } from './config.js';
import { lanAddresses } from './access.js';

const TLS_DIR = path.join(DATA_DIR, 'tls');
const BUNDLE = path.join(TLS_DIR, 'agent-cert.json');

function readBundle() {
  try {
    const parsed = JSON.parse(fs.readFileSync(BUNDLE, 'utf8'));
    if (!parsed.key || !parsed.cert) return null;
    const info = new crypto.X509Certificate(parsed.cert);
    const daysLeft = (Date.parse(info.validTo) - Date.now()) / 86_400_000;
    return daysLeft > 60 ? parsed : null;
  } catch {
    return null;
  }
}

function opensslBin() {
  for (const guess of ['openssl', 'C:/Program Files/Git/mingw64/bin/openssl.exe', 'C:/Program Files/git/mingw64/bin/openssl.exe']) {
    try {
      execFileSync(guess, ['version'], { stdio: 'ignore' });
      return guess;
    } catch {
      /* try next */
    }
  }
  return null;
}

// Chrome needs a secure context for the mic and screen capture, so the phone
// lane is HTTPS with a LAN-only certificate — nothing here leaves the router.
export function ensureCert() {
  const existing = readBundle();
  if (existing) return existing;
  const bin = opensslBin();
  if (!bin) throw new Error('openssl পাওয়া যায়নি — ফোনের HTTPS লেন খোলা যাবে না');
  fs.mkdirSync(TLS_DIR, { recursive: true });
  const hosts = [...new Set(['127.0.0.1', 'localhost', ...lanAddresses()])];
  const san = hosts.map((h) => (/^\d+\.\d+\.\d+\.\d+$/.test(h) ? `IP:${h}` : `DNS:${h}`)).join(',');
  const keyFile = path.join(TLS_DIR, 'agent-key.tmp.pem');
  execFileSync(
    bin,
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      keyFile,
      '-out',
      path.join(TLS_DIR, 'agent-cert.tmp.pem'),
      '-days',
      '820',
      '-subj',
      '/CN=pc-agent.lan',
      '-addext',
      `subjectAltName=${san}`
    ],
    { stdio: 'ignore' }
  );
  const bundle = { key: fs.readFileSync(keyFile, 'utf8'), cert: fs.readFileSync(path.join(TLS_DIR, 'agent-cert.tmp.pem'), 'utf8'), hosts, at: Date.now() };
  fs.writeFileSync(BUNDLE, JSON.stringify(bundle), 'utf8');
  for (const f of [keyFile, path.join(TLS_DIR, 'agent-cert.tmp.pem'), path.join(TLS_DIR, 'agent-key.tmp.pem.crt')]) {
    try {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    } catch {
      /* ignore */
    }
  }
  return bundle;
}

export { TLS_DIR };
