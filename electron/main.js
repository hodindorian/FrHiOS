'use strict';
// Processus principal d'Electron.
//  - sert le dossier app/ en local (http://127.0.0.1:PORT) : les modules ES ne se chargent pas depuis file://
//  - ouvre la fenêtre (plein écran avec --kiosk)
//  - héberge YouTube et Deezer dans de vrais navigateurs embarqués (WebContentsView),
//    superposés à la zone « Musique » de l'interface, avec une session persistante chacun.

const { app, BrowserWindow, WebContentsView, Menu, ipcMain, session, clipboard } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { YoutubeWindow } = require('./youtube-window');
const { Updater } = require('./updater');
const { LocalHA, HA_URL } = require('./ha-local');

const APP_DIR = path.join(__dirname, '..', 'app');
const ASSETS_DIR = path.join(__dirname, '..', 'assets'); // servi sous /assets/ (fond d'écran…)
const INSTALLER = process.argv.includes('--installer'); // ISO d'installation : affiche l'installateur
const KIOSK = process.argv.includes('--kiosk') || INSTALLER;
// Sous sway (l'appareil), YouTube est un vrai Chromium flottant au-dessus de l'interface
const SWAY = YoutubeWindow.available();
const yt = SWAY ? new YoutubeWindow() : null;
const PREFERRED_PORT = 38765; // port fixe : le localStorage (réglages, favoris) est lié à l'origine

// Wayland si disponible, sinon X11
app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
// Sites en français (en-tête Accept-Language), même si la langue du système n'est pas configurée
app.commandLine.appendSwitch('lang', 'fr');

if (!app.requestSingleInstanceLock()) app.quit();

/* ------------------------- Serveur statique local ------------------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

function handleStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  let rel;
  try {
    rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch { res.writeHead(400).end(); return; }
  if (rel.endsWith('/')) rel += 'index.html';

  // /assets/... vient du dossier assets/, tout le reste du dossier app/
  let base = APP_DIR;
  if (rel.startsWith('/assets/')) { base = ASSETS_DIR; rel = rel.slice('/assets'.length); }

  const file = path.normalize(path.join(base, rel));
  // Interdire toute sortie du dossier servi (../)
  if (!file.startsWith(base + path.sep)) { res.writeHead(403).end(); return; }

  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('Introuvable'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handleStatic);
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE' && server.__port !== 0) {
        server.__port = 0; // port pris : on prend un port libre (les réglages seront alors à ressaisir)
        server.listen(0, '127.0.0.1');
      } else reject(err);
    });
    server.once('listening', () => resolve(server.address().port));
    server.__port = PREFERRED_PORT;
    server.listen(PREFERRED_PORT, '127.0.0.1');
  });
}

/* ------------------------- Vues web : YouTube / Deezer ------------------------- */

const SERVICES = {
  youtube: { partition: 'persist:youtube', home: 'https://www.youtube.com/' },
  deezer: { partition: 'persist:deezer', home: 'https://www.deezer.com/fr/' },
  // Interface d'administration de Home Assistant (conteneur local) : création du compte,
  // ajout des intégrations (Tapo, télé…), création du jeton d'accès.
  ha: { partition: 'persist:ha', home: 'http://127.0.0.1:8123/' },
};

let win = null;
let origin = '';
const views = new Map();   // service -> WebContentsView
let active = null;         // service actuellement affiché

// User-agent « Chrome » sans le marqueur Electron : certains sites (connexion Google notamment)
// refusent les navigateurs embarqués qui se présentent comme tels.
let chromeUA = '';

const isHttp = (url) => /^https?:\/\//i.test(url);

