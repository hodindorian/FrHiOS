// Script à lancer une fois sur un appareil installé avec une ISO plus ancienne que le système de mise à jour.
// Testé contre un faux dépôt local, sans sudo ni Electron (Node le remplace).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };

function fakeGitHub() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frhios-boot-'));
  const work = path.join(dir, 'work'); const remote = path.join(dir, 'remote.git');
  const sh = (c, cwd) => execSync(c, { cwd, stdio: 'pipe', env: GIT_ENV }).toString().trim();
  const put = (f, c) => { fs.mkdirSync(path.dirname(path.join(work, f)), { recursive: true }); fs.writeFileSync(path.join(work, f), c); };
  fs.mkdirSync(work); sh('git init -q -b main', work); sh(`git init -q --bare ${remote}`);
  // le dépôt contient le script de démarrage, l'application et les outils : comme le vrai
  for (const f of ['electron/main.js', 'electron/preload.js', 'app/index.html', 'app/js/app.js', 'assets/x.txt']) put(f, `contenu ${f}`);
  put('electron/updater.js', fs.readFileSync(path.join(ROOT, 'electron/updater.js'), 'utf8'));
  put('iso/overlay/airootfs/usr/local/bin/frhios-app', fs.readFileSync(path.join(ROOT, 'iso/overlay/airootfs/usr/local/bin/frhios-app'), 'utf8'));
  put('tools/apply-update.cjs', fs.readFileSync(path.join(ROOT, 'tools/apply-update.cjs'), 'utf8'));
  const release = (tag) => { sh('git add -A && git commit -q --allow-empty -m "release"', work); if (tag) { sh(`git tag -a ${tag} -m ${tag}`, work); sh(`git push -q ${remote} ${tag}`, work); } sh(`git push -q ${remote} main`, work); };
  return { dir, remote, put, release, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const run = (g, extra = {}) => spawnSync('sh', [path.join(ROOT, 'tools/bootstrap-update.sh')], {
  encoding: 'utf8', timeout: 60000,
  env: { ...process.env, FRHIOS_REPO: g.remote, FRHIOS_BIN_DIR: path.join(g.dir, 'bin'), FRHIOS_STATE_DIR: path.join(g.dir, 'state'),
    FRHIOS_SUDO: '', FRHIOS_OWNER_ARGS: '', FRHIOS_NODE_CMD: `env ELECTRON_RUN_AS_NODE=1 ${process.execPath}`, FRHIOS_RESTART: '0', ...extra },
});

test('installe le script de démarrage et la dernière version publiée (tag), pas le dernier commit', () => {
  const g = fakeGitHub();
  try {
    fs.mkdirSync(path.join(g.dir, 'bin'));
    g.release('v1.0.0');
    g.put('app/js/app.js', 'COMMIT-APRES-LE-TAG'); g.release(null);   // ne doit pas être livré
    const r = run(g);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /version v1\.0\.0/);
    assert.ok(fs.existsSync(path.join(g.dir, 'bin/frhios-app')), 'script de démarrage installé');
    const current = fs.readlinkSync(path.join(g.dir, 'state/app/current'));
    assert.equal(path.basename(current), 'v1.0.0');
    assert.equal(fs.readFileSync(path.join(current, 'app/js/app.js'), 'utf8'), 'contenu app/js/app.js');
    assert.ok(fs.existsSync(path.join(current, 'version.json')));
  } finally { g.cleanup(); }
});

test('sans aucun tag sur GitHub : message clair, rien n\'est installé', () => {
  const g = fakeGitHub();
  try {
    fs.mkdirSync(path.join(g.dir, 'bin'));
    g.release(null);
    const r = run(g);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout, /Aucun tag de version/);
    assert.equal(fs.existsSync(path.join(g.dir, 'bin/frhios-app')), false);
    assert.equal(fs.existsSync(path.join(g.dir, 'state/app/current')), false);
  } finally { g.cleanup(); }
});
