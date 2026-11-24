import { load, save } from './store.js';
import { MockBackend } from './backend-mock.js';
import { HABackend } from './backend-ha.js';
import { icons, domainIcon } from './icons.js';
import { createMusicPage } from './music.js';
import { createElectronMusicPage, ADMIN_SERVICES } from './music-electron.js';
import { mountWifi } from './wifi.js';
import { mountUpdate } from './update.js';
import { createTerminalPage } from './terminal.js';
import { createOsk } from './osk.js';
import { mountSetup, onHaStatus } from './setup.js';

/* ============================== Utilitaires ============================== */

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const settings = load();            // muté sur place (le module musique garde la référence)
const persist = () => save(settings);

let backend = null;
let entities = [];
let haLocal = null;                 // état du Home Assistant local (electron/ha-local.js)
let backendToken = null;            // jeton avec lequel le backend actuel a été créé

// Mode effectif : 'local' (HA de l'appareil, automatique), 'ha' (serveur saisi à la main) ou 'mock'
const LOCAL_AVAILABLE = Boolean(window.frhios?.ha);
const mode = () => (settings.backend === 'auto' ? (LOCAL_AVAILABLE ? 'local' : 'mock') : settings.backend);
let view = 'home';
let sheetId = null;                 // appareil dont la fenêtre de détail est ouverte
let dragging = false;               // un curseur est en cours de déplacement
// Pages qui restent vivantes (juste masquées) quand on change d'onglet : leur contenu ne doit pas
// être recréé (lecteur de musique, sites web). Chaque page expose onShow() / onHide().
const PERSISTENT = ['music', 'admin', 'terminal'];
const pages = {};
let shownPersistent = null;

// Sur l'appareil (lancé avec ?kiosk), la fenêtre remplit déjà l'écran : pas de bouton « plein écran »
// (le basculement bloquait l'affichage dans une machine virtuelle).
const KIOSK_UI = new URLSearchParams(location.search).has('kiosk');

const NAV = [
  { id: 'home', label: 'Accueil', icon: icons.home },
  { id: 'devices', label: 'Appareils', icon: icons.grid },
  { id: 'tv', label: 'TV', icon: icons.tv },
  { id: 'music', label: 'Musique', icon: icons.music },
  { id: 'spacer' },
  // Extinction : seulement dans l'application (Electron), pas dans un navigateur
  { id: 'power', label: 'Éteindre', icon: icons.power, appOnly: true, sheet: true },
  { id: 'settings', label: 'Réglages', icon: icons.settings },
];
const visibleNav = () => NAV.filter((n) => !n.appOnly || window.frhios?.system);

/* ============================== Entités ============================== */

const isUnavailable = (e) => e.state === 'unavailable' || e.state === 'unknown';
const isOn = (e) => (e.domain === 'media_player'
  ? !['off', 'standby', 'unavailable', 'unknown'].includes(e.state)
  : e.state === 'on');

const modes = (e) => e.attributes.supported_color_modes || [];
const hasBrightness = (e) => e.domain === 'light'
  && (modes(e).length ? modes(e).some((m) => m !== 'onoff') : 'brightness' in e.attributes);
const hasColor = (e) => modes(e).some((m) => ['rgb', 'hs', 'xy', 'rgbw', 'rgbww'].includes(m));
const hasTemp = (e) => modes(e).includes('color_temp');
const brightnessPct = (e) => Math.round(((e.attributes.brightness ?? 255) / 255) * 100);
const accentOf = (e) => {
  const c = e.attributes.rgb_color;
  return c && isOn(e) ? `rgb(${c[0]}, ${c[1]}, ${c[2]})` : '';
};

function subtitle(e) {
  if (isUnavailable(e)) return 'Indisponible';
  if (!isOn(e)) return 'Éteint';
  if (e.domain === 'light' && hasBrightness(e)) return `Allumé · ${brightnessPct(e)} %`;
  if (e.domain === 'media_player' && e.attributes.volume_level != null) {
    return `Allumée · vol. ${Math.round(e.attributes.volume_level * 100)} %`;
  }
  return 'Allumé';
}

const byId = (id) => entities.find((e) => e.id === id);

