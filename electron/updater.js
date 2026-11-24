'use strict';
// Mise à jour de l'application FrHiOS SANS réinstaller l'ISO.
//
// Seules les VERSIONS PUBLIÉES comptent : les tags git du dépôt GitHub (v1.2.0, 1.2.0…). Les commits
// intermédiaires, eux, sont ignorés : pousser du code sur `main` ne change rien sur l'appareil tant que vous
// n'avez pas créé un tag plus récent. Ex. :  git tag v1.1.0 && git push origin v1.1.0
//
// Le code de l'application (app/, electron/, assets/) du tag le plus récent est copié dans un dossier de
// version, puis activé en changeant un lien symbolique. Le prochain démarrage de l'interface utilise cette
// version ; si elle ne démarre pas correctement, `frhios-app` revient tout seul à la précédente (ou à la
// version livrée avec l'ISO).
//
//   /opt/frhios                      version livrée avec l'ISO (jamais modifiée)
//   /var/lib/frhios/src              copie locale (dépôt git nu) des versions téléchargées
//   /var/lib/frhios/app/<tag>        chaque version installée
//   /var/lib/frhios/app/current      lien vers la version à utiliser   (lu par frhios-app)
//   /var/lib/frhios/app/previous     lien vers la version d'avant      (retour arrière)
//   /var/lib/frhios/app/bad/<tag>    versions qui n'ont pas démarré : on ne les réinstalle pas
//
// Ne met PAS à jour : les paquets système (utiliser `upg` dans le terminal) ni les fichiers système
// de FrHiOS hors application (sway.conf, services…) : ceux-là demandent une nouvelle ISO.
// Sans droits root : tout vit dans /var/lib/frhios, qui appartient à l'utilisateur de l'interface.

const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const REPO_URL = process.env.FRHIOS_REPO || 'https://github.com/hodindorian/FrHiOS.git';
const STATE_DIR = process.env.FRHIOS_STATE_DIR || '/var/lib/frhios';
const SHIPPED = ['app', 'electron', 'assets'];      // dossiers du dépôt qui font l'application
const KEEP = 3;                                      // versions gardées sur le disque
const SHA_RE = /^[0-9a-f]{40}$/;
// Tag de version : v1, v1.2, v1.2.3 (avec ou sans « v »). Tout autre tag (test, latest, v1.0-rc1…) est ignoré.
// Cette forme stricte sert aussi de protection : le nom du tag devient un nom de dossier.
const TAG_RE = /^v?(\d{1,4})(?:\.(\d{1,4}))?(?:\.(\d{1,4}))?$/;

const parseTag = (tag) => { const m = TAG_RE.exec(tag || ''); return m ? [Number(m[1]), Number(m[2] || 0), Number(m[3] || 0)] : null; };
/** Compare deux numéros de version : 1.10.0 > 1.9.0 (ordre numérique, pas alphabétique). */
const compareTags = (a, b) => { const x = parseTag(a); const y = parseTag(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };

const git = (args, { cwd, timeout = 90000 } = {}) => new Promise((resolve) => {
  execFile('git', args, {
    cwd,
    timeout,
    maxBuffer: 16 * 1024 * 1024,
    // Jamais de question interactive (identifiants) : le dépôt est public
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'true', LC_ALL: 'C' },
  }, (err, stdout, stderr) => resolve({ ok: !err, stdout: String(stdout || '').trim(), stderr: String(stderr || '').trim() }));
});

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

class Updater {
  /** @param {string} runningDir dossier de l'application en cours d'exécution (app.getAppPath()) */
  constructor(runningDir) {
    this.runningDir = runningDir;
    this.root = path.join(STATE_DIR, 'app');
    this.src = path.join(STATE_DIR, 'src');
    this.busy = false;
    this.last = { state: 'unknown', remote: null, error: '', checkedAt: 0 };
  }

  /** Version exécutée (version.json, écrit à la construction de l'ISO ou à l'installation d'une mise à jour) */
  current() {
    const v = readJson(path.join(this.runningDir, 'version.json')) || {};
    const tag = parseTag(v.tag) ? v.tag : '';
    return {
      tag,
      commit: SHA_RE.test(v.commit || '') ? v.commit : '',
      label: tag || (v.commit ? String(v.commit).slice(0, 7) : 'inconnue'),
      date: v.date || '',
      message: v.message || '',
      dirty: Boolean(v.dirty),
      source: this.runningDir.startsWith(this.root) ? 'update' : 'iso',
    };
  }

