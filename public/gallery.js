// Card gallery: every identity, grouped by role and ordered by rarity.
// Self-installs a header button on any page that already has Rules.
import { t, onLocaleChange } from '/i18n.js';

const ROLE_ICON = {
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

let catalog = null;

function shellHtml() {
  return `
  <div id="gallery-modal" class="modal-backdrop hidden">
    <div class="modal gallery-modal">
      <h3 class="rules-heading" id="gallery-title"></h3>
      <div id="gallery-body" class="gallery-body"></div>
      <button type="button" id="gallery-close" class="secondary"></button>
    </div>
  </div>
  <div id="gallery-view" class="modal-backdrop gallery-view hidden">
    <div class="card-viewer">
      <div class="card-viewer-name" id="gallery-view-name"></div>
      <img id="gallery-view-img" class="card-viewer-img" alt="" />
      <div class="card-viewer-hint" id="gallery-view-hint"></div>
    </div>
  </div>`;
}

function closeView() {
  document.getElementById('gallery-view')?.classList.add('hidden');
}

function openView(card) {
  const view = document.getElementById('gallery-view');
  if (!view) return;
  document.getElementById('gallery-view-name').textContent = card.name;
  const img = document.getElementById('gallery-view-img');
  img.src = card.url;
  img.alt = card.name;
  document.getElementById('gallery-view-hint').textContent = t('room.tapClose');
  view.classList.remove('hidden');
}

function thumb(card) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'gallery-thumb';
  const img = document.createElement('img');
  img.src = card.url;
  img.alt = card.name;
  img.loading = 'lazy';
  img.decoding = 'async';
  btn.title = card.name;
  btn.append(img);
  btn.addEventListener('click', () => openView(card));
  return btn;
}

function renderBody() {
  const body = document.getElementById('gallery-body');
  if (!body) return;
  body.replaceChildren();
  if (!catalog) {
    body.textContent = t('error.connectionShort');
    return;
  }
  for (const group of catalog.groups) {
    const section = document.createElement('section');
    section.className = 'gallery-section';
    const heading = document.createElement('h3');
    heading.className = 'gallery-role';
    const icon = document.createElement('img');
    icon.src = ROLE_ICON[group.role] || '';
    icon.alt = '';
    icon.width = 22;
    icon.height = 22;
    const label = document.createElement('span');
    label.textContent = t(ROLE_LABEL[group.role] || group.role);
    heading.append(icon, label);
    section.append(heading);

    let rarity = null;
    let grid = null;
    for (const card of group.cards) {
      if (card.rarity !== rarity) {
        rarity = card.rarity;
        const sub = document.createElement('div');
        sub.className = 'gallery-rarity';
        sub.textContent = t('rarity.' + card.rarity);
        section.append(sub);
        grid = document.createElement('div');
        grid.className = 'gallery-grid';
        section.append(grid);
      }
      grid.append(thumb(card));
    }
    body.append(section);
  }
}

async function loadCatalog() {
  if (catalog) return catalog;
  const res = await fetch('/api/catalog');
  if (!res.ok) throw new Error('catalog unavailable');
  catalog = await res.json();
  return catalog;
}

function close() {
  document.getElementById('gallery-modal')?.classList.add('hidden');
  closeView();
}

async function open() {
  const modal = document.getElementById('gallery-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  const body = document.getElementById('gallery-body');
  if (!catalog && body) body.textContent = '…';
  try {
    await loadCatalog();
    renderBody();
  } catch {
    if (body) body.textContent = t('error.connectionShort');
  }
}

function paintChrome() {
  const title = document.getElementById('gallery-title');
  const closeBtn = document.getElementById('gallery-close');
  const headerBtn = document.getElementById('gallery-btn');
  if (title) title.textContent = t('gallery.title');
  if (closeBtn) closeBtn.textContent = t('info.close');
  if (headerBtn) {
    headerBtn.textContent = t('gallery.btn');
    headerBtn.setAttribute('aria-label', t('gallery.btn'));
  }
}

function renderModal() {
  const prev = document.getElementById('gallery-modal');
  const wasOpen = prev && !prev.classList.contains('hidden');
  prev?.remove();
  document.getElementById('gallery-view')?.remove();
  document.body.insertAdjacentHTML('beforeend', shellHtml());
  document.getElementById('gallery-close').addEventListener('click', close);
  const modal = document.getElementById('gallery-modal');
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  const view = document.getElementById('gallery-view');
  view.addEventListener('click', closeView);
  paintChrome();
  if (wasOpen) open();
}

function install() {
  const slot = document.getElementById('lang-slot');
  if (!slot) return;

  let btn = document.getElementById('gallery-btn');
  if (!btn) {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'gallery-btn';
    btn.className = 'rules-btn';
    btn.addEventListener('click', open);
    slot.appendChild(btn);
  }
  renderModal();
}

onLocaleChange(() => {
  paintChrome();
  const modal = document.getElementById('gallery-modal');
  if (modal && !modal.classList.contains('hidden') && catalog) renderBody();
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(install, 0));
} else {
  setTimeout(install, 0);
}
