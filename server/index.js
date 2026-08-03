import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { handleApi } from './api.js';
import { attachWebSocket } from './ws.js';
import { sweepRooms } from './rooms.js';
import { keepAwake, releaseAwake } from './keep-awake.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const ASSETS_DIR = path.join(ROOT_DIR, 'assets');
const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0'; // listen on all interfaces so phones on the LAN can reach us

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

/**
 * Discovers the LAN IP to share. Prefers common private ranges
 * (192.168/10/172.16) and SKIPS loopback, VPN (utun/tun/tap) and CGNAT (100.64/10).
 */
function discoverLanIp() {
  const ifaces = os.networkInterfaces();
  const candidates = [];
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (/^(utun|tun|tap|awdl|llw|bridge)/i.test(name)) continue; // VPN / virtual
      if (a.address.startsWith('169.254.')) continue; // link-local
      if (isCgnat(a.address)) continue; // 100.64.0.0/10 (CGNAT, typical of VPNs like Tailscale)
      candidates.push({ name, address: a.address });
    }
  }
  // Prefer the classic home-LAN private ranges.
  const preferred = candidates.find((c) => isPrivateLan(c.address));
  return (preferred || candidates[0])?.address || null;
}

function isPrivateLan(ip) {
  return (
    ip.startsWith('192.168.') ||
    ip.startsWith('10.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
  );
}
function isCgnat(ip) {
  const m = ip.match(/^100\.(\d+)\./);
  return m && Number(m[1]) >= 64 && Number(m[1]) <= 127;
}

const lanIp = discoverLanIp();
// Public base URL to share (used for the join QR/links). When deployed (e.g.
// Render sets RENDER_EXTERNAL_URL, or set PUBLIC_URL yourself) we use that so
// the QR points at the real internet address; otherwise fall back to the LAN IP.
const PUBLIC_URL = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
function lanBaseUrl() {
  return PUBLIC_URL || `http://${lanIp || 'localhost'}:${PORT}`;
}

// Serves a static file from PUBLIC_DIR safely (no path traversal).
async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let rel = decodeURIComponent(url.pathname);

  // Card images and other assets are served from the project's assets/ dir.
  const isAsset = rel.startsWith('/assets/');
  let baseDir = PUBLIC_DIR;
  if (isAsset) {
    baseDir = ASSETS_DIR;
    rel = rel.slice('/assets'.length); // strip the /assets prefix
  } else {
    // "Pretty" routes -> files.
    if (rel === '/') { res.writeHead(302, { Location: '/home' }); res.end(); return; }
    else if (rel === '/home') rel = '/index.html';
    else if (rel === '/host') rel = '/host.html'; // host "screen": QR players scan
    else if (rel === '/join') rel = '/join.html';
    else if (rel.startsWith('/room/')) rel = '/room.html'; // SPA-ish: the room loads room.html
  }

  const filePath = path.normalize(path.join(baseDir, rel));
  if (!filePath.startsWith(baseDir)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  if (!existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    return;
  }
  try {
    const body = await readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      // Card images never change; cache them. HTML/CSS/JS stay fresh.
      'Cache-Control': isAsset ? 'public, max-age=86400' : 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(500).end('Error reading file');
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const handled = await handleApi(req, res, { broadcast, closeRoomSockets, lanBaseUrl });
    if (handled) return;
    await serveStatic(req, res);
  } catch (err) {
    console.error('[http] error:', err);
    if (!res.headersSent) res.writeHead(500).end('Internal error');
  }
});

const { broadcast, closeRoomSockets } = attachWebSocket(server);

// Periodic sweep of abandoned rooms.
const sweep = setInterval(() => sweepRooms(), 5 * 60 * 1000);
sweep.unref?.();

// Opens the default browser at `url`, cross-platform. No-op on failure.
function openBrowser(url) {
  let cmd;
  let args;
  if (process.platform === 'darwin') { cmd = 'open'; args = [url]; }
  else if (process.platform === 'win32') { cmd = 'cmd'; args = ['/c', 'start', '""', url]; }
  else { cmd = 'xdg-open'; args = [url]; }
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  } catch {
    /* headless / no browser — ignore */
  }
}

const IS_PACKAGED = typeof process.pkg !== 'undefined';

server.listen(PORT, HOST, async () => {
  const line = '─'.repeat(52);
  console.log(`\n${line}`);
  console.log('  🎴  MTG Treachery — role dealer (LAN)');
  console.log(line);
  console.log(`  On this machine:   http://localhost:${PORT}`);
  if (lanIp) {
    console.log(`  Share on the LAN:  ${lanBaseUrl()}   ← share this one`);
  } else {
    console.log('  ⚠️  No LAN IP detected. Are you connected to a network?');
  }
  console.log(line);

  // Print a scannable QR of the LAN join URL right in the console.
  if (lanIp) {
    try {
      const qr = await QRCode.toString(`${lanBaseUrl()}/home`, { type: 'terminal', small: true });
      console.log(qr);
    } catch { /* ignore QR failures */ }
  }

  if (IS_PACKAGED) {
    // Prevent the host from idle-sleeping mid-game (released on exit below).
    keepAwake();
    console.log('  Keep this window open. Close it to stop the server.\n');
    // The computer is just the host: open the QR screen players scan from phones.
    openBrowser(`http://localhost:${PORT}/host`);
  } else {
    console.log('  Ctrl+C to stop.\n');
  }
});

// Let the machine sleep normally again once the server stops.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { releaseAwake(); process.exit(0); });
}
process.on('exit', releaseAwake);
