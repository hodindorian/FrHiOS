// Page d'installation affichée par l'ISO (Electron lancé avec --installer).
// Étapes : accueil → choix du disque → confirmation → installation → terminé / erreur.
// Hors Electron (navigateur), un faux installateur permet de prévisualiser les écrans.

import { icons } from './icons.js';

const root = document.getElementById('installer');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- Faux installateur pour l'aperçu dans un navigateur ---------- */
const demoApi = {
  disks: async () => [
    { path: '/dev/nvme0n1', sizeBytes: 256e9, model: 'Samsung SSD 970', kind: 'NVMe' },
    { path: '/dev/sda', sizeBytes: 120e9, model: 'Kingston SA400', kind: 'SATA' },
  ],
  start() {
    const steps = [[5, 'Partitionnement du disque'], [20, 'Formatage'], [60, 'Copie du système'],
      [85, 'Configuration du démarrage'], [100, 'Terminé']];
    steps.forEach(([p, m], i) => setTimeout(() => onLog(`@@PROGRESS ${p} ${m}`), 700 * (i + 1)));
    setTimeout(() => onDone({ code: 0 }), 700 * steps.length + 300);
  },
  reboot() {},
  onLog: () => {},
  onDone: () => {},
};
const api = window.frhios?.installer || demoApi;
const isDemo = !window.frhios?.installer;

/* ---------- État ---------- */
let step = 'welcome';       // welcome | disks | confirm | installing | done | error
let disks = [];
let chosen = null;
let percent = 0;
let phase = 'Préparation…';
let logTail = [];

const gb = (b) => `${Math.round(b / 1e9)} Go`;

function setStep(s) { step = s; draw(); }

function view() {
  switch (step) {
    case 'welcome': return `
      <div class="inst-head">${icons.flower}<h1>FrHiOS</h1></div>
      <p class="inst-lead">Bienvenue. Cet assistant installe FrHiOS sur le disque de cet appareil.
        Il démarrera ensuite tout seul sur votre tableau de bord tactile.</p>
      <p class="hint">Tout est inclus, aucune connexion internet n’est nécessaire pour installer. Branchez
        quand même le câble réseau si vous en avez un : FrHiOS doit être sur le même réseau que la télé
        et les prises pour les piloter.</p>
      <button class="btn primary inst-big" data-go="disks">Commencer</button>`;

    case 'disks': return `
      <h1>Sur quel disque installer ?</h1>
      ${disks.length ? `<div class="inst-disks">${disks.map((d, i) => `
          <button class="inst-disk" data-disk="${i}">
            <span class="inst-disk-icon">${icons.grid}</span>
            <span><b>${esc(d.model)}</b><br><span class="muted">${esc(d.kind)} · ${gb(d.sizeBytes)} · ${esc(d.path)}</span></span>
          </button>`).join('')}</div>`
        : '<div class="empty">Aucun disque interne trouvé.<br>La clé USB de démarrage n’est jamais proposée.</div>'}
      <div class="inst-actions">
        <button class="btn" data-go="disks-refresh">Actualiser</button>
        <button class="btn" data-go="welcome">Retour</button>
      </div>`;

    case 'confirm': return `
      <h1>Tout effacer ?</h1>
      <div class="inst-warn">
        <p>Le disque <b>${esc(chosen.model)}</b> (${gb(chosen.sizeBytes)}, ${esc(chosen.path)})
          va être <b>entièrement effacé</b> : Windows, fichiers, tout ce qu'il contient disparaîtra.</p>
        <p>Cette action est définitive.</p>
      </div>
      <div class="inst-actions">
        <button class="btn" data-go="disks">Annuler</button>
        <button class="btn primary danger-fill" data-go="install">Effacer et installer</button>
      </div>`;

    case 'installing': return `
      <h1>Installation en cours…</h1>
      <p class="inst-lead">${esc(phase)}</p>
      <div class="inst-bar"><div class="inst-bar-fill" style="width:${percent}%"></div></div>
      <p class="hint">${percent} % — ne coupez pas l'alimentation.</p>
      <pre class="inst-log">${esc(logTail.join('\n'))}</pre>`;

    case 'done': return `
      <div class="inst-head">${icons.flower}<h1>Installation terminée</h1></div>
      <p class="inst-lead">Retirez la clé USB, puis redémarrez. FrHiOS se lancera tout seul.</p>
      <button class="btn primary inst-big" data-go="reboot">Redémarrer</button>`;

    case 'error': return `
      <h1>L'installation a échoué</h1>
      <p class="hint">Dernières lignes du journal :</p>
      <pre class="inst-log">${esc(logTail.join('\n'))}</pre>
      <div class="inst-actions">
        <button class="btn" data-go="disks">Recommencer</button>
        <button class="btn" data-go="reboot">Redémarrer</button>
      </div>`;
  }
  return '';
}

function draw() {
  root.innerHTML = `<div class="inst-card">${view()}</div>`;
}

async function loadDisks() {
  disks = await api.disks();
  draw();
}

function onLog(line) {
  const m = /^@@PROGRESS (\d{1,3}) (.*)$/.exec(line);
  if (m) {
    percent = Math.min(100, Number(m[1]));
    phase = m[2];
  } else if (line.trim()) {
    logTail.push(line.trim().slice(0, 160));
    if (logTail.length > 8) logTail.shift();
  }
  if (step === 'installing') draw();
}

function onDone({ code }) {
  setStep(code === 0 ? 'done' : 'error');
}

root.addEventListener('click', (ev) => {
  const go = ev.target.closest('[data-go]')?.dataset.go;
  const disk = ev.target.closest('[data-disk]')?.dataset.disk;

  if (disk !== undefined) { chosen = disks[Number(disk)]; setStep('confirm'); return; }

  switch (go) {
    case 'welcome': setStep('welcome'); break;
    case 'disks': setStep('disks'); loadDisks(); break;
    case 'disks-refresh': loadDisks(); break;
    case 'install':
      percent = 0; phase = 'Préparation…'; logTail = [];
      setStep('installing');
      api.start(chosen.path);
      break;
    case 'reboot': api.reboot(); break;
  }
});

if (isDemo) {
  // L'aperçu navigateur reçoit les événements du faux installateur directement
  window.__demo = { onLog, onDone };
}
api.onLog(onLog);
api.onDone(onDone);
draw();
