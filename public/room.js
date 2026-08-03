// Room screen logic: presence WebSocket, lobby, role card and unveil.
import { getSession, clearSession, showError, saveRole, getRole, getUnveil, setUnveil } from '/app.js';

const CODE = (location.pathname.match(/\/room\/([^/]+)/)?.[1] || '').toUpperCase();
const session = getSession(CODE);

if (!CODE || !session || !session.token) {
  // No session for this room: send to the join screen.
  location.replace(`/join?code=${CODE}`);
}

// Back button from inside a room should go straight to Home (not step back
// through the code/name entry screens). Push a sentinel entry and, when the
// user navigates back onto it, send them Home.
history.pushState({ room: CODE }, '');
window.addEventListener('popstate', () => { location.replace('/home'); });

const AUTO_HIDE_MS = 10_000;

// ---- Client state ----
let ws = null;
let lastRoom = null;   // last public state received
let myRole = null;     // my role (arrives over authenticated HTTP)
let myCard = null;     // URL of my assigned identity card image
let cardBackUrl = null; // URL of the shared card back
let unveiled = false;  // reveal state (reversible)
let faceUp = false;    // currently visible face (toggle)
let hideTimer = null;
const preloaded = {};  // url -> Image, kept in memory so the browser never re-fetches

// ---- Elements ----
const el = (id) => document.getElementById(id);
const viewLobby = el('view-lobby');
const viewRole = el('view-role');
const connSub = el('conn-sub');