function createView(service) {
  const cfg = SERVICES[service];
  const ses = session.fromPartition(cfg.partition);
  // Aucune permission (caméra, micro, notifications, géolocalisation…), sauf le plein écran
  // et l'écriture dans le presse-papiers (bouton « Copier » du jeton Home Assistant).
  const OK = new Set(['fullscreen', 'clipboard-sanitized-write']);
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(OK.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => OK.has(permission));

  const view = new WebContentsView({
    webPreferences: {
      partition: cfg.partition,
      // Ce script n'expose RIEN à la page : il surveille seulement les champs de texte
      // (pour le clavier à l'écran) et le dit au processus principal.
      preload: path.join(__dirname, 'view-preload.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // la musique doit continuer quand la vue est masquée
    },
  });
  const wc = view.webContents;
  wc.setUserAgent(chromeUA);

  // Les liens « nouvelle fenêtre » s'ouvrent dans la même vue ; rien d'autre que http(s)
  wc.setWindowOpenHandler(({ url }) => {
    if (isHttp(url)) wc.loadURL(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (ev, url) => { if (!isHttp(url)) ev.preventDefault(); });
  // Nouvelle page : l'ancien champ de texte n'existe plus, on ferme le clavier
  wc.on('did-navigate', () => win?.webContents.send('osk:focus', { editable: false, touch: false }));

  view.setVisible(false);
  win.contentView.addChildView(view);
  if (service === 'ha') loadHaAdmin(wc); else wc.loadURL(cfg.home);
  views.set(service, view);
  return view;
}

// Administration de HA : on lui donne les jetons du compte créé par FrHiOS (localStorage « hassTokens »
// de l'origine http://127.0.0.1:8123), elle s'ouvre donc déjà connectée. Sans jetons (HA configuré
// à la main, ou pas encore prêt), page de connexion habituelle.
async function loadHaAdmin(wc) {
  const home = SERVICES.ha.home;
  const tokens = localHA ? await localHA.adminTokens() : null;
  if (!tokens) { wc.loadURL(home); return; }
  try {
    await wc.loadURL(`${HA_URL}/manifest.json`); // n'importe quelle page de la bonne origine
    await wc.executeJavaScript(
      `if (!localStorage.getItem('hassTokens')) localStorage.setItem('hassTokens', ${JSON.stringify(JSON.stringify(tokens))}); true`);
  } catch { /* HA pas joignable : la page d'accueil affichera l'erreur */ }
  wc.loadURL(home);
}

const clampRect = (r) => {
  const n = (v) => (Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);
  return { x: n(r?.x), y: n(r?.y), width: n(r?.width), height: n(r?.height) };
};

function fromMainWindow(event) {
  return win && event.sender === win.webContents;
}

ipcMain.on('music:show', (event, service, rect) => {
  if (!fromMainWindow(event) || !SERVICES[service]) return;
  if (yt && service === 'youtube') {
    views.forEach((v) => v.setVisible(false));
    active = 'youtube';
    yt.show(clampRect(rect));
    return;
  }
  yt?.hide();
  for (const [name, v] of views) if (name !== service) v.setVisible(false);
  const view = views.get(service) || createView(service);
  view.setBounds(clampRect(rect));
  view.setVisible(true);
  active = service;
});

ipcMain.on('music:bounds', (event, rect) => {
  if (!fromMainWindow(event) || !active) return;
  if (yt && active === 'youtube') { yt.setBounds(clampRect(rect)); return; }
  views.get(active)?.setBounds(clampRect(rect));
});

ipcMain.on('music:hide', (event) => {
  if (!fromMainWindow(event)) return;
  views.forEach((v) => v.setVisible(false)); // la page reste chargée : le son continue
  yt?.hide();
  active = null;
  win.webContents.focus();
});

ipcMain.on('music:action', (event, service, action) => {
  if (!fromMainWindow(event) || !SERVICES[service]) return;
  if (yt && service === 'youtube') { yt.action(action); return; }
  const wc = views.get(service)?.webContents;
  if (!wc) return;
  if (action === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  else if (action === 'reload') wc.reload();
  else if (action === 'home') wc.loadURL(SERVICES[service].home);
});

/* ------------------------- Clavier à l'écran ------------------------- */

// Un champ de texte prend/perd le focus dans YouTube ou Deezer -> prévenir l'interface
ipcMain.on('osk:page-focus', (event, payload) => {
  const service = [...views].find(([, v]) => v.webContents === event.sender)?.[0];
  if (!service || service !== active || !win) return; // seule la vue affichée compte
  win.webContents.send('osk:focus', { editable: payload?.editable === true, touch: payload?.touch === true });
});

const KEYS = new Set(['Backspace', 'Enter']);

function pressKey(wc, name) {
  wc.sendInputEvent({ type: 'keyDown', keyCode: name });
  if (name === 'Enter') wc.sendInputEvent({ type: 'char', keyCode: '\r' });
  wc.sendInputEvent({ type: 'keyUp', keyCode: name });
}

// Touche tapée sur le clavier de l'interface -> injectée dans la page affichée
ipcMain.on('osk:key', (event, key) => {
  if (!fromMainWindow(event) || !active || !key) return;

  // YouTube dans un vrai Chromium : on envoie les touches à sa fenêtre (wtype)
  if (yt && active === 'youtube') {
    if (key.type === 'text' && typeof key.value === 'string' && key.value.length > 0 && key.value.length <= 2000) {
      yt.type(key.value);
    } else if (key.type === 'key' && key.value === 'Backspace') {
      yt.key('BackSpace');
    } else if (key.type === 'key' && key.value === 'Enter') {
      yt.key('Return');
    } else if (key.type === 'blur') {
      yt.key('Escape');
    }
    return;
  }

  const wc = views.get(active)?.webContents;
  if (!wc) return;

  // Taper sur le clavier a donné le focus à l'interface : on le rend au site avant d'écrire
  wc.focus();

  if (key.type === 'text' && typeof key.value === 'string' && key.value.length > 0 && key.value.length <= 2000) {
    wc.insertText(key.value);
  } else if (key.type === 'key' && KEYS.has(key.value)) {
    pressKey(wc, key.value);
  } else if (key.type === 'blur') {
    wc.send('osk:blur');
  }
});

/* ------------------------- Système : alimentation, presse-papiers, Wi-Fi ------------------------- */

// Éteindre / redémarrer l'appareil. Refusé hors mode kiosque : en développement (`npm start`)
// ce bouton éteindrait votre PC de travail.
ipcMain.handle('system:power', (event, action) => {
  if (!fromMainWindow(event)) return { ok: false, error: 'Refusé' };
  if (!KIOSK) return { ok: false, error: 'Désactivé hors mode kiosque (cela éteindrait votre PC)' };
  if (action !== 'poweroff' && action !== 'reboot') return { ok: false, error: 'Action inconnue' };
  const child = spawn('systemctl', [action], { stdio: 'ignore', detached: true });
  child.unref();
  return { ok: true };
});


const run = (cmd, args, opts = {}) => new Promise((resolve) => {
  execFile(cmd, args, { timeout: 30000, maxBuffer: 4 * 1024 * 1024, ...opts }, (error, stdout, stderr) => {
    resolve({ ok: !error, stdout: String(stdout || ''), stderr: String(stderr || '') });
  });
});

// Coller (touche « Coller » du clavier à l'écran) : lecture du presse-papiers par le processus principal
ipcMain.handle('clipboard:read', (event) => (fromMainWindow(event) ? clipboard.readText().slice(0, 4000) : ''));

// nmcli en mode « terse » sépare les champs par « : » et échappe les « : » du contenu en « \: »
const splitTerse = (line) => line.split(/(?<!\\):/).map((s) => s.replace(/\\:/g, ':').replace(/\\\\/g, '\\'));

ipcMain.handle('wifi:status', async (event) => {
  if (!fromMainWindow(event)) return { available: false };
  const dev = await run('nmcli', ['-t', '-f', 'TYPE,STATE,CONNECTION', 'device']);
  if (!dev.ok) return { available: false };
  const rows = dev.stdout.split('\n').filter(Boolean).map(splitTerse);
  const wifi = rows.find((r) => r[0] === 'wifi');
  const eth = rows.find((r) => r[0] === 'ethernet' && r[1] === 'connected');
  return {
    available: true,
    hasWifi: Boolean(wifi),
    wifiConnected: wifi?.[1] === 'connected',
    ssid: wifi?.[1] === 'connected' ? wifi[2] : null,
    ethernet: Boolean(eth),
  };
});

ipcMain.handle('wifi:scan', async (event) => {
  if (!fromMainWindow(event)) return [];
  const r = await run('nmcli', ['-t', '-f', 'IN-USE,SSID,SIGNAL,SECURITY', 'device', 'wifi', 'list', '--rescan', 'yes']);
  if (!r.ok) return [];
  const best = new Map();
  for (const line of r.stdout.split('\n').filter(Boolean)) {
    const [inUse, ssid, signal, security] = splitTerse(line);
    if (!ssid) continue;
    const entry = { ssid, signal: Number(signal) || 0, secure: Boolean(security) && security !== '--', inUse: inUse === '*' };
    const prev = best.get(ssid);
    if (!prev || entry.signal > prev.signal) best.set(ssid, entry);
  }
  return [...best.values()].sort((a, b) => b.signal - a.signal);
});

ipcMain.handle('wifi:connect', (event, ssid, password) => new Promise((resolve) => {
  if (!fromMainWindow(event)) return resolve({ ok: false, error: 'Refusé' });
  const validSsid = typeof ssid === 'string' && ssid.length > 0 && Buffer.byteLength(ssid) <= 32
    && !/[\u0000-\u001f]/.test(ssid) && !ssid.startsWith('-');
  const validPw = password == null || (typeof password === 'string' && password.length <= 63);
  if (!validSsid || !validPw) return resolve({ ok: false, error: 'Nom de réseau ou mot de passe invalide' });

  // Le mot de passe passe par l'entrée standard (--ask), jamais par la ligne de commande
  const args = password ? ['--ask', 'device', 'wifi', 'connect', ssid] : ['device', 'wifi', 'connect', ssid];
  const child = spawn('nmcli', args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 45000);
  child.on('error', () => { clearTimeout(timer); resolve({ ok: false, error: 'NetworkManager indisponible' }); });
  child.on('close', (code) => {
    clearTimeout(timer);
    resolve(code === 0 ? { ok: true } : { ok: false, error: out.trim().split('\n').pop() || 'Échec de la connexion' });
  });
  if (password) child.stdin.write(`${password}\n`);
  child.stdin.end();
}));

/* ------------------------- Wake-on-LAN (allumer la télé en veille) ------------------------- */

// Une télé en veille profonde coupe son réseau : HA ne peut plus lui parler. On envoie un « paquet
// magique » (6 × FF puis 16 × l'adresse MAC) en diffusion UDP, que sa carte réseau écoute même en veille.
const MAC_RE = /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i;

function broadcastAddresses() {
  const out = new Set(['255.255.255.255']);
  for (const addrs of Object.values(require('node:os').networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal || !a.netmask) continue;
      const ip = a.address.split('.').map(Number);
      const mask = a.netmask.split('.').map(Number);
      out.add(ip.map((b, i) => (b | (~mask[i] & 255))).join('.'));
    }
  }
  return [...out];
}

ipcMain.handle('net:wake', (event, mac) => new Promise((resolve) => {
  if (!fromMainWindow(event) || typeof mac !== 'string' || !MAC_RE.test(mac)) return resolve({ ok: false, error: 'Adresse MAC invalide' });
  const macBytes = Buffer.from(mac.replace(/[:-]/g, ''), 'hex');
  const packet = Buffer.concat([Buffer.alloc(6, 0xff), ...Array(16).fill(macBytes)]);
  const sock = require('node:dgram').createSocket('udp4');
  sock.once('error', () => { sock.close(); resolve({ ok: false, error: 'Envoi impossible' }); });
  sock.bind(() => {
    sock.setBroadcast(true);
    const sends = [];
    for (const addr of broadcastAddresses()) {
      for (const port of [9, 7]) sends.push(new Promise((r) => sock.send(packet, port, addr, () => r())));
    }
    Promise.all(sends).then(() => { sock.close(); resolve({ ok: true }); });
  });
}));

/* ------------------------- Home Assistant local ------------------------- */

// Pas sur l'ISO d'installation : Home Assistant ne tourne que sur le système installé
let localHA = null;

function startLocalHA() {
  if (INSTALLER) return;
  localHA = new LocalHA(path.join(app.getPath('userData'), 'home-assistant.json'));
  localHA.on('status', (st) => win?.webContents.send('ha:status', st));
  localHA.start();
}

// Chaque appel renvoie { ok: true, result } ou { ok: false, error } (jamais d'exception vers l'interface)
function haHandle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!fromMainWindow(event)) return { ok: false, error: 'Refusé' };
    if (!localHA) return { ok: false, error: 'Home Assistant local indisponible' };
    try { return { ok: true, result: await fn(...args) }; } catch (err) { return { ok: false, error: err.message || String(err) }; }
  });
}