// Une tuile par appareil. Home Assistant crée souvent plusieurs entités par appareil (prise Tapo :
// l'interrupteur, sa LED, l'arrêt automatique, les mises à jour…) : on ne garde que la principale.
//  - entités marquées « réglage » / « diagnostic » / masquées dans HA : jamais affichées
//  - par appareil : un seul lecteur (télé) et ses lumières (ampoule, Ambilight) ; s'il n'y en a pas,
//    l'interrupteur qui porte le nom de l'appareil (la prise elle-même)
// Réglages › « Tout afficher » montre tout, pour comprendre ce que HA a créé.
const CONTROL = ['light', 'switch', 'media_player'];

function primaryOf(group) {
  const lightsIn = group.filter((e) => e.domain === 'light');
  const player = group.find((e) => e.domain === 'media_player');
  if (lightsIn.length || player) return [...(player ? [player] : []), ...lightsIn];
  const sw = group.filter((e) => e.domain === 'switch');
  const main = sw.find((e) => e.deviceName && e.name === e.deviceName)
    || [...sw].sort((a, b) => a.name.length - b.name.length)[0];
  return main ? [main] : [];
}

function controllable() {
  const list = entities.filter((e) => CONTROL.includes(e.domain));
  if (settings.showAll) return list;
  const out = [];
  const byDevice = new Map();
  for (const e of list) {
    if (e.secondary) continue;
    if (!e.device) { out.push(e); continue; }
    if (!byDevice.has(e.device)) byDevice.set(e.device, []);
    byDevice.get(e.device).push(e);
  }
  for (const group of byDevice.values()) out.push(...primaryOf(group));
  return out;
}

const lights = () => controllable().filter((e) => e.domain === 'light');
const switches = () => controllable().filter((e) => e.domain === 'switch');

/* ============================== Appels backend ============================== */

let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

async function call(domain, service, entityId, data) {
  if (!backend) return;
  try {
    await backend.call(domain, service, entityId, data);
  } catch (err) {
    toast(`Échec : ${err.message}`);
  }
}

/* ============================== Vues ============================== */

function tile(e) {
  const on = isOn(e);
  const accent = accentOf(e);
  const more = e.domain === 'light' || e.domain === 'media_player';
  return `
    <div class="tile ${on ? 'on' : ''}" ${accent ? `style="--c:${accent}"` : ''}>
      <button class="tile-main" data-action="toggle" data-id="${esc(e.id)}"
              ${isUnavailable(e) ? 'disabled' : ''} aria-pressed="${on}">
        <span class="tile-icon">${domainIcon(e.domain)}</span>
        <span>
          <div class="tile-name">${esc(e.name)}</div>
          <div class="tile-sub">${esc(subtitle(e))}</div>
        </span>
      </button>
      ${more ? `<button class="tile-more" data-action="more" data-id="${esc(e.id)}" aria-label="Réglages de ${esc(e.name)}">⋯</button>` : ''}
    </div>`;
}

function homeView() {
  const on = controllable().filter(isOn);
  return `
    <section class="hero">
      <div class="clock" id="clock"></div>
      <div class="date" id="date"></div>
    </section>

    <div class="chips">
      <button class="chip-btn" data-action="all-off">${icons.power} Tout éteindre</button>
      <button class="chip-btn" data-action="ambiance">${icons.moon} Ambiance chaude</button>
    </div>

    <h2>Allumés${on.length ? ` · ${on.length}` : ''}</h2>
    ${on.length
      ? `<div class="grid">${on.map(tile).join('')}</div>`
      : '<div class="empty">Rien n’est allumé pour le moment.</div>'}
  `;
}

// Message quand il n'y a rien à afficher, selon l'état de Home Assistant
function noDevicesHTML(what = 'Aucun appareil connecté pour l’instant.') {
  if (mode() === 'local') {
    if (!haLocal || ['waiting', 'setup'].includes(haLocal.state)) {
      return `<div class="empty">${esc(haLocal?.message || 'Démarrage de Home Assistant…')}<br>
        <span class="muted">Au tout premier démarrage, cela peut prendre quelques minutes.</span></div>`;
    }
    if (haLocal.state !== 'ready') return `<div class="empty">${esc(haLocal.message)}</div>`;
    return `<div class="empty">${what}<br><br>
      <button class="btn primary" data-action="open-setup">Connecter des appareils</button></div>`;
  }
  return `<div class="empty">${what}<br>Connectez Home Assistant dans <b>Réglages</b>, ou utilisez le mode démo.</div>`;
}

