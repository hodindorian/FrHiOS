// Page « sites web » dans Electron : YouTube/Deezer (Musique) ou Home Assistant (Administration).
//
// Les sites ne sont pas dans cette page : ce sont des vues natives gérées par le processus principal
// (electron/main.js), superposées à la zone `.web-slot`. Cette page se contente de :
//   - afficher les onglets et les boutons (clavier, retour, recharger, accueil)
//   - mesurer la zone libre et l'envoyer au processus principal
//   - dire quand elle apparaît ou disparaît (les sites restent chargés : la musique continue)

export const MUSIC_SERVICES = [
  { id: 'youtube', label: 'YouTube' },
  { id: 'deezer', label: 'Deezer' },
];
export const ADMIN_SERVICES = [{ id: 'ha', label: 'Home Assistant' }];

export function createElectronMusicPage(root, settings, persist, icons, osk, opts = {}) {
  const services = opts.services || MUSIC_SERVICES;
  const tabKey = opts.tabKey || 'musicTab';
  const api = window.frhios.music;
  let service = services.some((s) => s.id === settings[tabKey]) ? settings[tabKey] : services[0].id;
  let visible = false;

  root.classList.add('web-music');
  root.innerHTML = `
    <div class="web-bar">
      ${services.length > 1
        ? `<div class="tabs" role="tablist">
             ${services.map((s) => `<button data-tab="${s.id}" role="tab">${s.label}</button>`).join('')}
           </div>`
        : `<h1 class="web-title">${services[0].label}</h1>`}
      <div class="web-actions">
        <button class="icon-btn" data-act="kbd" aria-label="Clavier à l’écran">${icons.keyboard}</button>
        <button class="icon-btn" data-act="back" aria-label="Page précédente">${icons.chevLeft}</button>
        <button class="icon-btn" data-act="reload" aria-label="Recharger">${icons.reload}</button>
        <button class="icon-btn" data-act="home" aria-label="Page d’accueil du site">${icons.home}</button>
      </div>
    </div>
    <div class="web-slot" data-role="slot"></div>
  `;

  const slot = root.querySelector('[data-role="slot"]');

  function rect() {
    const r = slot.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }

  function renderTabs() {
    root.querySelectorAll('[data-tab]').forEach((b) => {
      const on = b.dataset.tab === service;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    });
  }

  function sync() {
    if (!visible) return;
    const r = rect();
    if (r.width > 0 && r.height > 0) api.show(service, r);
  }

  // La zone change de taille (fenêtre redimensionnée, clavier qui s'ouvre…)
  new ResizeObserver(() => {
    if (!visible) return;
    const r = rect();
    if (r.width > 0 && r.height > 0) api.setBounds(r);
  }).observe(slot);

  root.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-tab],[data-act]');
    if (!t) return;
    if (t.dataset.tab) {
      service = t.dataset.tab;
      settings[tabKey] = service;
      persist();
      renderTabs();
      osk.hideWeb(); // changer de site : l'ancien champ n'existe plus
      sync();
    } else if (t.dataset.act === 'kbd') {
      osk.toggleWeb();
    } else {
      api.action(service, t.dataset.act);
    }
  });

  renderTabs();

  return {
    onShow() {
      visible = true;
      // Attendre que la page soit réellement affichée pour mesurer la zone
      requestAnimationFrame(() => requestAnimationFrame(sync));
    },
    onHide() {
      visible = false;
      osk.hideWeb();
      api.hide();
    },
  };
}