  /** La mise à jour est-elle possible ici ? (dossier d'état accessible en écriture) */
  supported() {
    try { fs.mkdirSync(this.root, { recursive: true }); fs.accessSync(this.root, fs.constants.W_OK); return true; } catch { return false; }
  }

  status() {
    return { supported: this.supported(), busy: this.busy, current: this.current(), ...this.last };
  }

  isBad(tag) { return fs.existsSync(path.join(this.root, 'bad', tag)); }

  /** Tag de version le plus récent du dépôt distant : { tag, commit } ou null s'il n'y en a pas. null aussi si injoignable (error). */
  async latestRelease() {
    const ls = await git(['ls-remote', '--tags', REPO_URL], { timeout: 25000 });
    if (!ls.ok) return { error: true };
    const tags = new Map();
    for (const line of ls.stdout.split('\n')) {
      const [sha, ref] = line.split(/\s+/);
      const m = /^refs\/tags\/(.+?)(\^\{\})?$/.exec(ref || '');
      if (!m || !SHA_RE.test(sha) || !parseTag(m[1])) continue;
      // Tag annoté : la ligne « ^{} » donne le commit réel, qui a priorité sur l'objet tag
      if (m[2] || !tags.has(m[1])) tags.set(m[1], sha);
    }
    const best = [...tags.keys()].sort(compareTags).pop();
    return best ? { tag: best, commit: tags.get(best) } : null;
  }

  /** Interroge GitHub : y a-t-il une version publiée (tag) plus récente que celle qui tourne ? */
  async check() {
    if (this.busy) return this.status();
    if (!this.supported()) {
      this.last = { state: 'unsupported', remote: null, error: 'Les mises à jour ne sont disponibles que sur l’appareil.', checkedAt: Date.now() };
      return this.status();
    }
    this.busy = true;
    try {
      const rel = await this.latestRelease();
      if (rel?.error) {
        this.last = { state: 'error', remote: null, error: 'GitHub est injoignable (le réseau fonctionne-t-il ?).', checkedAt: Date.now() };
        return this.status();
      }
      if (!rel) {
        this.last = { state: 'none', remote: null, error: '', checkedAt: Date.now() };
        return this.status();
      }
      const cur = this.current();
      const remote = { tag: rel.tag, commit: rel.commit, short: rel.tag, changes: [] };

      // Cette version est-elle plus récente que la mienne ?
      let newer;
      if (rel.commit === cur.commit) newer = false;
      else if (cur.tag) newer = compareTags(rel.tag, cur.tag) > 0;
      else newer = true;   // ISO construite avant le premier tag : la première version publiée est forcément plus récente

      if (!newer) {
        this.last = { state: 'uptodate', remote, error: '', checkedAt: Date.now() };
        return this.status();
      }
      // Version plus récente : on récupère son historique pour montrer ce qui change
      const f = await this.#fetchTag(rel.tag);
      if (!f.ok) {
        this.last = { state: 'error', remote: null, error: `Téléchargement impossible : ${f.stderr.split('\n').pop() || 'erreur réseau'}`, checkedAt: Date.now() };
        return this.status();
      }
      const known = cur.commit && (await git(['cat-file', '-e', `${cur.commit}^{commit}`], { cwd: this.src })).ok;
      const log = await git(['log', '-n', '8', '--format=%s', known ? `${cur.commit}..${rel.commit}` : rel.commit], { cwd: this.src });
      remote.changes = log.ok ? log.stdout.split('\n').filter(Boolean) : [];
      const bad = this.isBad(rel.tag);
      this.last = {
        state: bad ? 'bad' : 'available',
        remote,
        error: bad ? `La version ${rel.tag} a déjà échoué au démarrage de l’appareil : en attente d’une version corrigée (nouveau tag).` : '',
        checkedAt: Date.now(),
      };
      return this.status();
    } finally {
      this.busy = false;
    }
  }