const addButton = () => (mode() === 'local' && haLocal?.state === 'ready'
  ? `<button class="btn" data-action="open-setup">＋ Ajouter</button>` : '');

function devicesView() {
  const list = controllable();
  if (!list.length) return `<div class="title-row"><h1>Appareils</h1>${addButton()}</div>${noDevicesHTML()}`;
  const rooms = new Map();
  for (const e of list) {
    const r = e.room || 'Sans pièce';
    if (!rooms.has(r)) rooms.set(r, []);
    rooms.get(r).push(e);
  }
  const names = [...rooms.keys()].sort((a, b) =>
    a === 'Sans pièce' ? 1 : b === 'Sans pièce' ? -1 : a.localeCompare(b, 'fr'));
  return `<div class="title-row"><h1>Appareils</h1>${addButton()}</div>` + names.map((r) =>
    `<h2>${esc(r)}</h2><div class="grid">${rooms.get(r).map(tile).join('')}</div>`).join('');
}

const TV_APPS = [
  ['YouTube', 'https://www.youtube.com'],
  ['Netflix', 'https://www.netflix.com'],
  ['Prime Video', 'https://app.primevideo.com'],
  ['Disney+', 'https://www.disneyplus.com'],
];

// Adresse MAC de la télé Philips du salon (scan du 23/11/2026), si HA ne la donne pas : Wake-on-LAN
const TV_MAC = '0C:CA:FB:6E:82:92';

// La télé : le lecteur multimédia du même appareil que la télécommande (Android TV Remote).
// Il peut y avoir d'autres lecteurs (enceinte, Chromecast de la télé…) : ils passent après.
function tvEntities() {
  const remote = entities.find((e) => e.domain === 'remote');
  const players = entities.filter((e) => e.domain === 'media_player');
  const tv = (remote && players.find((p) => p.device && p.device === remote.device))
    || players.find((p) => /t[ée]l[ée]|tv|salon|philips/i.test(`${p.name} ${p.id}`))
    || players[0];
  return { tv, remote };
}

function tvView() {
  const { tv, remote } = tvEntities();
  if (!tv && !remote) {
    return `<h1>Télévision</h1>${noDevicesHTML('Aucune télé connectée.')}`;
  }
  const on = tv ? isOn(tv) : false;
  const vol = tv?.attributes.volume_level;
  return `
    <h1>${esc(tv?.name || 'Télévision')}</h1>
    <div class="remote">
      <div class="card">
        <h3>Alimentation</h3>
        <div class="row">
          <button class="key power" data-action="tv-power" aria-label="Marche / arrêt">${icons.power}</button>
        </div>
        <p class="hint">${on ? 'Allumée' : 'Éteinte'}</p>
      </div>

      <div class="card">
        <h3>Volume${vol != null ? ` · ${Math.round(vol * 100)} %` : ''}</h3>
        <div class="row">
          <button class="key" data-action="tv-vol" data-svc="volume_down" aria-label="Volume moins">${icons.volDown}</button>
          <button class="key" data-action="tv-vol" data-svc="volume_mute" aria-label="Muet">${icons.mute}</button>
          <button class="key" data-action="tv-vol" data-svc="volume_up" aria-label="Volume plus">${icons.volUp}</button>
        </div>
      </div>

      <div class="card">
        <h3>Navigation</h3>
        <div class="dpad">
          <span></span><button class="key" data-action="tv-cmd" data-cmd="DPAD_UP" aria-label="Haut">▲</button><span></span>
          <button class="key" data-action="tv-cmd" data-cmd="DPAD_LEFT" aria-label="Gauche">◀</button>
          <button class="key round" data-action="tv-cmd" data-cmd="DPAD_CENTER">OK</button>
          <button class="key" data-action="tv-cmd" data-cmd="DPAD_RIGHT" aria-label="Droite">▶</button>
          <span></span><button class="key" data-action="tv-cmd" data-cmd="DPAD_DOWN" aria-label="Bas">▼</button><span></span>
          <button class="key" data-action="tv-cmd" data-cmd="BACK" aria-label="Retour">${icons.back}</button>
          <span></span>
          <button class="key" data-action="tv-cmd" data-cmd="HOME" aria-label="Accueil">${icons.home}</button>
        </div>
      </div>

      <div class="card">
        <h3>Applications</h3>
        <div class="apps">
          ${TV_APPS.map(([n, u]) => `<button class="key" data-action="tv-app" data-url="${esc(u)}">${esc(n)}</button>`).join('')}
        </div>
      </div>
    </div>`;
}