haHandle('ha:status', () => localHA.publicStatus());
haHandle('ha:overview', () => localHA.overview());
haHandle('ha:flow-start', (handler) => localHA.startFlow(handler));
haHandle('ha:flow-step', (flowId, data) => localHA.flowStep(flowId, data));
haHandle('ha:flow-get', (flowId) => localHA.getFlow(flowId));
haHandle('ha:flow-abort', (flowId) => localHA.abortFlow(flowId));
haHandle('ha:entry-delete', (entryId) => localHA.deleteEntry(entryId));
haHandle('ha:translations', (domains) => localHA.translations(domains));
haHandle('ha:matter-commission', (opts) => localHA.matterCommission(opts));

/* ------------------------- Terminal intégré ------------------------- */

// Le shell tourne dans un vrai pseudo-terminal (couleurs, vim, htop, sudo…) obtenu avec `script`
// (util-linux) : pas de module natif à compiler. Un seul shell, qui reste vivant quand on change
// de page ; l'affichage (xterm.js) est dans l'interface.
let term = null; // { child, tty: '/dev/pts/N' | null }

const clampInt = (v, min, max, dflt) => (Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : dflt);

function termStart(cols, rows) {
  if (term) return true;
  const c = clampInt(cols, 20, 400, 80);
  const r = clampInt(rows, 5, 200, 24);
  // 1) affiche le nom du pts (pour redimensionner plus tard) 2) fixe la taille 3) lance zsh (sinon bash)
  const inner = `echo "@@TTY $(tty)"; stty rows ${r} cols ${c}; if command -v zsh >/dev/null 2>&1; then exec zsh -l; else exec bash -l; fi`;
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn('script', ['-qfec', inner, '/dev/null'], { env, cwd: require('node:os').homedir(), stdio: ['pipe', 'pipe', 'pipe'] });
  const { StringDecoder } = require('node:string_decoder');
  const decoder = new StringDecoder('utf8');
  const state = { child, tty: null };
  let header = '';
  let headerDone = false;

  const forward = (text) => { if (text) win?.webContents.send('term:data', text); };
  const onData = (chunk) => {
    const text = decoder.write(chunk);
    if (headerDone) { forward(text); return; }
    header += text;
    const nl = header.indexOf('\n');
    if (nl === -1) return;
    const m = /@@TTY (\/dev\/pts\/\d+)/.exec(header.slice(0, nl));
    if (m) state.tty = m[1];
    headerDone = true;
    forward(header.slice(nl + 1));
    header = '';
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('error', () => { term = null; win?.webContents.send('term:exit', { code: 127 }); });
  child.on('close', (code) => { if (term === state) term = null; win?.webContents.send('term:exit', { code: code ?? 0 }); });
  term = state;
  return true;
}

ipcMain.handle('term:start', (event, cols, rows) => (fromMainWindow(event) ? termStart(cols, rows) : false));

ipcMain.on('term:input', (event, data) => {
  if (!fromMainWindow(event) || !term || typeof data !== 'string' || data.length > 8192) return;
  term.child.stdin.write(data);
});

ipcMain.on('term:resize', (event, cols, rows) => {
  if (!fromMainWindow(event) || !term?.tty) return;
  const c = clampInt(cols, 20, 400, 80);
  const r = clampInt(rows, 5, 200, 24);
  // Fixer la taille du pseudo-terminal prévient automatiquement les programmes (SIGWINCH)
  execFile('stty', ['-F', term.tty, 'rows', String(r), 'cols', String(c)], () => {});
});

ipcMain.on('term:kill', (event) => {
  if (fromMainWindow(event) && term) term.child.kill('SIGHUP');
});

/* ------------------------- Mises à jour de l'application ------------------------- */

const updater = new Updater(app.getAppPath());

ipcMain.handle('update:status', (event) => (fromMainWindow(event) ? updater.status() : null));

ipcMain.handle('update:check', async (event) => {
  if (!fromMainWindow(event)) return null;
  const st = await updater.check();
  win?.webContents.send('update:state', st);
  return st;
});

ipcMain.handle('update:apply', async (event) => {
  if (!fromMainWindow(event)) return { ok: false, error: 'Refusé' };
  const r = await updater.apply((text) => win?.webContents.send('update:progress', text));
  // On quitte : frhios-app relance toute la session, qui démarre alors sur la nouvelle version
  if (r.ok) setTimeout(() => app.quit(), 2500);
  return r;
});

// Signal « l'interface a bien démarré » : lu par frhios-app (retour arrière automatique sinon)
ipcMain.on('app:ready', (event) => {
  const file = process.env.FRHIOS_HEALTH;
  if (!fromMainWindow(event) || !file) return;
  try { fs.writeFileSync(file, `${Date.now()}\n`); } catch { /* dossier inaccessible : sans importance */ }
});

/* ------------------------- Installateur (ISO) ------------------------- */

const DISK_RE = /^\/dev\/(sd[a-z]+|vd[a-z]+|nvme\d+n\d+|mmcblk\d+)$/;
let listedDisks = new Set();
let installing = false;

ipcMain.handle('installer:disks', async (event) => {
  if (!INSTALLER || !fromMainWindow(event)) return [];
  const r = await run('lsblk', ['-J', '-b', '-d', '-o', 'PATH,SIZE,MODEL,TRAN,RM,RO,TYPE']);
  if (!r.ok) return [];
  let devices = [];
  try { devices = JSON.parse(r.stdout).blockdevices || []; } catch { return []; }
  // Disques internes uniquement : ni clé USB (celle de démarrage), ni lecture seule, ni CD
  const disks = devices.filter((d) => d.type === 'disk' && DISK_RE.test(d.path) && !d.ro && d.tran !== 'usb');
  listedDisks = new Set(disks.map((d) => d.path));
  return disks.map((d) => ({
    path: d.path,
    sizeBytes: Number(d.size) || 0,
    model: (d.model || '').trim() || 'Disque',
    kind: d.path.includes('nvme') ? 'NVMe' : d.path.includes('mmcblk') ? 'eMMC' : (d.tran || 'disque').toUpperCase(),
  }));
});

ipcMain.on('installer:start', (event, disk) => {
  if (!INSTALLER || !fromMainWindow(event) || installing) return;
  const send = (ch, payload) => win?.webContents.send(ch, payload);
  if (typeof disk !== 'string' || !listedDisks.has(disk)) { send('installer:done', { code: 2 }); return; }

  installing = true;
  // Le script est le seul programme que l'utilisateur du kiosque peut lancer en root (sudoers)
  const child = spawn('sudo', ['-n', '/usr/local/bin/frhios-install', disk], { stdio: ['ignore', 'pipe', 'pipe'] });
  let buf = '';
  const onData = (d) => {
    buf += d;
    const lines = buf.split('\n');
    buf = lines.pop();
    lines.forEach((l) => send('installer:log', l));
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('error', () => { installing = false; send('installer:done', { code: 127 }); });
  child.on('close', (code) => {
    if (buf) send('installer:log', buf);
    installing = false;
    send('installer:done', { code: code ?? 1 });
  });
});

ipcMain.on('installer:reboot', (event) => {
  if (INSTALLER && fromMainWindow(event) && !installing) spawn('systemctl', ['reboot'], { stdio: 'ignore' });
});

/* ------------------------- Fenêtre ------------------------- */

async function createWindow() {
  const port = await startServer();
  origin = `http://127.0.0.1:${port}`;

  win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#0d1015',
    // Fenêtre affichée tout de suite : sous Wayland/sway, une fenêtre créée « cachée » n'est jamais
    // affichée (l'événement `ready-to-show` ne se déclenche pas) et l'écran reste noir.
    // backgroundColor évite un flash blanc le temps du chargement.
    show: true,
    // Sous sway la fenêtre unique remplit déjà l'écran ; le plein écran masquerait la fenêtre YouTube flottante
    fullscreenable: !KIOSK, // sur l'appareil, la fenêtre remplit déjà l'écran : jamais de mode plein écran
    fullscreen: KIOSK && !SWAY,
    kiosk: KIOSK && !SWAY,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  chromeUA = win.webContents.userAgent
    .replace(/\sElectron\/\S+/i, '')
    .replace(new RegExp(`\\s${app.getName()}/\\S+`, 'i'), '');

  // L'interface ne doit jamais quitter son origine ni ouvrir de fenêtres
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (ev, url) => { if (!url.startsWith(origin)) ev.preventDefault(); });

  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; });
  // Rendu logiciel (--disable-gpu : machine virtuelle ou carte sans 3D) : l'interface désactive les effets
  // coûteux (flou d'arrière-plan, animations du décor) pour rester fluide.
  const lite = app.commandLine.hasSwitch('disable-gpu');
  const query = [KIOSK && 'kiosk', lite && 'lite'].filter(Boolean).join('&');
  await win.loadURL(INSTALLER ? `${origin}/installer.html${lite ? '?lite' : ''}` : `${origin}/${query ? `?${query}` : ''}`);

  // Sur l'appareil : recherche discrète d'une nouvelle version 90 s après le démarrage, puis toutes les 6 h.
  // Rien n'est installé tout seul : l'interface affiche seulement une pastille sur « Réglages ».
  if (KIOSK && !INSTALLER) {
    const poll = () => updater.check().then((st) => win?.webContents.send('update:state', st)).catch(() => {});
    setTimeout(poll, 90 * 1000);
    setInterval(poll, 6 * 3600 * 1000).unref();
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  startLocalHA();
  return createWindow();
}).catch((err) => {
  console.error('Démarrage impossible :', err);
  app.quit();
});

app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { yt?.destroy(); localHA?.stop(); });
