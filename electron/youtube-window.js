'use strict';
// YouTube dans un VRAI navigateur (Chromium), posé par-dessus la zone « Musique » de l'interface.
//
// Pourquoi : Google refuse la connexion à un compte depuis un navigateur intégré (Electron).
// Un vrai Chromium est accepté. Il doit pourtant s'afficher DANS la page Musique : sur l'appareil,
// le compositeur est sway, qui sait placer une fenêtre flottante à un endroit précis de l'écran.
//
// Disponible seulement quand l'application tourne sous sway (variable SWAYSOCK). Sinon (développement
// sur votre PC), main.js garde la vue YouTube intégrée.
//
// Frappe au clavier à l'écran : `wtype` (protocole « virtual keyboard » de Wayland) envoie les
// caractères à la fenêtre qui a le focus ; on lui redonne le focus avant chaque frappe.

const { spawn, execFile } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');

const START_URL = 'https://www.youtube.com/';
// Identifiants de fenêtre vus par sway (vérifiés sur l'appareil) :
//  - notre interface (Electron) : « frhios » (le nom du paquet)
//  - Chromium en mode --app     : « chrome-<site>__-Default » (il ignore l'option --class)
const MINE = '[app_id="^chrome-www\\.youtube\\.com__.*"]';
const OTHER_WINDOWS = '[app_id="^frhios$"]';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const run = (cmd, args) => new Promise((resolve) => {
  execFile(cmd, args, { timeout: 10000 }, (err, stdout) => resolve({ ok: !err, stdout: String(stdout || '') }));
});

// Une commande sway réussit si TOUTES ses réponses JSON sont « success »
async function sway(command) {
  const r = await run('swaymsg', ['-t', 'command', command]);
  try {
    const list = JSON.parse(r.stdout);
    return Array.isArray(list) && list.length > 0 && list.every((x) => x.success);
  } catch {
    return false;
  }
}

class YoutubeWindow {
  constructor() {
    this.proc = null;
    this.visible = false;   // la page Musique > YouTube est affichée
    this.hidden = true;     // la fenêtre est dans le « scratchpad » de sway (cachée)
    this.rect = null;
    this.token = 0;         // invalide les boucles d'attente d'une demande précédente
  }

  static available() {
    return Boolean(process.env.SWAYSOCK);
  }

  spawnBrowser() {
    if (this.proc) return;
    const args = [
      '--ozone-platform=wayland',
      `--user-data-dir=${path.join(os.homedir(), '.config', 'frhios-youtube')}`,
      '--password-store=basic',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-session-crashed-bubble',
      '--disable-infobars',
      '--lang=fr',
      '--accept-lang=fr-FR,fr',
      `--app=${START_URL}`,
    ];
    // Rendu logiciel (machine virtuelle) : même consigne que pour l'interface
    if ((process.env.FRHIOS_FLAGS || '').includes('--disable-gpu')) args.push('--disable-gpu');

    const env = { ...process.env, LANGUAGE: 'fr_FR:fr' };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn('chromium', args, { env, stdio: 'ignore' });
    const forget = () => { if (this.proc === child) { this.proc = null; this.hidden = true; } };
    child.on('exit', forget);
    child.on('error', forget);
    this.proc = child;
    this.hidden = true; // sway.conf cache toute nouvelle fenêtre YouTube tant qu'on ne l'a pas placée
  }

  async place() {
    if (this.hidden) {
      if (!(await sway(`${MINE} scratchpad show`))) return false; // pas encore ouverte : on réessaiera
      this.hidden = false;
    }
    const { x, y, width, height } = this.rect;
    await sway(`${MINE} floating enable, border none, resize set width ${width} px height ${height} px, move absolute position ${x} ${y}`);
    await sway(`${MINE} focus`);
    return true;
  }

  async show(rect) {
    this.rect = rect;
    this.visible = true;
    const token = ++this.token;
    this.spawnBrowser();
    // La fenêtre met quelques secondes à apparaître au premier lancement
    for (let i = 0; i < 80 && this.visible && token === this.token; i++) {
      if (await this.place()) return;
      await sleep(500);
    }
  }

  async setBounds(rect) {
    this.rect = rect;
    if (this.visible && !this.hidden) await this.place();
  }

  async hide() {
    this.visible = false;
    this.token++;
    if (!this.hidden && (await sway(`${MINE} move scratchpad`))) this.hidden = true; // la lecture continue
    await sway(`${OTHER_WINDOWS} focus`);
  }

  /* ----- Clavier ----- */

  async type(text) {
    await sway(`${MINE} focus`);
    await run('wtype', ['--', text]);
  }

  async key(name, mods = []) {
    await sway(`${MINE} focus`);
    const args = [];
    mods.forEach((m) => args.push('-M', m));
    args.push('-k', name);
    [...mods].reverse().forEach((m) => args.push('-m', m));
    await run('wtype', args);
  }

  async action(name) {
    if (name === 'back') return this.key('Left', ['alt']);
    if (name === 'reload') return this.key('F5');
    if (name === 'home') return this.restart(); // revient à la page d'accueil de YouTube
    return undefined;
  }

  async restart() {
    if (this.proc) {
      const p = this.proc;
      this.proc = null;
      this.hidden = true;
      p.kill();
      await sleep(300);
    }
    if (this.visible && this.rect) await this.show(this.rect);
  }

  destroy() {
    this.visible = false;
    this.proc?.kill();
    this.proc = null;
  }
}

module.exports = { YoutubeWindow };