let showHaPassword = false;

function localHaHTML() {
  const st = haLocal;
  const line = !st ? 'Lecture de l’état…'
    : st.state === 'ready' ? 'Home Assistant tourne sur cet appareil et FrHiOS y est connecté.'
      : st.message || st.state;
  return `
    <div>
      <p class="hint">${esc(line)}</p>
      ${st?.state === 'ready' ? '<button class="btn primary" data-action="open-setup">Connecter des appareils</button>' : ''}
      ${st?.username ? `
        <p class="hint">Compte Home Assistant (administration) : <b>${esc(st.username)}</b> ·
          mot de passe <b>${showHaPassword ? esc(st.password) : '••••••••'}</b>
          <button class="btn small" data-action="toggle-ha-pw">${showHaPassword ? 'Masquer' : 'Afficher'}</button></p>` : ''}
    </div>`;
}

function settingsView() {
  const m = settings.backend;
  const ha = m === 'ha';
  return `
    <h1>Réglages</h1>
    <div class="form">
      <div>
        <div class="field-label"><span>Source des appareils</span></div>
        <div class="seg">
          ${LOCAL_AVAILABLE ? `<button data-action="set-backend" data-value="auto" class="${m === 'auto' ? 'active' : ''}">Cet appareil</button>` : ''}
          <button data-action="set-backend" data-value="ha" class="${ha ? 'active' : ''}">${LOCAL_AVAILABLE ? 'Autre serveur' : 'Home Assistant'}</button>
          <button data-action="set-backend" data-value="mock" class="${m === 'mock' || (m === 'auto' && !LOCAL_AVAILABLE) ? 'active' : ''}">Démo</button>
        </div>
      </div>

      ${mode() === 'local' ? localHaHTML() : ''}

      ${ha ? `
      <div>
        <div class="field-label"><span>Adresse de Home Assistant</span></div>
        <input class="text-input" id="ha-url" type="text" inputmode="url" autocomplete="off"
               autocapitalize="off" spellcheck="false" value="${esc(settings.haUrl)}"
               placeholder="http://192.168.1.20:8123">
      </div>
      <div>
        <div class="field-label"><span>Jeton d’accès longue durée</span></div>
        <input class="text-input" id="ha-token" type="password" autocomplete="off"
               autocapitalize="off" spellcheck="false" value="${esc(settings.haToken)}"
               placeholder="Profil Home Assistant › Sécurité › Jetons">
        <p class="hint">Le jeton est stocké sur cet appareil uniquement.</p>
      </div>
      <button class="btn primary" data-action="save-settings">Enregistrer et connecter</button>
      ` : mode() === 'mock' ? '<p class="hint">Le mode démo utilise de faux appareils pour tester l’interface.</p>' : ''}

      <div id="wifi-box" class="wifi-box"></div>
      <div id="update-box" class="wifi-box"></div>

      ${window.frhios ? `
      <div class="switch-row">
        <span>Administration de Home Assistant <span class="muted">(automatisations, pièces, intégrations avancées)</span></span>
        <button class="btn" data-action="open-admin">Ouvrir</button>
      </div>

      <div class="switch-row">
        <span>Terminal <span class="muted">(commandes, mises à jour du système…)</span></span>
        <button class="btn" data-action="open-terminal">Ouvrir</button>
      </div>` : ''}

      <div class="switch-row">
        <span>Tout afficher <span class="muted">(chaque réglage des appareils en tuile : LED, arrêt auto…)</span></span>
        <button class="btn" data-action="toggle-show-all">${settings.showAll ? 'Oui' : 'Non'}</button>
      </div>

      <div class="switch-row">
        <span>Masquer le curseur de souris <span class="muted">(écran tactile seul)</span></span>
        <button class="btn" data-action="toggle-cursor">${settings.hideCursor ? 'Oui' : 'Non'}</button>
      </div>
      <div class="switch-row">
        <span>Clavier à l’écran <span class="muted">(Auto = après un contact tactile)</span></span>
        <button class="btn" data-action="cycle-osk">${{ auto: 'Auto', on: 'Toujours', off: 'Jamais' }[settings.osk] || 'Auto'}</button>
      </div>
      ${KIOSK_UI ? '' : `<div class="switch-row">
        <span>Plein écran</span>
        <button class="btn" data-action="fullscreen">Basculer</button>
      </div>`}
    </div>`;
}

