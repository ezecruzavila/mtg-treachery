// Room screen logic: presence WebSocket, lobby, role card and unveil.
import { getSession, clearSession, showError, saveRole, getRole, getUnveil, setUnveil, withSlot, currentSlot } from '/app.js';
import { t, onLocaleChange } from '/i18n.js';

const CODE = (location.pathname.match(/\/room\/([^/]+)/)?.[1] || '').toUpperCase();
const session = getSession(CODE);

if (!CODE || !session || !session.token) {
  // No session for this room: send to the join screen.
  location.replace(withSlot(`/join?code=${CODE}`));
}

// Back button from inside a room should go straight to Home (not step back
// through the code/name entry screens). Push a sentinel entry and, when the
// user navigates back onto it, send them Home.
history.pushState({ room: CODE }, '');
window.addEventListener('popstate', () => { location.replace(withSlot('/home')); });

const AUTO_HIDE_MS = 10_000;

// ---- Client state ----
let ws = null;
let lastRoom = null;   // last public state received
let myRole = null;     // my role (arrives over authenticated HTTP)
let myCard = null;     // URL of my assigned identity card image
let cardBackUrl = null; // URL of the shared card back
let unveiled = false;  // reveal state (reversible)
let defeated = false;  // eliminated this deal; identity stays public
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
      location.replace(withSlot('/home'));
      return;
    }
    if (msg.type === 'closed') {
      // The dealer closed the room: everyone returns to the start.
      clearSession(CODE);
      location.replace(withSlot('/home'));
      return;
    }
    if (msg.type === 'state') {
      onState(msg.room);
    }
  });

  ws.addEventListener('close', () => {
    connSub.textContent = t('room.reconnecting');
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
// In the multi-user lab, clicking another phone blurs this iframe — keep the
// card as-is so you can compare seats. Real play still hides on blur.
if (!currentSlot()) window.addEventListener('blur', hideCard);

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

    // Resync: if we unveiled while the host was asleep, the server may not know
    // yet. Push our local state so the rest of the table sees us.
    const me = room.you ? room.players.find((p) => p.id === room.you.id) : null;
    if (me?.defeated) {
      defeated = true;
      unveiled = true;
      setUnveil(CODE, true);
    } else {
      defeated = false;
    }
    if (me && unveiled && !me.unveiled && myRole !== 'LEADER') pushUnveil(true);

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
      location.replace(withSlot('/home'));
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
    else showError(t('error.role'));
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
      ? t('room.ready', { n: room.playerCount })
      : t('room.needPlayers', { n: room.playerCount });
  } else {
    dealArea.classList.add('hidden');
    waitArea.classList.remove('hidden');
    const dealer = room.players.find((p) => p.id === room.dealerId);
    el('dealer-name').textContent = dealer ? dealer.name : t('room.dealerFallback');
  }
}

// Token art shown next to a player once their identity is public (unveiled).
const ROLE_ICONS = {
  LEADER: '/assets/roles/leader.png',
  GUARDIAN: '/assets/roles/guardian.png',
  ASSASSIN: '/assets/roles/assassin.png',
  TRAITOR: '/assets/roles/traitor.png',
};
const ROLE_LABEL = {
  LEADER: 'info.roles.leader',
  GUARDIAN: 'info.roles.guardian',
  ASSASSIN: 'info.roles.assassin',
  TRAITOR: 'info.roles.traitor',
};

function roleIcon(role) {
  const url = ROLE_ICONS[role];
  if (!url) return null;
  preload(url);
  const img = document.createElement('img');
  img.className = 'role-icon';
  img.src = url;
  img.alt = t(ROLE_LABEL[role] || '');
  img.width = 22;
  img.height = 22;
  img.draggable = false;
  return img;
}

