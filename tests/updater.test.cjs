// Système de mise à jour : seuls les TAGS de version comptent (pas les commits intermédiaires).
// Testé contre un faux « GitHub » local, sans accès réseau.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const T = fs.mkdtempSync(path.join(os.tmpdir(), 'frhios-upd-'));
const work = path.join(T, 'work');
const remote = path.join(T, 'remote.git');
const state = path.join(T, 'state');
const iso = path.join(T, 'iso');
// Les réglages sont lus au chargement du module : à définir avant le require
process.env.FRHIOS_REPO = remote;
process.env.FRHIOS_STATE_DIR = state;
const { Updater, compareTags, parseTag } = require('../electron/updater.js');

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const sh = (cmd, cwd) => cp.execSync(cmd, { cwd, stdio: 'pipe', env: GIT_ENV }).toString().trim();
const put = (f, c) => { fs.mkdirSync(path.dirname(path.join(work, f)), { recursive: true }); fs.writeFileSync(path.join(work, f), c); };
const commit = (msg) => { sh(`git add -A && git commit -q -m "${msg}"`, work); sh(`git push -q ${remote} main`, work); return sh('git rev-parse HEAD', work); };
const tag = (name, annotated = true) => { sh(annotated ? `git tag -a ${name} -m "release ${name}"` : `git tag ${name}`, work); sh(`git push -q ${remote} ${name}`, work); };

test.after(() => fs.rmSync(T, { recursive: true, force: true }));

test('numéros de version : ordre numérique, tags non conformes ignorés', () => {
  assert.ok(compareTags('v1.10.0', 'v1.9.0') > 0, '1.10 est plus récent que 1.9');
  assert.ok(compareTags('2', 'v1.99.99') > 0);
  assert.equal(compareTags('v1.2', '1.2.0'), 0);
  for (const bad of ['latest', 'test', 'v1.0-rc1', 'v1.2.3.4', '../etc', 'v1.0.0/x', '']) assert.equal(parseTag(bad), null, bad);
  assert.deepEqual(parseTag('V1.0'), [1, 0, 0], 'le V majuscule de GitHub est accepté');
  assert.equal(compareTags('V1.0', 'v1.0.0'), 0);
});