const VIEWS = {
  home: homeView, devices: devicesView, tv: tvView, settings: settingsView,
  setup: () => '<div id="setup-box"></div>',
};

/* ============================== Fenêtre de détail ============================== */

const PALETTE = [
  [255, 255, 255], [255, 180, 90], [255, 80, 80], [255, 140, 0],
  [80, 220, 120], [60, 180, 255], [110, 90, 255], [255, 90, 200],
];
const WHITES = [['Chaud', 2700], ['Neutre', 4000], ['Froid', 6000]];

function sheetHTML(e) {
  const on = isOn(e);
  return `
    <div class="sheet" role="dialog" aria-label="${esc(e.name)}">
      <div class="sheet-head">
        <h3>${esc(e.name)}</h3>
        <button class="btn ${on ? '' : 'primary'}" data-action="toggle" data-id="${esc(e.id)}">${on ? 'Éteindre' : 'Allumer'}</button>
      </div>

      ${hasBrightness(e) ? `
        <div class="field-label"><span>Luminosité</span><span id="bright-val">${brightnessPct(e)} %</span></div>
        <input type="range" id="bright" min="1" max="100" value="${brightnessPct(e)}" data-id="${esc(e.id)}">` : ''}

      ${hasColor(e) ? `
        <div class="field-label"><span>Couleur</span></div>
        <div class="swatches">
          ${PALETTE.map((c) => `<button class="swatch" style="--c:rgb(${c})" data-action="light-color" data-id="${esc(e.id)}" data-rgb="${c}" aria-label="Couleur"></button>`).join('')}
        </div>` : ''}

      ${hasTemp(e) ? `
        <div class="field-label"><span>Blanc</span></div>
        <div class="seg">
          ${WHITES.map(([n, k]) => `<button data-action="light-temp" data-id="${esc(e.id)}" data-k="${k}">${n}</button>`).join('')}
        </div>` : ''}

      <div style="margin-top:1.6rem"><button class="btn" data-action="close-sheet" style="width:100%">Fermer</button></div>
    </div>`;
}

let powerOpen = false;              // fenêtre « Éteindre / Redémarrer » ouverte

function powerHTML() {
  return `
    <div class="sheet" role="dialog" aria-label="Alimentation">
      <div class="sheet-head"><h3>Alimentation</h3></div>
      <div class="power-grid">
        <button class="btn primary danger-fill" data-action="power-do" data-what="poweroff">Éteindre l’appareil</button>
        <button class="btn" data-action="power-do" data-what="reboot">Redémarrer</button>
        <button class="btn" data-action="close-sheet">Annuler</button>
      </div>
    </div>`;
}

function renderSheet() {
  const host = $('#sheet');
  if (powerOpen) { host.innerHTML = powerHTML(); host.hidden = false; return; }
  const e = sheetId && byId(sheetId);
  if (!e) { host.hidden = true; host.innerHTML = ''; return; }
  host.innerHTML = sheetHTML(e);
  host.hidden = false;
}

// Les sites web (YouTube, Deezer, administration de Home Assistant) sont des vues/fenêtres NATIVES posées
// par-dessus l'interface : aucune fenêtre de la page ne peut passer devant. Tant qu'une fenêtre de dialogue
// est ouverte, on les masque (elles restent chargées : la musique continue) puis on les remet.
let webSuspended = false;
function suspendWeb() {
  if (shownPersistent && !webSuspended) { pages[shownPersistent]?.onHide(); webSuspended = true; }
}
function resumeWeb() {
  if (webSuspended) { webSuspended = false; if (shownPersistent) pages[shownPersistent]?.onShow(); }
}

