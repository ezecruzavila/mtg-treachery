// Shared rules modal, language switcher, and header Rules button.
// Import this module and it self-installs on any page with a `.brand` header.
import { t, getLocale, setLocale, LOCALES, applyTranslations, onLocaleChange } from '/i18n.js';

// Official default identity mix (mtgtreachery.net / CR 907.3c). Public knowledge (907.3d).
const ROLE_MIX = [
  { n: 4, leader: 1, traitor: 1, assassin: 2, guardian: 0 },
  { n: 5, leader: 1, traitor: 1, assassin: 2, guardian: 1 },
  { n: 6, leader: 1, traitor: 1, assassin: 3, guardian: 1 },
  { n: 7, leader: 1, traitor: 1, assassin: 3, guardian: 2 },
  { n: 8, leader: 1, traitor: 2, assassin: 3, guardian: 2 },
];

function countCell(n) {
  return n === 0 ? '—' : String(n);
}

function roleMixTable() {
  const head = `
    <tr>
      <th>${t('info.roles.players')}</th>
      <th>${t('info.roles.leader')}</th>
      <th>${t('info.roles.traitor')}</th>
      <th>${t('info.roles.assassin')}</th>
      <th>${t('info.roles.guardian')}</th>
    </tr>`;
  const body = ROLE_MIX.map((row) => `
    <tr>
      <td>${row.n}</td>
      <td>${countCell(row.leader)}</td>
      <td>${countCell(row.traitor)}</td>
      <td>${countCell(row.assassin)}</td>
      <td>${countCell(row.guardian)}</td>
    </tr>`).join('');
  return `<table class="rules-table"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

function rulesModalHtml() {
  return `
  <div id="rules-modal" class="modal-backdrop hidden">
    <div class="modal info-modal">
      <h3 class="rules-heading">${t('info.basics')}</h3>
      <ul class="rules-list">
        <li>${t('info.basics.deal')}</li>
        <li>${t('info.basics.leaderStart')}</li>
        <li>${t('info.basics.hidden')}</li>
        <li>${t('info.lose.body')}</li>
      </ul>
      <h3 class="rules-heading">${t('info.winConditions')}</h3>
      <ul class="rules-list">
        <li>${t('info.win.leader')}</li>
        <li>${t('info.win.assassins')}</li>
        <li>${t('info.win.traitor')}</li>
      </ul>
      <h3 class="rules-heading">${t('info.roles')}</h3>
      ${roleMixTable()}
      <h3 class="rules-heading">${t('info.abilities')}</h3>
      <ul class="rules-list">
        <li>${t('info.unveil')}</li>
        <li>${t('info.undercover')}</li>
      </ul>
      <button id="rules-close" class="secondary">${t('info.close')}</button>
    </div>
  </div>`;
}

function closeRules() {
  document.getElementById('rules-modal')?.classList.add('hidden');
}
function openRules() {
  document.getElementById('rules-modal')?.classList.remove('hidden');
}

function renderRulesModal() {
  const prev = document.getElementById('rules-modal');
  const wasOpen = prev && !prev.classList.contains('hidden');
  prev?.remove();
  document.body.insertAdjacentHTML('beforeend', rulesModalHtml());
  const modal = document.getElementById('rules-modal');
  if (wasOpen) modal.classList.remove('hidden');
  document.getElementById('rules-close').addEventListener('click', closeRules);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeRules(); });
}

function install() {
  const brand = document.querySelector('.brand');
  if (!brand) return;

  let actions = brand.querySelector('.header-actions');
  if (!actions) {
    actions = document.createElement('div');
    actions.className = 'header-actions';
    brand.appendChild(actions);
  }

  let langSelect = document.getElementById('lang-select');
  if (!langSelect) {
    langSelect = document.createElement('select');
    langSelect.id = 'lang-select';
    langSelect.className = 'lang-select';
    for (const loc of LOCALES) {
      const opt = document.createElement('option');
      opt.value = loc;
      opt.textContent = loc;
      langSelect.appendChild(opt);
    }
    langSelect.addEventListener('change', () => setLocale(langSelect.value));
    actions.appendChild(langSelect);
  }
  langSelect.value = getLocale();
  langSelect.setAttribute('aria-label', t('lang.label'));
  langSelect.title = t('lang.label');

  let rulesBtn = document.getElementById('rules-btn');
  if (!rulesBtn) {
    rulesBtn = document.createElement('button');
    rulesBtn.type = 'button';
    rulesBtn.id = 'rules-btn';
    rulesBtn.className = 'rules-btn';
    rulesBtn.addEventListener('click', openRules);
    actions.appendChild(rulesBtn);
  }
  rulesBtn.textContent = t('rules.btn');
  rulesBtn.setAttribute('aria-label', t('rules.btn'));

  renderRulesModal();
  applyTranslations();
}

onLocaleChange(() => {
  const langSelect = document.getElementById('lang-select');
  const rulesBtn = document.getElementById('rules-btn');
  if (langSelect) {
    langSelect.value = getLocale();
    langSelect.setAttribute('aria-label', t('lang.label'));
    langSelect.title = t('lang.label');
  }
  if (rulesBtn) {
    rulesBtn.textContent = t('rules.btn');
    rulesBtn.setAttribute('aria-label', t('rules.btn'));
  }
  renderRulesModal();
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', install);
} else {
  install();
}
