import QRCode from 'qrcode';
import { CARD_BACK_URL } from './cards.js';
import {
  createRoom,
  getRoom,
  joinRoom,
  dealRoom,
  setUnveiled,
  closeRoom,
  deleteRoom,
  findPlayerByToken,
  toPublicRoom,
} from './rooms.js';

/**
 * JSON HTTP handlers. Returns `true` if the request was handled here, `false`
 * if it matches no API route (so index.js can serve static files).
 *
 * Injected by index.js:
 *  - broadcast(room): pushes the public state over WS to the room.
 *  - closeRoomSockets(code): tells every socket in the room the room closed.
 *  - lanBaseUrl(): the base URL to share (used to build the QR).
 */
export async function handleApi(req, res, { broadcast, closeRoomSockets, lanBaseUrl, version }) {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;
  if (!path.startsWith('/api/')) return false;

  try {
    // GET /api/version  — app version for the footer (public)
    if (path === '/api/version' && req.method === 'GET') {
      return send(res, 200, { version: version || null });
    }

    // POST /api/rooms  — create room (body may include rarity: U|R|M)
    if (path === '/api/rooms' && req.method === 'POST') {
      const body = await readJson(req);
      const { room, player } = createRoom(body.name, body.rarity);
      broadcast(room);
      return send(res, 201, { roomCode: room.code, token: player.token, playerId: player.id });
    }

    // POST /api/rooms/:code/join  — join
    let m = path.match(/^\/api\/rooms\/([^/]+)\/join$/);
    if (m && req.method === 'POST') {
      const body = await readJson(req);
      const result = joinRoom(m[1], body.name);
      if (!result.ok) return send(res, result.status, { error: result.error });
      broadcast(result.room);
      return send(res, 201, { roomCode: result.room.code, token: result.player.token, playerId: result.player.id });
    }

    // POST /api/rooms/:code/deal  — deal (authenticated, dealer only)
    m = path.match(/^\/api\/rooms\/([^/]+)\/deal$/);
    if (m && req.method === 'POST') {
      const room = getRoom(m[1]);
      const player = authPlayer(req, room);
      if (!player) return send(res, 401, { error: 'Not authenticated in this room.' });
      // `redeal` in the body allows a re-shuffle of a game already in progress.
      const body = await readJson(req);
      const result = dealRoom(room, player.id, { allowRedeal: !!body.redeal });
      if (!result.ok) return send(res, result.status, { error: result.error });
      broadcast(result.room);
      return send(res, 200, toPublicRoom(result.room, player));
    }

    // POST /api/rooms/:code/unveil  — set my public unveil state (authenticated)
    m = path.match(/^\/api\/rooms\/([^/]+)\/unveil$/);
    if (m && req.method === 'POST') {
      const room = getRoom(m[1]);
      const player = authPlayer(req, room);
      if (!player) return send(res, 401, { error: 'Not authenticated in this room.' });
      const body = await readJson(req);
      const result = setUnveiled(room, player, !!body.unveiled);
      if (!result.ok) return send(res, result.status, { error: result.error });
      broadcast(result.room); // everyone sees the updated reveal state
      return send(res, 200, { unveiled: player.unveiled });
    }

    // POST /api/rooms/:code/close  — close the room (authenticated, dealer only)
    m = path.match(/^\/api\/rooms\/([^/]+)\/close$/);
    if (m && req.method === 'POST') {
      const room = getRoom(m[1]);
      const player = authPlayer(req, room);
      if (!player) return send(res, 401, { error: 'Not authenticated in this room.' });
      const result = closeRoom(room, player.id);
      if (!result.ok) return send(res, result.status, { error: result.error });
      closeRoomSockets(room.code); // tell everyone to return to the start
      deleteRoom(room.code);
      return send(res, 200, { ok: true });
    }

    // GET /api/rooms/:code/qr  — QR with the join URL (public)
    m = path.match(/^\/api\/rooms\/([^/]+)\/qr$/);
    if (m && req.method === 'GET') {
      const room = getRoom(m[1]);
      if (!room) return send(res, 404, { error: 'Room not found.' });
      const joinUrl = `${lanBaseUrl()}/join?code=${room.code}`;
      const dataUrl = await QRCode.toDataURL(joinUrl, { margin: 1, width: 240 });
      return send(res, 200, { joinUrl, dataUrl });
    }

    // GET /api/host-qr  — QR to the LAN home page (for the host "screen" that
    // players scan; the computer is just the server, players use their phones).
    if (path === '/api/host-qr' && req.method === 'GET') {
      const joinUrl = `${lanBaseUrl()}/home`;
      const dataUrl = await QRCode.toDataURL(joinUrl, { margin: 1, width: 360 });
      return send(res, 200, { joinUrl, dataUrl });
    }

    // GET /api/rooms/:code  — public state (no roles)
    m = path.match(/^\/api\/rooms\/([^/]+)$/);
    if (m && req.method === 'GET') {
      const room = getRoom(m[1]);
      if (!room) return send(res, 404, { error: 'Room not found.' });
      const viewer = authPlayer(req, room); // optional: if a token is sent, compute youCanDeal
      return send(res, 200, toPublicRoom(room, viewer));
    }

    // GET /api/me/role  — private role (authenticated)  ?code=CODE
    // The client caches this; unveil is tracked client-side (private per player).
    if (path === '/api/me/role' && req.method === 'GET') {
      const room = getRoom(url.searchParams.get('code'));
      const player = authPlayer(req, room);
      if (!player) return send(res, 401, { error: 'Not authenticated in this room.' });
      return send(res, 200, { role: player.role, card: player.card, cardBack: CARD_BACK_URL });
    }

    return send(res, 404, { error: 'Unknown API route.' });
  } catch (err) {
    if (err?.code === 'BAD_JSON') return send(res, 400, { error: 'Invalid JSON.' });
    console.error('[api] unexpected error:', err);
    return send(res, 500, { error: 'Internal error.' });
  }
}

/** Extracts the bearer token from the Authorization header and returns the room player. */
function authPlayer(req, room) {
  if (!room) return null;
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  return findPlayerByToken(room, token);
}

function send(res, status, obj) {
  const payload = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(payload);
  return true;
}

/** Reads and parses the JSON body (max 8KB). */
function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let tooBig = false;
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 8192) {
        tooBig = true;
        req.destroy();
      }
    });
    req.on('end', () => {
      if (tooBig) return reject(Object.assign(new Error('body too large'), { code: 'BAD_JSON' }));
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(Object.assign(new Error('bad json'), { code: 'BAD_JSON' }));
      }
    });
    req.on('error', reject);
  });
}