function openSheet(id) { suspendWeb(); sheetId = id; renderSheet(); }
function openPower() { suspendWeb(); powerOpen = true; renderSheet(); }
function closeSheet() { sheetId = null; powerOpen = false; renderSheet(); render(); resumeWeb(); }

/* ============================== Rendu ============================== */

let updateAvailable = false;     // une nouvelle version de l'application est disponible
function renderNav() {
  $('#nav').innerHTML = visibleNav().map((n) => n.id === 'spacer'
    ? '<div class="spacer"></div>'
    : `<button data-action="nav" data-view="${n.id}" class="${n.id === view ? 'active' : ''}${n.id === 'settings' && updateAvailable ? ' badge' : ''}"
               ${n.id === view ? 'aria-current="page"' : ''}>${n.icon}<span>${n.label}</span></button>`).join('');
}

function render() {
  const dyn = $('#v-dyn');
  const persistent = PERSISTENT.includes(view) && pages[view] ? view : null;
  PERSISTENT.forEach((id) => { const el = $(`#v-${id}`); if (el) el.hidden = id !== persistent; });
  dyn.hidden = Boolean(persistent);
  if (!persistent) dyn.innerHTML = (VIEWS[view] || homeView)();

  // Prévenir une page persistante uniquement quand elle apparaît ou disparaît
  if (persistent !== shownPersistent) {
    pages[shownPersistent]?.onHide();
    shownPersistent = persistent;
    pages[persistent]?.onShow();
  }
  if (view === 'settings') { mountWifi($('#wifi-box')); mountUpdate($('#update-box'), { toast }); }
  if (view === 'setup') mountSetup($('#setup-box'), { toast });
  tickClock();
}

function setView(v) {
  view = v;
  try { history.replaceState(null, '', `#${v}`); } catch { /* ignoré */ }
  renderNav();
  render();
  $('.view').scrollTop = 0;
}

let rafPending = false;
function scheduleRender() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    entities = backend ? backend.getEntities() : [];
    if (powerOpen) return;
    if (sheetId) { if (!dragging) renderSheet(); return; }
    // Ne pas écraser un champ de saisie ou un curseur en cours d'utilisation
    if (view === 'settings' || view === 'setup' || dragging) return;
    render();
  });
}

function tickClock() {
  const c = $('#clock');
  if (!c) return;
  const now = new Date();
  c.textContent = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const date = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  $('#date').textContent = date.charAt(0).toUpperCase() + date.slice(1);
}

function setStatus(kind, text) {
  const s = $('#status');
  s.className = `status ${kind === 'connecting' ? '' : kind}`;
  $('#status-text').textContent = text;
}

/* ============================== Backend ============================== */

async function startBackend() {
  if (backend) backend.close();
  backend = null;
  backendToken = null;
  entities = [];
  const m = mode();

  if (m === 'local') {
    // HA local pas encore prêt (premier démarrage, conteneur qui démarre…) : on attend son signal
    if (!haLocal) {
      const r = await window.frhios.ha.status();
      haLocal = r?.ok ? r.result : null;
    }
    if (haLocal?.state !== 'ready' || !haLocal.token) {
      setStatus(haLocal?.state === 'foreign' || haLocal?.state === 'error' ? 'err' : 'connecting',
        haLocal?.message || 'Démarrage de Home Assistant…');
      if (view !== 'settings' && view !== 'setup') render();
      return;
    }
  }

  setStatus('connecting', 'Connexion…');
  if (m === 'local') {
    backendToken = haLocal.token;
    backend = new HABackend(haLocal.url, haLocal.token);
  } else {
    backend = m === 'ha' ? new HABackend(settings.haUrl, settings.haToken) : new MockBackend();
  }
  backend.onChange(scheduleRender);
  backend.onStatus(setStatus);
  try {
    await backend.connect();
    entities = backend.getEntities();
  } catch (err) {
    setStatus('err', 'Hors ligne');
    toast(err.message);
  }
  if (view !== 'settings') render();
}

