// Shared rules/info modal + header info button. Used on every screen so the
// rules are always one tap away. Import this module and it self-installs.

const RULES_HTML = `
  <div id="info-modal" class="modal-backdrop hidden">
    <div class="modal">
      <ul class="rules-list">
        <li>The <b>Leader</b> and the <b>Guardians</b> win if they are the last players standing.</li>
        <li>The <b>Assassins</b> win if the Leader is eliminated.</li>
        <li>The <b>Traitor</b> wins if they are the last player standing <i>(this implies killing the Assassins before the Leader. The Guardians can be ignored).</i></li>
      </ul>
      <ul class="rules-list">
        <li><b>Unveil {cost}:</b> Any time you have priority you may turn a face-down identity card with an unveil ability. This is a special action: it doesn't use the stack.</li>
        <li><b>Undercover:</b> Special unveil restriction. Unveil only if another non-Leader identity has been revealed or if a player other than you attacked a Leader this game.</li>
      </ul>
        <button id="info-close" class="secondary">Close</button>
      </div>
    </div>
  </div>`;

function install() {
  const brand = document.querySelector('.brand');
  if (!brand) return;

  // Info button in the header (if not already present).
  let infoBtn = document.getElementById('info-btn');
  if (!infoBtn) {
    infoBtn = document.createElement('button');
    infoBtn.id = 'info-btn';
    infoBtn.className = 'info-btn';
    infoBtn.setAttribute('aria-label', 'Rules');
    infoBtn.title = 'Rules';
    infoBtn.textContent = 'ⓘ';
    brand.appendChild(infoBtn);
  }

  // Rules modal (append once).
  if (!document.getElementById('info-modal')) {
    document.body.insertAdjacentHTML('beforeend', RULES_HTML);
  }

  const modal = document.getElementById('info-modal');
  const open = () => modal.classList.remove('hidden');
  const close = () => modal.classList.add('hidden');
  infoBtn.addEventListener('click', open);
  document.getElementById('info-close').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', install);
} else {
  install();
}