function renderPlayerList(ul, room) {
  ul.innerHTML = '';
  for (const p of room.players) {
    const li = document.createElement('li');
    if (p.defeated) {
      li.classList.add('defeated');
      li.title = p.name;
    }
    const dot = document.createElement('span');
    dot.className = 'dot' + (p.connected ? ' on' : '');
    const name = document.createElement('span');
    name.className = 'pname';
    name.textContent = p.name;
    li.append(dot, name);

    // Unveiled players show their role icon; the card is viewable on tap.
    if (p.unveiled && p.role) {
      li.classList.add('revealed');
      name.classList.add('tappable');
      const icon = roleIcon(p.role);
      if (icon) li.append(icon);
      name.addEventListener('click', () => showPlayerCard(p));
      // The whole row is tappable for a bigger hit target.
      li.addEventListener('click', (e) => {
        if (e.target === name) return; // name handler already fires
        showPlayerCard(p);
      });
    }
    if (p.defeated) li.append(badge(t('room.defeated'), 'defeated-badge'));

    ul.append(li);
  }
}

const COUNT_ROLES = [
  { key: 'TRAITOR', label: 'room.count.traitor' },
  { key: 'ASSASSIN', label: 'room.count.assassin' },
  { key: 'GUARDIAN', label: 'room.count.guardian' },
];

function renderRoleCounts(room) {
  const box = el('role-counts');
  box.innerHTML = '';
  const counts = room.roleCounts;
  if (!counts) {
    box.classList.add('hidden');
    return;
  }
  box.classList.remove('hidden');
  COUNT_ROLES.forEach((row, i) => {
    if (i) {
      const sep = document.createElement('span');
      sep.className = 'role-count-sep';
      sep.textContent = '·';
      box.append(sep);
    }
    const n = counts[row.key] ?? 0;
    const item = document.createElement('span');
    item.className = 'role-count' + (n === 0 ? ' zero' : '');
    item.textContent = `${n} ${t(row.label)}`;
    box.append(item);
  });
}

function badge(text, cls) {
  const b = document.createElement('span');
  b.className = 'badge ' + (cls || '');
  b.textContent = text;
  return b;
}

// ---- Card viewer (tap an unveiled player's name to see their card) ----
const cardModal = el('card-modal');
const cardModalImg = el('card-modal-img');
const cardModalName = el('card-modal-name');

function showPlayerCard(p) {
  if (!p.card) return;
  preload(p.card);
  cardModalImg.src = p.card;
  cardModalImg.alt = t('room.playerCardAlt', { name: p.name });
  cardModalName.textContent = p.name;
  cardModal.classList.remove('hidden');
}
function closeCardModal() {
  cardModal.classList.add('hidden');
}
cardModal.addEventListener('click', closeCardModal); // tap anywhere to dismiss

el('deal-btn').addEventListener('click', async () => {
  el('deal-btn').disabled = true;
  try {
    const res = await fetch(`/api/rooms/${CODE}/deal`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + session.token },
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      showError(d.error || t('error.deal'));
      el('deal-btn').disabled = false;
    }
    // The switch to "dealt" arrives over the socket; nothing else to do here.
  } catch {
    showError(t('error.connectionShort'));
    el('deal-btn').disabled = false;
  }
});

// ============================ Render: MY ROLE ============================
function renderRoleView(room) {
  renderRoleCounts(room);
  renderPlayerList(el('players-role'), room);

  // Set the card images: front = assigned identity card, back = shared card back.
  const frontImg = el('card-front-img');
  const backImg = el('card-back-img');
  if (myCard && frontImg.getAttribute('src') !== myCard) frontImg.src = myCard;
  if (cardBackUrl && backImg.getAttribute('src') !== cardBackUrl) backImg.src = cardBackUrl;

  const me = room.you ? room.players.find((p) => p.id === room.you.id) : null;
  defeated = !!(me && me.defeated);

  // The Leader is public: their card is always face-up and has no Unveil switch.
  // Defeated players also stay face-up (identity is public).
  const iAmLeader = myRole === 'LEADER';
  el('unveil-area').classList.toggle('hidden', iAmLeader || defeated);
  el('role-help').classList.toggle('hidden', iAmLeader || defeated);
  el('defeat-btn').disabled = defeated;

  if (iAmLeader || defeated || unveiled) {
    if (defeated) {
      unveiled = true;
      setUnveil(CODE, true);
    }
    lockFaceUp();
    el('unveil-toggle').checked = unveiled || iAmLeader || defeated;
  } else {
    el('unveil-toggle').checked = false;
    resetCardToBack();
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
  return unveiled || defeated || myRole === 'LEADER';
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
// Unveiling is now PUBLIC: it flips the card face-up locally (so it keeps
// working even while the host sleeps) AND tells the server, so everyone at the
// table sees this player's identity (icon + card). We keep the local flag too
// for instant rendering and offline resilience.
el('unveil-toggle').addEventListener('change', (e) => {
  if (defeated) {
    e.target.checked = true;
    return;
  }
  unveiled = e.target.checked;
  setUnveil(CODE, unveiled);
  if (unveiled) lockFaceUp();
  else hideCard();
  pushUnveil(unveiled);
});

// Publishes the unveil state to the server (best-effort; local state already
// updated). Other players receive it over the socket.
async function pushUnveil(value) {
  try {
    await fetch(`/api/rooms/${CODE}/unveil`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + session.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ unveiled: value }),
    });
  } catch {
    /* host may be asleep; the local reveal still works, we'll resync on reconnect */
  }
}

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