test('mise à jour de l\'application depuis les tags d\'un dépôt distant', async (t) => {
  fs.mkdirSync(work);
  sh('git init -q -b main', work);
  sh(`git init -q --bare ${remote}`);
  ['electron/main.js', 'electron/preload.js', 'app/index.html', 'app/js/app.js', 'assets/bg.txt', 'README.md'].forEach((f) => put(f, `v1 ${f}`));
  const v1 = commit('Première version');
  tag('v1.0.0');
  fs.mkdirSync(iso);
  fs.writeFileSync(path.join(iso, 'version.json'), JSON.stringify({ tag: 'v1.0.0', commit: v1, date: 'x', message: 'Première version' }));
  let u = new Updater(iso);

  await t.test('même tag que le dépôt → à jour', async () => {
    assert.equal((await u.check()).state, 'uptodate');
  });

  await t.test('des commits SANS nouveau tag sont ignorés : rien n\'est proposé ni installé', async () => {
    put('app/js/app.js', 'dev1'); commit('Travail en cours 1');
    put('app/js/app.js', 'dev2'); commit('Travail en cours 2');
    const s = await u.check();
    assert.equal(s.state, 'uptodate');
    assert.equal((await u.apply()).ok, false);
    assert.equal(fs.existsSync(path.join(state, 'app/current')), false);
  });

  await t.test('les tags qui ne sont pas des numéros de version sont ignorés', async () => {
    tag('latest', false); tag('test', false); tag('v1.1-rc1', false);
    assert.equal((await u.check()).state, 'uptodate');
  });

  let x;
  await t.test('nouveau tag de version → proposé, avec les changements entre les deux versions', async () => {
    put('app/js/app.js', 'v1.1'); put('app/css/new.css', 'new'); x = commit('Ajout du bouton de mise à jour');
    tag('v1.1.0');
    put('app/js/app.js', 'apres-le-tag'); commit('Commit après le tag (ne doit pas être livré)');
    const s = await u.check();
    assert.equal(s.state, 'available');
    assert.equal(s.remote.tag, 'v1.1.0');
    assert.deepEqual(s.remote.changes, ['Ajout du bouton de mise à jour', 'Travail en cours 2', 'Travail en cours 1']);
  });

  let current;
  await t.test('installation : le contenu du TAG est livré, pas celui des commits suivants', async () => {
    const steps = [];
    const r = await u.apply((m) => steps.push(m));
    assert.equal(r.ok, true, r.error);
    assert.equal(r.tag, 'v1.1.0');
    current = fs.readlinkSync(path.join(state, 'app/current'));
    assert.equal(path.basename(current), 'v1.1.0');
    assert.equal(fs.readFileSync(path.join(current, 'app/js/app.js'), 'utf8'), 'v1.1', 'contenu du tag, pas du commit suivant');
    assert.ok(fs.existsSync(path.join(current, 'app/css/new.css')));
    assert.ok(!fs.existsSync(path.join(current, 'README.md')), 'README ne fait pas partie de l\'application');
    assert.ok(!fs.existsSync(path.join(current, '.git')));
    const pkg = JSON.parse(fs.readFileSync(path.join(current, 'package.json')));
    assert.equal(pkg.main, 'electron/main.js');
    assert.equal(pkg.version, '1.1.0');
    const ver = JSON.parse(fs.readFileSync(path.join(current, 'version.json')));
    assert.deepEqual([ver.tag, ver.commit], ['v1.1.0', x]);
    assert.ok(steps.length >= 3, 'progression annoncée');
  });

  await t.test('après redémarrage sur la nouvelle version → à jour ; réinstaller est refusé', async () => {
    u = new Updater(current);
    const s = await u.check();
    assert.equal(s.state, 'uptodate');
    assert.equal(s.current.source, 'update');
    assert.equal(s.current.label, 'v1.1.0');
    assert.equal((await u.apply()).ok, false);
  });

  await t.test('v1.10.0 est plus récent que v1.9.0 (ordre numérique, pas alphabétique)', async () => {
    put('app/js/app.js', 'v1.9'); commit('Version 1.9'); tag('v1.9.0');
    put('app/js/app.js', 'v1.10'); commit('Version 1.10'); tag('v1.10.0');
    const s = await u.check();
    assert.equal(s.remote.tag, 'v1.10.0');
    const r = await u.apply();
    assert.equal(r.ok, true, r.error);
    assert.equal(path.basename(fs.readlinkSync(path.join(state, 'app/current'))), 'v1.10.0');
    assert.ok(fs.existsSync(path.join(state, 'app/previous')), 'retour arrière possible');
  });

  await t.test('tag déjà jugé défectueux par l\'appareil : signalé, jamais proposé', async () => {
    u = new Updater(fs.readlinkSync(path.join(state, 'app/current')));
    fs.rmSync(path.join(work, 'electron/main.js'));
    commit('Version cassée'); tag('v1.11.0');
    fs.mkdirSync(path.join(state, 'app/bad'), { recursive: true });
    fs.writeFileSync(path.join(state, 'app/bad/v1.11.0'), '');
    const s = await u.check();
    assert.equal(s.state, 'bad');
    assert.equal((await u.apply()).ok, false);
  });

  await t.test('un nouveau tag corrigé remplace le tag défectueux', async () => {
    put('electron/main.js', 'corrigé'); commit('Correctif'); tag('v1.11.1');
    assert.equal((await u.check()).state, 'available');
    assert.equal((await u.apply()).ok, true);
  });

  await t.test('version incomplète : refusée, la version active ne change pas', async () => {
    const before = fs.readlinkSync(path.join(state, 'app/current'));
    fs.rmSync(path.join(work, 'electron/main.js'));
    commit('Encore cassée'); tag('v1.12.0');
    const r = await u.apply();
    assert.equal(r.ok, false);
    assert.match(r.error, /incomplète/);
    assert.equal(fs.readlinkSync(path.join(state, 'app/current')), before);
  });

  await t.test('les anciennes versions sont nettoyées', async () => {
    put('electron/main.js', 'ok');
    for (let i = 0; i < 4; i++) { put('app/js/app.js', `r${i}`); commit(`r${i}`); tag(`v2.${i}.0`); assert.equal((await u.apply()).ok, true); }
    const dirs = fs.readdirSync(path.join(state, 'app'), { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== 'bad');
    assert.ok(dirs.length <= 4, `${dirs.length} versions gardées`);
  });

  await t.test('version inconnue (dossier sans version.json) gérée', () => {
    assert.equal(new Updater('/nulle/part').status().current.label, 'inconnue');
  });
});
