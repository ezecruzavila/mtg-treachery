import { WebSocketServer } from 'ws';
import {
  getRoom,
  findPlayerByToken,
  markConnected,
  markDisconnected,
  toPublicRoom,
} from './rooms.js';

const HEARTBEAT_MS = 15_000;

/**
 * Mounts the WebSocket server on an existing HTTP server.
 * The socket is ONLY for presence + broadcasting the room's public state.
 * It NEVER transmits roles (that is HTTP authenticated by token).
 *
 * @param {import('http').Server} httpServer
 * @returns {{ broadcast: (room:any)=>void, closeRoomSockets: (code:string)=>void }}
 */
export function attachWebSocket(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  // Index: code -> Set<ws> for per-room broadcasting.
  /** @type {Map<string, Set<import('ws').WebSocket>>} */
  const byRoom = new Map();

  function addConn(code, ws) {
    if (!byRoom.has(code)) byRoom.set(code, new Set());
    byRoom.get(code).add(ws);
  }
  function removeConn(code, ws) {
    const set = byRoom.get(code);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) byRoom.delete(code);
  }

  /** Broadcasts the public state to every connection in the room (per-viewer). */
  function broadcast(room) {
    if (!room) return;
    const set = byRoom.get(room.code);
    if (!set) return;
    for (const ws of set) {
      if (ws.readyState !== ws.OPEN) continue;
      const viewer = ws._playerId ? room.players.find((p) => p.id === ws._playerId) : null;
      ws.send(JSON.stringify({ type: 'state', room: toPublicRoom(room, viewer) }));
    }
  }

  /** Tells every socket in a room the room closed, then drops the connections. */
  function closeRoomSockets(code) {
    const set = byRoom.get(code);
    if (!set) return;
    for (const ws of set) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'closed' }));
      try { ws.close(); } catch { /* ignore */ }
    }
    byRoom.delete(code);
  }

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const code = (url.searchParams.get('code') || '').toUpperCase();
    const token = url.searchParams.get('token');
    const room = getRoom(code);
    const player = findPlayerByToken(room, token);

    if (!room || !player) {
      // Invalid token/room (e.g. server restarted): notify and close.
      ws.send(JSON.stringify({ type: 'unauthorized' }));
      ws.close();
      return;
    }

    ws._code = code;
    ws._playerId = player.id;
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    addConn(code, ws);
    markConnected(room, player, broadcast);

    ws.on('message', (data) => {
      // The client doesn't need to send anything in the MVP; tolerate an app-level ping.
      try {
        const msg = JSON.parse(data);
        if (msg?.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
      } catch {
        /* ignore non-JSON messages */
      }
    });

    ws.on('close', () => {
      removeConn(code, ws);
      const r = getRoom(code);
      if (!r) return;
      const p = r.players.find((x) => x.id === ws._playerId);
      // Only mark disconnected if NO other connection of the same player remains
      // (two tabs of the same seat shouldn't kill presence when one closes).
      const stillConnectedElsewhere = [...(byRoom.get(code) || [])].some(
        (other) => other._playerId === ws._playerId && other.readyState === other.OPEN,
      );
      if (p && !stillConnectedElsewhere) markDisconnected(r, p, broadcast);
    });
  });

  // Heartbeat: drop dead connections (phones that leave without a clean close).
  const interval = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_MS);
  interval.unref?.();

  wss.on('close', () => clearInterval(interval));

  return { broadcast, closeRoomSockets };
}