/* ============================== Actions ============================== */

const rgbFrom = (str) => str.split(',').map(Number);

const ACTIONS = {
  nav: (el) => (el.dataset.view === 'power' ? openPower() : setView(el.dataset.view)),

  'power-do': async (el) => {
    const what = el.dataset.what;
    const r = await window.frhios.system.power(what);
    if (r?.ok) {
      toast(what === 'reboot' ? 'Redémarrage…' : 'Extinction…');
      closeSheet();
    } else {
      toast(r?.error || 'Action refusée');
      closeSheet();
    }
  },

  toggle: (el) => {
    const e = byId(el.dataset.id);
    if (e) call(e.domain, 'toggle', e.id);
  },

  more: (el) => {
    const e = byId(el.dataset.id);
    if (!e) return;
    if (e.domain === 'media_player') setView('tv'); else openSheet(e.id);
  },

  'close-sheet': () => closeSheet(),

  'all-off': () => {
    [...lights(), ...switches()].filter(isOn).forEach((e) => call(e.domain, 'turn_off', e.id));
    toast('Lumières et prises éteintes');
  },

  ambiance: () => {
    lights().filter(hasTemp).forEach((e) =>
      call('light', 'turn_on', e.id, { brightness_pct: 30, color_temp_kelvin: 2700 }));
    toast('Ambiance chaude');
  },

  'light-color': (el) => call('light', 'turn_on', el.dataset.id, { rgb_color: rgbFrom(el.dataset.rgb) }),
  'light-temp': (el) => call('light', 'turn_on', el.dataset.id, { color_temp_kelvin: Number(el.dataset.k) }),

  'tv-power': async () => {
    const { tv, remote } = tvEntities();
    const on = (remote && isOn(remote)) || (tv && isOn(tv));
    if (on) {
      if (remote) call('remote', 'turn_off', remote.id); else call('media_player', 'turn_off', tv.id);
      return;
    }
    // Télé éteinte : en veille profonde elle n'écoute plus HA, on la réveille par le réseau
    // (Wake-on-LAN, 3 envois espacés), puis on lui demande de s'allumer quand elle répond.
    const mac = remote?.mac || tv?.mac || TV_MAC;
    if (window.frhios?.net) {
      toast('Allumage de la télé…');
      for (let i = 0; i < 3; i++) {
        window.frhios.net.wake(mac);
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    const target = remote || tv;
    if (target && !isUnavailable(target)) call(target.domain, 'turn_on', target.id);
  },
  'tv-vol': (el) => {
    const { tv } = tvEntities();
    if (!tv) return;
    if (el.dataset.svc === 'volume_mute') {
      call('media_player', 'volume_mute', tv.id, { is_volume_muted: !tv.attributes.is_volume_muted });
    } else call('media_player', el.dataset.svc, tv.id);
  },
  'tv-cmd': (el) => {
    const r = entities.find((e) => e.domain === 'remote');
    if (r) call('remote', 'send_command', r.id, { command: el.dataset.cmd });
    else toast('Entité « remote » introuvable pour la télé');
  },
  'tv-app': (el) => {
    const r = entities.find((e) => e.domain === 'remote');
    if (r) call('remote', 'turn_on', r.id, { activity: el.dataset.url });
    else toast('Entité « remote » introuvable pour la télé');
  },

  'set-backend': (el) => {
    settings.backend = el.dataset.value;
    persist();
    if (settings.backend !== 'ha') startBackend();   // 'ha' : on attend l'adresse et le jeton
    render();
  },
  'open-setup': () => setView('setup'),
  'toggle-ha-pw': () => { showHaPassword = !showHaPassword; render(); },
  'toggle-show-all': () => { settings.showAll = !settings.showAll; persist(); render(); },
  'save-settings': () => {
    settings.haUrl = $('#ha-url').value.trim();
    settings.haToken = $('#ha-token').value.trim();
    persist();
    startBackend();
  },
  'toggle-cursor': () => {
    settings.hideCursor = !settings.hideCursor;
    persist();
    applyCursor();
    render();
  },
  'open-admin': () => setView('admin'),
  'open-terminal': () => setView('terminal'),
  'cycle-osk': () => {
    settings.osk = { auto: 'on', on: 'off', off: 'auto' }[settings.osk] || 'auto';
    persist();
    render();
  },
  fullscreen: () => toggleFullscreen(),
};

function applyCursor() {
  document.body.classList.toggle('hide-cursor', !!settings.hideCursor);
}

function toggleFullscreen() {
  if (KIOSK_UI) return;
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => toast('Plein écran refusé'));
}

/* ============================== Initialisation ============================== */

function bind() {
  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-action]');
    if (el) { ACTIONS[el.dataset.action]?.(el); return; }
    // clic sur le fond de la fenêtre de détail = fermer
    if (ev.target.id === 'sheet') closeSheet();
  });

  // Curseurs de la fenêtre de détail : on envoie la valeur au fil de l'eau (avec une petite pause)
  let sliderTimer = null;
  document.addEventListener('input', (ev) => {
    if (ev.target.id !== 'bright') return;
    const v = Number(ev.target.value);
    $('#bright-val').textContent = `${v} %`;
    clearTimeout(sliderTimer);
    sliderTimer = setTimeout(() => call('light', 'turn_on', ev.target.dataset.id, { brightness_pct: v }), 120);
  });

  document.addEventListener('pointerdown', (ev) => { if (ev.target.type === 'range') dragging = true; });
  const release = () => { if (dragging) { dragging = false; scheduleRender(); } };
  document.addEventListener('pointerup', release);
  document.addEventListener('pointercancel', release);

  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && (sheetId || powerOpen)) closeSheet(); });

  $('#btn-fullscreen').addEventListener('click', toggleFullscreen);
}

