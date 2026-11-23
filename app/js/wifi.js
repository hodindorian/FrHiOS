// Section « Wi-Fi » des Réglages : état, liste des réseaux, saisie du mot de passe.
// Fonctionne via NetworkManager (nmcli) côté processus principal ; absente hors Electron.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const bars = (signal) => (signal > 75 ? '▂▄▆█' : signal > 50 ? '▂▄▆' : signal > 25 ? '▂▄' : '▂');

export function mountWifi(box) {
  const api = window.frhios?.wifi;
  if (!api) { box.innerHTML = ''; return; }

  let step = 'status';     // 'status' | 'scanning' | 'list' | 'password'
  let status = null;
  let networks = [];
  let chosen = null;
  let message = '';

  async function refreshStatus() {
    status = await api.status();
    draw();
  }

  async function scan() {
    step = 'scanning';
    message = '';
    draw();
    networks = await api.scan();
    step = 'list';
    draw();
  }

  async function connect(ssid, password) {
    step = 'status';
    message = `Connexion à « ${ssid} »…`;
    draw();
    const r = await api.connect(ssid, password);
    message = r.ok ? `Connecté à « ${ssid} »` : `Échec : ${r.error}`;
    status = await api.status();
    draw();
  }

  function statusLine() {
    if (!status) return 'Lecture de l’état du réseau…';
    if (!status.available) return 'La gestion du réseau n’est pas disponible sur cette machine.';
    if (status.wifiConnected) return `Connecté en Wi-Fi à « ${esc(status.ssid)} »`;
    if (status.ethernet) return 'Connecté par câble Ethernet';
    if (!status.hasWifi) return 'Aucune carte Wi-Fi détectée';
    return 'Non connecté';
  }

  function draw() {
    let body = '';
    if (step === 'status') {
      body = `
        <p class="hint">${statusLine()}</p>
        ${message ? `<p class="hint">${esc(message)}</p>` : ''}
        ${status?.available && status.hasWifi ? '<button class="btn" data-w="scan">Choisir un réseau Wi-Fi</button>' : ''}`;
    } else if (step === 'scanning') {
      body = '<p class="hint">Recherche des réseaux…</p>';
    } else if (step === 'list') {
      body = networks.length
        ? `<div class="wifi-list">${networks.map((n, i) => `
            <button class="wifi-item ${n.inUse ? 'active' : ''}" data-w="pick" data-i="${i}">
              <span>${esc(n.ssid)}</span>
              <span class="muted">${n.secure ? 'sécurisé · ' : ''}${bars(n.signal)}</span>
            </button>`).join('')}</div>
           <button class="btn" data-w="scan" style="margin-top:.8rem">Actualiser</button>
           <button class="btn" data-w="cancel" style="margin-top:.8rem">Retour</button>`
        : `<p class="hint">Aucun réseau trouvé.</p>
           <button class="btn" data-w="scan">Réessayer</button>
           <button class="btn" data-w="cancel">Retour</button>`;
    } else if (step === 'password') {
      body = `
        <p class="hint">Mot de passe de « ${esc(chosen.ssid)} »</p>
        <form data-w="form" class="wifi-form">
          <input class="text-input" id="wifi-pw" type="password" autocomplete="off"
                 autocapitalize="off" spellcheck="false" placeholder="Mot de passe">
          <button class="btn primary" type="submit">Connecter</button>
          <button class="btn" type="button" data-w="cancel">Annuler</button>
        </form>`;
    }
    box.innerHTML = `<div class="field-label"><span>Réseau</span></div>${body}`;
    if (step === 'password') box.querySelector('#wifi-pw')?.focus();
  }

  box.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-w]');
    if (!t) return;
    switch (t.dataset.w) {
      case 'scan': scan(); break;
      case 'cancel': step = 'status'; draw(); break;
      case 'pick': {
        chosen = networks[Number(t.dataset.i)];
        if (!chosen) break;
        if (chosen.secure) { step = 'password'; draw(); } else connect(chosen.ssid, null);
        break;
      }
    }
  });

  box.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const pw = box.querySelector('#wifi-pw')?.value ?? '';
    if (chosen) connect(chosen.ssid, pw);
  });

  draw();
  refreshStatus();
}
