// Home-only "Example" popup: a static 5-player table illustration.
// Two pairs of non-leader identities face each other (top pair rotated toward
// the bottom pair); the Leader lies perpendicular and centered between them,
// always face-up (it is public by rule). The four non-leader cards start
// revealed and flip to their backs every 5 s, to show those roles stay hidden.
import { t, applyTranslations, onLocaleChange } from '/i18n.js';

const FLIP_MS = 5000;

let table = null;      // { cardBack, cards:[{role,url}], leader:{role,url} }
let flipTimer = null;
let faceUp = false;
const staggerTimers = []; // per-card timeouts for the staggered flip

/** Fetches the fixed sample table once (URLs resolve per build flavor server-side). */
async function loadTable() {
  if (table) return table;
  const res = await fetch('/api/example');
  if (!res.ok) throw new Error('example unavailable');
  table = await res.json();
  return table;
}

function cardEl(card, back) {
  const wrap = document.createElement('div');
  wrap.className = 'ex-card role-card no-anim';
  wrap.innerHTML = `
    <div class="face back"><img alt="" src="${back}" /></div>
    <div class="face front"><img alt="" src="${card.url || ''}" /></div>`;
  return wrap;
}

function buildBoard() {
  const board = document.createElement('div');
  board.className = 'ex-board';

  // Non-leader cards start revealed (face-up); they flip to their backs on the
  // first 5 s tick.
  const nonLeader = (card) => {
    const el = cardEl(card, table.cardBack);
    el.classList.add('face-up');
    return el;
  };

  // Two pairs facing each other: the top pair is rotated toward the center.
  const [c0, c1, c2, c3] = table.cards;
  const top = document.createElement('div');
  top.className = 'ex-pair top';
  top.append(nonLeader(c0), nonLeader(c1));

  // The Leader sits perpendicular and centered, same size as the rest.
  const leaderRow = document.createElement('div');
  leaderRow.className = 'ex-leader';
  const leader = cardEl(table.leader, table.cardBack);
  leader.classList.add('face-up', 'is-leader'); // Leader is public from the start
  leaderRow.append(leader);

  const bottom = document.createElement('div');
  bottom.className = 'ex-pair bottom';
  bottom.append(nonLeader(c2), nonLeader(c3));

  // The four non-leader identities on top; the Leader below them.
  board.append(top, bottom, leaderRow);
  return board;
}

const STAGGER_MS = 140; // delay between each card's flip within a tick

function startFlipping(root) {
  stopFlipping();
  faceUp = true; // non-leader cards start revealed
  flipTimer = setInterval(() => {
    faceUp = !faceUp;
    const cards = [...root.querySelectorAll('.ex-pair .ex-card')];
    // Flip the cards one by one in quick succession, not all at once.
    cards.forEach((el, i) => {
      const id = setTimeout(() => {
        // The no-anim class suppresses the flip on first paint only; drop it so
        // the periodic toggles animate.
        el.classList.remove('no-anim');
        el.classList.toggle('face-up', faceUp);
      }, i * STAGGER_MS);
      staggerTimers.push(id);
    });
  }, FLIP_MS);
}

function stopFlipping() {
  if (flipTimer) { clearInterval(flipTimer); flipTimer = null; }
  for (const id of staggerTimers) clearTimeout(id);
  staggerTimers.length = 0;
}

function modalHtml() {
  return `
  <div id="example-modal" class="modal-backdrop hidden">
    <div class="modal ex-modal">
      <h3 class="rules-heading" data-i18n="example.title">${t('example.title')}</h3>
      <div id="example-board"></div>
      <button id="example-close" class="secondary" data-i18n="info.close">${t('info.close')}</button>
    </div>
  </div>`;
}

function close() {
  const modal = document.getElementById('example-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  stopFlipping();
}

async function open() {
  const modal = document.getElementById('example-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  try {
    await loadTable();
    const host = document.getElementById('example-board');
    host.innerHTML = '';
    const board = buildBoard();
    host.append(board);
    applyTranslations(modal);
    // Let the initial (no-anim) face-down state paint, then begin flipping.
    requestAnimationFrame(() => startFlipping(host));
  } catch {
    const host = document.getElementById('example-board');
    if (host) host.textContent = t('error.connectionShort');
  }
}

function renderModal() {
  document.getElementById('example-modal')?.remove();
  document.body.insertAdjacentHTML('beforeend', modalHtml());
  const modal = document.getElementById('example-modal');
  document.getElementById('example-close').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
}

function install() {
  const actions = document.querySelector('.brand .header-actions');
  if (!actions) return; // header not ready or no rules.js on this page

  let btn = document.getElementById('example-btn');
  if (!btn) {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'example-btn';
    btn.className = 'rules-btn'; // reuse the header pill styling
    btn.addEventListener('click', open);
    // Order: Rules first, then Example.
    actions.appendChild(btn);
  }
  btn.textContent = t('example.btn');
  btn.setAttribute('aria-label', t('example.btn'));

  renderModal();
}

onLocaleChange(() => {
  const btn = document.getElementById('example-btn');
  if (btn) { btn.textContent = t('example.btn'); btn.setAttribute('aria-label', t('example.btn')); }
  const modal = document.getElementById('example-modal');
  const wasOpen = modal && !modal.classList.contains('hidden');
  renderModal();
  if (wasOpen) open();
});

// rules.js builds `.header-actions`; wait a tick so it exists first.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(install, 0));
} else {
  setTimeout(install, 0);
}