// ============================ WebSocket ============================
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws?code=${CODE}&token=${encodeURIComponent(session.token)}`);

  ws.addEventListener('open', () => {
    connSub.textContent = ''; // no text when all is well
    sendPing(); // wake the host promptly on (re)connect
  });

  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === 'unauthorized') {
      // The server doesn't recognize the token (restarted or room expired):
      // the old game no longer exists, so start fresh at /home.
      clearSession(CODE);
      location.replace('/home');
      return;
    }
    if (msg.type === 'closed') {
      // The dealer closed the room: everyone returns to the start.
      clearSession(CODE);
      location.replace('/home');
      return;
    }
    if (msg.type === 'state') {
      onState(msg.room);
    }
  });

  ws.addEventListener('close', () => {
    connSub.textContent = 'Reconnecting…';
    // Simple retry while the tab is visible.
    scheduleReconnect();
  });

  ws.addEventListener('error', () => { try { ws.close(); } catch {} });
}

let reconnectTimer = null;
function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    if (document.visibilityState === 'visible') connect();
  }, 1500);
}

// ---- Heartbeat -------------------------------------------------------------
// Keeps a hosted server (e.g. Render's free tier, which sleeps after ~15 min of
// no traffic) awake WHILE someone is actively looking at the game. We only ping
// when the tab is visible: if everyone backgrounds the app, pings stop and the
// host may sleep — which is fine, because role/card are cached client-side.
const HEARTBEAT_MS = 60_000;

function sendPing() {
  if (document.visibilityState !== 'visible') return;
  if (ws && ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify({ type: 'ping' })); } catch { /* ignore */ }
  }
}

const heartbeat = setInterval(sendPing, HEARTBEAT_MS);
window.addEventListener('pagehide', () => clearInterval(heartbeat));

// Reopen the socket when coming back to the foreground (phones suspend it in the background).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (!ws || ws.readyState === WebSocket.CLOSED) connect();
    else sendPing(); // still connected: nudge the host awake immediately
  } else {
    // On losing focus, hide the card for privacy (no-op if locked face-up).
    hideCard();
  }
});
window.addEventListener('blur', hideCard);

// Coming back from the bfcache (unlocking the phone, switching back to the app)
// can restore the last painted frame. Snap the card to its correct face WITHOUT
// animating, so a card that was face-up never briefly shows on return.
window.addEventListener('pageshow', (e) => {
  if (!e.persisted) return;
  card.classList.add('no-anim');
  if (!isCardLocked()) hideCard();
  requestAnimationFrame(() => requestAnimationFrame(() => card.classList.remove('no-anim')));
});

// ============================ State handling ============================
async function onState(room) {
  const wasDealt = lastRoom?.phase === 'dealt';
  lastRoom = room;

  if (room.phase === 'dealt') {
    // Rehydrate from the local cache FIRST, so the card shows instantly and the
    // host may sleep mid-game (no round-trip just to view your role). Only hit
    // the server when the cache is missing or stale (a re-deal changed dealtAt).
    const cached = getRole(CODE);
    const fresh = cached && cached.dealtAt === room.dealtAt;
    if (fresh) {
      applyRole(cached);
    } else {
      await fetchMyRole(room.dealtAt); // deal / re-deal: server is awake right now
    }

    renderRoleView(room);
    if (!wasDealt) {
      resetCardToBack();
      switchTo(viewRole);
    }
  } else {
    renderLobby(room);
    switchTo(viewLobby);
  }
}

// Applies a role payload (from cache or server) to local state + preloads images.
function applyRole(data) {
  myRole = data.role;
  myCard = data.card;
  cardBackUrl = data.cardBack;
  unveiled = getUnveil(CODE); // unveil is private and client-only
  preload(myCard);
  preload(cardBackUrl);
}

function switchTo(view) {
  for (const v of [viewLobby, viewRole]) v.classList.toggle('hidden', v !== view);
}

async function fetchMyRole(dealtAt) {
  try {
    const res = await fetch(`/api/me/role?code=${CODE}`, {
      headers: { Authorization: 'Bearer ' + session.token },
    });
    if (res.status === 401) {
      // Token no longer valid (server restarted): start fresh at /home.
      clearSession(CODE);
      location.replace('/home');
      return;
    }
    const data = await res.json();
    // A re-deal clears the private unveil flag; a same-deal fetch keeps it.
    const cachedBefore = getRole(CODE);
    if (!cachedBefore || cachedBefore.dealtAt !== dealtAt) setUnveil(CODE, false);
    // Cache role/card so future views (and reloads while the host sleeps) need
    // no server round-trip. dealtAt lets us detect the next re-deal.
    saveRole(CODE, { role: data.role, card: data.card, cardBack: data.cardBack, dealtAt });
    applyRole({ role: data.role, card: data.card, cardBack: data.cardBack });
  } catch {
    // Server unreachable (e.g. asleep): fall back to the cache if we have one.
    const cached = getRole(CODE);
    if (cached) applyRole(cached);
    else showError('Could not fetch your role.');
  }
}

// Fetches an image into memory (and the browser cache) once. Idempotent.
function preload(url) {
  if (!url || preloaded[url]) return;
  const img = new Image();
  img.src = url;
  preloaded[url] = img; // retained so it stays in memory for the whole game
}

// ============================ Render: LOBBY ============================
function renderLobby(room) {
  el('roomcode').textContent = room.code;
  el('count').textContent = room.playerCount;
  renderPlayerList(el('players'), room);

  // QR + URL (fetched once).
  if (!renderLobby._qrLoaded) {
    renderLobby._qrLoaded = true;
    fetch(`/api/rooms/${room.code}/qr`)
      .then((r) => r.json())
      .then((d) => {
        if (d.dataUrl) el('qr').src = d.dataUrl;
        if (d.joinUrl) el('lanurl').textContent = d.joinUrl;
      })
      .catch(() => {});
  }

  // Can I deal?
  const dealArea = el('deal-area');
  const waitArea = el('wait-area');
  const dealBtn = el('deal-btn');
  const dealHelp = el('deal-help');

  if (room.you && room.dealerId === room.you.id) {
    dealArea.classList.remove('hidden');
    waitArea.classList.add('hidden');
    const ready = room.canDeal;
    dealBtn.disabled = !ready;
    dealHelp.textContent = ready
      ? `${room.playerCount} players ready.`
      : `Treachery is for 4–8 players (there are ${room.playerCount}).`;
  } else {
    dealArea.classList.add('hidden');
    waitArea.classList.remove('hidden');
    const dealer = room.players.find((p) => p.id === room.dealerId);
    el('dealer-name').textContent = dealer ? dealer.name : 'the room creator';
  }
}

function renderPlayerList(ul, room) {
  ul.innerHTML = '';
  for (const p of room.players) {
    const li = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = 'dot' + (p.connected ? ' on' : '');
    const name = document.createElement('span');
    name.className = 'pname';
    name.textContent = p.name;
    li.append(dot, name);

    if (p.isLeader) li.append(badge('👑', 'leader crown-only'));

    ul.append(li);
  }
}

function badge(text, cls) {
  const b = document.createElement('span');
  b.className = 'badge ' + (cls || '');
  b.textContent = text;
  return b;
}

el('deal-btn').addEventListener('click', async () => {
  el('deal-btn').disabled = true;
  try {
    const res = await fetch(`/api/rooms/${CODE}/deal`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + session.token },
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      showError(d.error || 'Could not deal.');
      el('deal-btn').disabled = false;
    }
    // The switch to "dealt" arrives over the socket; nothing else to do here.
  } catch {
    showError('Connection error.');
    el('deal-btn').disabled = false;
  }
});

// ============================ Render: MY ROLE ============================
function renderRoleView(room) {
  renderPlayerList(el('players-role'), room);

  // Set the card images: front = assigned identity card, back = shared card back.
  const frontImg = el('card-front-img');
  const backImg = el('card-back-img');
  if (myCard && frontImg.getAttribute('src') !== myCard) frontImg.src = myCard;
  if (cardBackUrl && backImg.getAttribute('src') !== cardBackUrl) backImg.src = cardBackUrl;

  // The Leader is public: their card is always face-up and has no Unveil switch.
  const iAmLeader = myRole === 'LEADER';
  el('unveil-area').classList.toggle('hidden', iAmLeader);
  el('role-help').classList.toggle('hidden', iAmLeader);

  if (iAmLeader) {
    lockFaceUp(); // fixed face-up, no toggle, no auto-hide
  } else {
    // Sync the switch with our local (private) unveil state.
    el('unveil-toggle').checked = unveiled;
    // Show face-up ONLY when unveiled; otherwise force face-down so a refresh /
    // unlock never briefly shows the front (no flash).
    if (unveiled) lockFaceUp();
    else resetCardToBack();
  }

  // Dealer-only controls (restart / end game).
  const dealerControls = el('dealer-controls');
  dealerControls.classList.toggle('hidden', !(room.you && room.dealerId === room.you.id));

  // After the correct face is painted, re-enable the flip animation for future
  // taps. Two rAFs ensure the browser committed the (possibly face-down) state
  // first, so removing no-anim never triggers a half-flip.
  if (card.classList.contains('no-anim')) {
    requestAnimationFrame(() => requestAnimationFrame(() => card.classList.remove('no-anim')));
  }
}

// ---- Card flip ----
const card = el('role-card');

// The card is "locked" face-up (no toggle / no auto-hide) when the player has
// unveiled, or when they are the Leader (always public).
function isCardLocked() {
  return unveiled || myRole === 'LEADER';
}

card.addEventListener('click', () => {
  if (isCardLocked()) return;
  if (faceUp) hideCard();
  else showCard();
});

function showCard() {
  faceUp = true;
  card.classList.add('face-up');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hideCard, AUTO_HIDE_MS);
}
function hideCard() {
  if (isCardLocked()) return;
  faceUp = false;
  card.classList.remove('face-up');
  clearTimeout(hideTimer);
}
function lockFaceUp() {
  faceUp = true;
  card.classList.add('face-up');
  clearTimeout(hideTimer);
}
function resetCardToBack() {
  if (isCardLocked()) return; // Leader / unveiled players stay face-up
  faceUp = false;
  card.classList.remove('face-up');
  clearTimeout(hideTimer);
}

// ---- Unveil (reversible switch) ----
// Unveil is PRIVATE to this player — no one else sees it — so it's purely
// client-side. Keeping it local means it works even while the host is asleep.
el('unveil-toggle').addEventListener('change', (e) => {
  unveiled = e.target.checked;
  setUnveil(CODE, unveiled);
  if (unveiled) lockFaceUp();
  else hideCard();
});

// ---- Confirmation modal (reused by Restart and End Game) ----
const confirmModal = el('confirm-modal');
let confirmResolve = null;

function confirmAction(title, text) {
  el('confirm-title').textContent = title;
  el('confirm-text').textContent = text;
  confirmModal.classList.remove('hidden');
  return new Promise((resolve) => { confirmResolve = resolve; });
}
function closeConfirm(result) {
  confirmModal.classList.add('hidden');
  const r = confirmResolve;
  confirmResolve = null;
  r?.(result);
}
el('confirm-cancel').addEventListener('click', () => closeConfirm(false));
el('confirm-ok').addEventListener('click', () => closeConfirm(true));
// Tap outside the dialog cancels.
confirmModal.addEventListener('click', (e) => { if (e.target === confirmModal) closeConfirm(false); });

// ---- Deal again (dealer only) ----
el('dealagain-btn').addEventListener('click', async () => {
  const ok = await confirmAction('Restart game?', 'This deals fresh roles to everyone at the table. Continue?');
  if (!ok) return;
  el('dealagain-btn').disabled = true;
  try {
    const res = await fetch(`/api/rooms/${CODE}/deal`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + session.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ redeal: true }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      showError(d.error || 'Could not deal again.');
    } else {
      // Fresh deal: clear our private reveal + flip the card back down. The new
      // role arrives over the socket (onState re-fetches on the changed dealtAt).
      unveiled = false;
      setUnveil(CODE, false);
      el('unveil-toggle').checked = false;
      resetCardToBack();
    }
  } catch {
    showError('Connection error.');
  } finally {
    el('dealagain-btn').disabled = false;
  }
});

// ---- End game / close room (dealer only) ----
el('close-btn').addEventListener('click', async () => {
  const ok = await confirmAction('End game?', 'This closes the room and sends everyone back to the start. Continue?');
  if (!ok) return;
  el('close-btn').disabled = true;
  try {
    const res = await fetch(`/api/rooms/${CODE}/close`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + session.token },
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      showError(d.error || 'Could not close the room.');
      el('close-btn').disabled = false;
    }
    // The 'closed' socket message sends everyone (including us) back to the start.
  } catch {
    showError('Connection error.');
    el('close-btn').disabled = false;
  }
});

// ============================ Startup ============================
connect();