el('defeat-btn').addEventListener('click', async () => {
  if (defeated) return;
  const ok = await confirmAction(t('confirm.defeatTitle'), t('confirm.defeatText'));
  if (!ok) return;
  el('defeat-btn').disabled = true;
  try {
    const res = await fetch(`/api/rooms/${CODE}/defeat`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + session.token },
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      showError(d.error || t('error.defeat'));
      el('defeat-btn').disabled = false;
      return;
    }
    defeated = true;
    unveiled = true;
    setUnveil(CODE, true);
    if (lastRoom?.you) {
      const me = lastRoom.players.find((p) => p.id === lastRoom.you.id);
      if (me) {
        me.defeated = true;
        me.unveiled = true;
        me.role = me.role || myRole;
        me.card = me.card || myCard;
        if (lastRoom.roleCounts && myRole && lastRoom.roleCounts[myRole] != null) {
          lastRoom.roleCounts[myRole] = Math.max(0, lastRoom.roleCounts[myRole] - 1);
        }
      }
    }
    if (lastRoom) renderRoleView(lastRoom);
    else {
      el('unveil-toggle').checked = true;
      lockFaceUp();
    }
  } catch {
    showError(t('error.connectionShort'));
    el('defeat-btn').disabled = false;
  }
});

// ---- Deal again (dealer only) ----
el('dealagain-btn').addEventListener('click', async () => {
  const ok = await confirmAction(t('confirm.restartTitle'), t('confirm.restartText'));
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
      showError(d.error || t('error.dealAgain'));
    } else {
      // Fresh deal: clear our private reveal + flip the card back down. The new
      // role arrives over the socket (onState re-fetches on the changed dealtAt).
      unveiled = false;
      defeated = false;
      setUnveil(CODE, false);
      el('unveil-toggle').checked = false;
      el('defeat-btn').disabled = false;
      resetCardToBack();
    }
  } catch {
    showError(t('error.connectionShort'));
  } finally {
    el('dealagain-btn').disabled = false;
  }
});

// ---- End game / close room (dealer only) ----
el('close-btn').addEventListener('click', async () => {
  const ok = await confirmAction(t('confirm.endTitle'), t('confirm.endText'));
  if (!ok) return;
  el('close-btn').disabled = true;
  try {
    const res = await fetch(`/api/rooms/${CODE}/close`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + session.token },
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      showError(d.error || t('error.close'));
      el('close-btn').disabled = false;
    }
    // The 'closed' socket message sends everyone (including us) back to the start.
  } catch {
    showError(t('error.connectionShort'));
    el('close-btn').disabled = false;
  }
});

onLocaleChange(() => {
  if (ws && ws.readyState !== WebSocket.OPEN) connSub.textContent = t('room.reconnecting');
  if (!lastRoom) return;
  if (lastRoom.phase === 'dealt') renderRoleView(lastRoom);
  else renderLobby(lastRoom);
});

// ============================ Startup ============================
connect();