  async #fetchTag(tag) {
    if (!parseTag(tag)) return { ok: false, stderr: 'tag invalide' };
    if (!fs.existsSync(path.join(this.src, 'HEAD'))) {
      fs.mkdirSync(this.src, { recursive: true });
      const init = await git(['init', '--bare', '-q', this.src]);
      if (!init.ok) return init;
    }
    return git(['--git-dir', this.src, 'fetch', '--depth=40', '--no-tags', '--force', REPO_URL, `+refs/tags/${tag}:refs/tags/${tag}`], { timeout: 180000 });
  }

  /**
   * Installe la dernière version publiée. Renvoie { ok, error?, tag? }. L'appelant doit ensuite redémarrer l'interface.
   * @param {(text:string)=>void} progress
   */
  async apply(progress = () => {}) {
    if (this.busy) return { ok: false, error: 'Une opération est déjà en cours.' };
    if (!this.supported()) return { ok: false, error: 'Les mises à jour ne sont disponibles que sur l’appareil.' };
    this.busy = true;
    try {
      progress('Recherche de la dernière version…');
      const rel = await this.latestRelease();
      if (rel?.error) return { ok: false, error: 'GitHub est injoignable (le réseau fonctionne-t-il ?).' };
      if (!rel) return { ok: false, error: 'Aucune version publiée (tag) sur GitHub.' };
      const { tag, commit } = rel;
      const cur = this.current();
      if (commit === cur.commit || (cur.tag && compareTags(tag, cur.tag) <= 0)) return { ok: false, error: 'Vous avez déjà la dernière version.' };
      if (this.isBad(tag)) return { ok: false, error: `La version ${tag} a déjà échoué au démarrage de l’appareil.` };

      progress(`Téléchargement de ${tag}…`);
      const f = await this.#fetchTag(tag);
      if (!f.ok) return { ok: false, error: `Téléchargement impossible : ${f.stderr.split('\n').pop() || 'erreur réseau'}` };
      // Le contenu installé est celui du TAG, jamais celui d'un commit plus récent
      const info = await git(['--git-dir', this.src, 'log', '-1', '--format=%H%n%cI%n%s', commit]);
      const [realCommit, date, message] = info.stdout.split('\n');
      if (!info.ok || realCommit !== commit) return { ok: false, error: 'Version introuvable dans le dépôt.' };

      progress('Préparation des fichiers…');
      const tmp = path.join(this.root, `.tmp-${tag}`);
      const dest = path.join(this.root, tag);
      fs.rmSync(tmp, { recursive: true, force: true });
      fs.mkdirSync(tmp, { recursive: true });
      await new Promise((resolve, reject) => {
        // git archive | tar : extrait seulement les dossiers de l'application, sans historique
        const a = spawn('git', ['--git-dir', this.src, 'archive', commit, ...SHIPPED]);
        const t = spawn('tar', ['-x', '-C', tmp]);
        a.stdout.pipe(t.stdin);
        let err = '';
        a.stderr.on('data', (d) => { err += d; });
        t.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err || `tar a échoué (${code})`))));
        a.on('error', reject); t.on('error', reject);
      });

      // Vérifications minimales : si ces fichiers manquent, on n'active rien
      for (const must of ['electron/main.js', 'electron/preload.js', 'app/index.html', 'app/js/app.js']) {
        if (!fs.existsSync(path.join(tmp, must))) { fs.rmSync(tmp, { recursive: true, force: true }); return { ok: false, error: `Version incomplète (${must} manquant).` }; }
      }
      // Mêmes fichiers que ceux écrits par iso/build.sh
      fs.writeFileSync(path.join(tmp, 'package.json'), `${JSON.stringify({ name: 'frhios', version: tag.replace(/^v/, ''), private: true, main: 'electron/main.js' }, null, 2)}\n`);
      fs.writeFileSync(path.join(tmp, 'version.json'), `${JSON.stringify({ tag, commit, date, message, dirty: false }, null, 2)}\n`);

      progress('Activation…');
      fs.rmSync(dest, { recursive: true, force: true });
      fs.renameSync(tmp, dest);
      const symlink = (name, target) => { const t = path.join(this.root, `.${name}.tmp`); fs.rmSync(t, { force: true }); fs.symlinkSync(target, t); fs.renameSync(t, path.join(this.root, name)); };
      let before = null;
      try { before = fs.readlinkSync(path.join(this.root, 'current')); } catch { /* première mise à jour */ }
      if (before && before !== dest) symlink('previous', before);
      symlink('current', dest);
      this.#prune();
      return { ok: true, tag, commit };
    } catch (err) {
      return { ok: false, error: `Échec de l’installation : ${err.message}` };
    } finally {
      this.busy = false;
    }
  }

  #prune() {
    const keep = new Set();
    for (const name of ['current', 'previous']) { try { keep.add(path.basename(fs.readlinkSync(path.join(this.root, name)))); } catch { /* absent */ } }
    const dirs = fs.readdirSync(this.root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== 'bad' && !d.name.startsWith('.'))
      .map((d) => ({ name: d.name, t: fs.statSync(path.join(this.root, d.name)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    dirs.slice(KEEP).filter((d) => !keep.has(d.name)).forEach((d) => fs.rmSync(path.join(this.root, d.name), { recursive: true, force: true }));
  }
}

module.exports = { Updater, parseTag, compareTags };
