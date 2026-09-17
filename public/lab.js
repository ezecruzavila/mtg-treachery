// Multi-user lab: one desktop window, N isolated "phones" (iframes with ?slot=).
import { saveSession, setName, clearSlot } from '/app.js';

const NAMES = ['Ann', 'Bob', 'Cam', 'Dee', 'Eve', 'Fay', 'Gus', 'Hal'];
const PHONE_W = 390;
const PHONE_H = 780;

const phonesEl = document.getElementById('phones');
const statusEl = document.getElementById('status');
const fillBtn = document.getElementById('fill-btn');
const blankBtn = document.getElementById('blank-btn');
const resetBtn = document.getElementById('reset-btn');

let playerCount = 4;
let rarity = 'U';
let lastCode = null;
let lastDealerToken = null;
const fitters = [];

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle('error-text', isError);
}

function bindSegmented(id, attr, onChange) {
  const box = document.getElementById(id);
  box.addEventListener('click', (e) => {
    const btn = e.target.closest(`[${attr}]`);
    if (!btn) return;
    for (const b of box.children) b.classList.toggle('active', b === btn);
    onChange(btn.getAttribute(attr));
  });
}

bindSegmented('count', 'data-n', (n) => { playerCount = Number(n); });
bindSegmented('rarity', 'data-rarity', (r) => { rarity = r; });

async function postJson(url, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body || {}) });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

function slotOf(i) {
  return String(i + 1);
}

function clearAllSlots() {
  for (let i = 0; i < 8; i++) clearSlot(slotOf(i));
}

function fitPhone(wrapper, iframe) {
  const scale = wrapper.clientWidth / PHONE_W;
  iframe.style.transform = `scale(${scale})`;
  wrapper.style.height = `${PHONE_H * scale}px`;
}

function renderPhones(count, srcForSlot) {
  fitters.length = 0;
  phonesEl.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const slot = slotOf(i);
    const name = NAMES[i];
    const phone = document.createElement('div');
    phone.className = 'phone';

    const bar = document.createElement('div');
    bar.className = 'phone-bar';
    const slotEl = document.createElement('span');
    slotEl.className = 'slot';
    slotEl.textContent = `P${slot}`;
    const nameEl = document.createElement('span');
    nameEl.className = 'name';
    nameEl.textContent = name;
    const pop = document.createElement('button');
    pop.type = 'button';
    pop.textContent = 'Pop out';
    pop.title = 'Open this player in a new window';
    bar.append(slotEl, nameEl, pop);

    const screen = document.createElement('div');
    screen.className = 'phone-screen';
    const iframe = document.createElement('iframe');
    iframe.title = `${name} (player ${slot})`;
    iframe.src = srcForSlot(slot, name);
    screen.append(iframe);

    pop.addEventListener('click', () => {
      const url = iframe.contentWindow?.location?.href || iframe.src;
      window.open(url, `treachery-slot-${slot}`, 'width=390,height=780');
    });

    phone.append(bar, screen);
    phonesEl.append(phone);

    const fit = () => fitPhone(screen, iframe);
    fitters.push(fit);
    iframe.addEventListener('load', fit);
  }
  requestAnimationFrame(() => fitters.forEach((f) => f()));
}

async function closeLastRoom() {
  if (!lastCode || !lastDealerToken) return;
  try {
    await postJson(`/api/rooms/${lastCode}/close`, {}, lastDealerToken);
  } catch {
    /* room may already be gone */
  }
  lastCode = null;
  lastDealerToken = null;
}

function seedNames(count) {
  for (let i = 0; i < count; i++) setName(NAMES[i], slotOf(i));
}

blankBtn.addEventListener('click', async () => {
  await closeLastRoom();
  clearAllSlots();
  seedNames(playerCount);
  renderPhones(playerCount, (slot) => `/home?slot=${encodeURIComponent(slot)}`);
  setStatus(`${playerCount} blank phones. Create a room on one and join from the others.`);
});

fillBtn.addEventListener('click', async () => {
  fillBtn.disabled = true;
  setStatus('Seating players…');
  try {
    await closeLastRoom();
    clearAllSlots();
    seedNames(playerCount);

    const created = await postJson('/api/rooms', { name: NAMES[0], rarity });
    if (!created.res.ok) {
      setStatus(created.data.error || 'Could not create the room.', true);
      return;
    }
    const code = created.data.roomCode;
    saveSession(code, {
      token: created.data.token,
      playerId: created.data.playerId,
      name: NAMES[0],
    }, '1');
    lastCode = code;
    lastDealerToken = created.data.token;

    for (let i = 1; i < playerCount; i++) {
      const joined = await postJson(`/api/rooms/${code}/join`, { name: NAMES[i] });
      if (!joined.res.ok) {
        setStatus(joined.data.error || `Could not seat ${NAMES[i]}.`, true);
        return;
      }
      saveSession(code, {
        token: joined.data.token,
        playerId: joined.data.playerId,
        name: NAMES[i],
      }, slotOf(i));
    }

    renderPhones(playerCount, (slot) => `/room/${code}?slot=${encodeURIComponent(slot)}`);
    setStatus(`Room ${code} — ${playerCount} players seated. Ann is the dealer.`);
  } catch {
    setStatus('Connection error with the server.', true);
  } finally {
    fillBtn.disabled = false;
  }
});

resetBtn.addEventListener('click', async () => {
  await closeLastRoom();
  clearAllSlots();
  phonesEl.innerHTML = '';
  setStatus('Cleared. Start a table, or open blank phones.');
});

window.addEventListener('resize', () => fitters.forEach((f) => f()));
if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => fitters.forEach((f) => f())).observe(phonesEl);
}

// First paint: a ready-to-play table so the lab is useful on open.
fillBtn.click();