function init() {
  $('#btn-fullscreen').innerHTML = icons.fullscreen;
  $('#btn-fullscreen').hidden = KIOSK_UI;
  $('.view').innerHTML = '<div id="v-dyn"></div><div id="v-music" hidden></div><div id="v-admin" hidden></div><div id="v-terminal" hidden></div>';
  // Dans Electron : vrais sites YouTube/Deezer. Dans un navigateur : lecteurs intégrés via des liens.
  $('#brand-mark').innerHTML = icons.flower;
  const osk = createOsk({ root: $('#osk'), getSettings: () => settings, bridge: window.frhios?.osk });
  if (window.frhios?.music) {
    pages.music = createElectronMusicPage($('#v-music'), settings, persist, icons, osk);
    pages.admin = createElectronMusicPage($('#v-admin'), settings, persist, icons, osk,
      { services: ADMIN_SERVICES, tabKey: 'adminTab' });
    if (window.frhios.terminal) pages.terminal = createTerminalPage($('#v-terminal'), icons, osk);
  } else {
    pages.music = createMusicPage($('#v-music'), settings, persist);
  }

  const params = new URLSearchParams(location.search);
  if (params.has('kiosk')) { settings.hideCursor = true; }
  if (params.has('lite')) document.documentElement.classList.add('lite');
  applyCursor();

  const fromHash = location.hash.slice(1);
  if (NAV.some((n) => n.id === fromHash)) view = fromHash;

  // Home Assistant local : quand il devient prêt (ou change de jeton), on (re)connecte l'interface
  onHaStatus((st) => {
    const was = haLocal;
    haLocal = st;
    if (mode() !== 'local') return;
    if (st.state === 'ready' && st.token && st.token !== backendToken) startBackend();
    else if (st.state !== 'ready') {
      setStatus(st.state === 'foreign' || st.state === 'error' ? 'err' : 'connecting', st.message);
      if (!backend && view !== 'settings' && view !== 'setup') render();
    }
    if (view === 'settings' && was?.state !== st.state) render();
  });

  bind();
  renderNav();
  render();
  setInterval(tickClock, 1000);
  startBackend();

  // Mises à jour : pastille sur « Réglages » quand une version est disponible
  window.frhios?.update?.onState?.((st) => {
    const was = updateAvailable;
    updateAvailable = st?.state === 'available';
    if (updateAvailable !== was) renderNav();
    if (updateAvailable && !was) toast('Mise à jour disponible (Réglages)');
  });
  // Signale à l'appareil que l'interface a bien démarré (sinon retour automatique à la version précédente)
  window.frhios?.app?.ready?.();
}

init();
