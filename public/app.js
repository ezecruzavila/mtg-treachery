// Shared client utilities: session (localStorage), fetch and navigation.

const SESSION_PREFIX = 'treachery:'; // + CODE  -> { token, playerId, name }
const NAME_KEY = 'treachery:name';

/** Saves the session for a room. */
export function saveSession(code, data) {
  localStorage.setItem(SESSION_PREFIX + code.toUpperCase(), JSON.stringify(data));
}

/** Returns the saved session for a room, or null. */
export function getSession(code) {
  try {
    const raw = localStorage.getItem(SESSION_PREFIX + code.toUpperCase());
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function hasSession(code) {
  const s = getSession(code);
  return !!(s && s.token);
}

/** Clears the session for a room (e.g. invalid token after a server restart). */
export function clearSession(code) {
  const c = code.toUpperCase();
  localStorage.removeItem(SESSION_PREFIX + c);
  localStorage.removeItem(ROLE_PREFIX + c);
  localStorage.removeItem(UNVEIL_PREFIX + c);
}

// ---- Per-room gameplay cache -------------------------------------------------
// Once dealt, the role/card never change until a re-deal. Caching them (plus
// the private unveil flag) lets a player see their card, flip it, and read the
// rules with NO server round-trip — so the host can safely sleep mid-game.

const ROLE_PREFIX = 'treachery:role:';     // + CODE -> { role, card, cardBack, dealtAt }
const UNVEIL_PREFIX = 'treachery:unveil:'; // + CODE -> "1" | absent (private, per player)

/** Caches the dealt role/card for a room. Include dealtAt to detect re-deals. */
export function saveRole(code, data) {
  localStorage.setItem(ROLE_PREFIX + code.toUpperCase(), JSON.stringify(data));
}
/** Returns the cached role/card for a room, or null. */
export function getRole(code) {
  try {
    const raw = localStorage.getItem(ROLE_PREFIX + code.toUpperCase());
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** The unveil flag is private to this player; we keep it purely client-side. */
export function getUnveil(code) {
  return localStorage.getItem(UNVEIL_PREFIX + code.toUpperCase()) === '1';
}
export function setUnveil(code, value) {
  const key = UNVEIL_PREFIX + code.toUpperCase();
  if (value) localStorage.setItem(key, '1');
  else localStorage.removeItem(key);
}

/** Name remembered across screens (convenience). */
export function getName() {
  return localStorage.getItem(NAME_KEY) || '';
}
export function setName(name) {
  localStorage.setItem(NAME_KEY, name);
}

/** Shows an error in the #error container if present. */
export function showError(msg) {
  const el = document.getElementById('error');
  if (!el) return alert(msg);
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(showError._t);
  showError._t = setTimeout(() => el.classList.add('hidden'), 5000);
}

async function postJson(url, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body || {}) });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

/** Creates a room and navigates to the lobby. */
export async function createRoom(name, rarity = 'U') {
  try {
    const { res, data } = await postJson('/api/rooms', { name, rarity });
    if (!res.ok) return showError(data.error || 'Could not create the room.');
    saveSession(data.roomCode, { token: data.token, playerId: data.playerId, name });
    // replace (not href) so 'back' from the room skips these entry screens -> Home.
    location.replace(`/room/${data.roomCode}`);
  } catch {
    showError('Connection error with the server.');
  }
}

/**
 * Joins a room. If a session is already saved, goes straight in (reconnection).
 */
export async function joinExisting(code, name) {
  code = code.toUpperCase();
  if (hasSession(code)) {
    location.replace(`/room/${code}`);
    return;
  }
  try {
    const { res, data } = await postJson(`/api/rooms/${code}/join`, { name });
    if (!res.ok) return showError(data.error || 'Could not join the room.');
    saveSession(code, { token: data.token, playerId: data.playerId, name });
    // replace (not href) so 'back' from the room skips these entry screens -> Home.
    location.replace(`/room/${code}`);
  } catch {
    showError('Connection error with the server.');
  }
}
