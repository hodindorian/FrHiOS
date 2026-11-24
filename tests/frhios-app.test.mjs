// Script de démarrage de l'interface sur l'appareil (frhios-app) : choix de la version et retour arrière
// automatique si une mise à jour ne démarre pas. Testé avec un faux Electron.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'iso/overlay/airootfs/usr/local/bin/frhios-app');

// Bac à sable : version livrée avec l'ISO, dossier d'état, faux electron et faux swaymsg
function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frhios-app-'));
  const w = (f, c, mode) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), c, { mode }); };
  w('factory/electron/main.js', ''); w('factory/package.json', '{}');
  w('bin/electron', `#!/bin/sh
echo "$1" > "${dir}/launched"
case "$FAKE" in
  ok)    echo ok > "$FRHIOS_HEALTH"; sleep 0.3; exit 0 ;;
  crash) exit 1 ;;
  hang)  sleep 30 ;;
esac`, 0o755);
  w('bin/swaymsg', `#!/bin/sh\necho "$@" >> "${dir}/sway-calls"`, 0o755);
  const release = (name) => { w(`state/app/${name}/electron/main.js`, ''); w(`state/app/${name}/package.json`, '{}'); return path.join(dir, 'state/app', name); };
  const link = (name, target) => { fs.mkdirSync(path.join(dir, 'state/app'), { recursive: true }); fs.rmSync(path.join(dir, 'state/app', name), { force: true }); fs.symlinkSync(target, path.join(dir, 'state/app', name)); };
  const run = (fake, extra = {}) => spawnSync('sh', [SCRIPT], {
    timeout: 20000, encoding: 'utf8',
    env: { PATH: `${path.join(dir, 'bin')}:${process.env.PATH}`, FAKE: fake, FRHIOS_MODE: '--kiosk',
      FRHIOS_ELECTRON: path.join(dir, 'bin/electron'), FRHIOS_FACTORY_DIR: path.join(dir, 'factory'),
      FRHIOS_STATE_DIR: path.join(dir, 'state'), FRHIOS_HEALTH_FILE: path.join(dir, 'healthy'),
      FRHIOS_LOG: path.join(dir, 'log'), FRHIOS_WATCHDOG_SECONDS: '1', FRHIOS_MIN_RUN_SECONDS: '20', ...extra },
  });
  const read = (f) => { try { return fs.readFileSync(path.join(dir, f), 'utf8').trim(); } catch { return null; } };
  const target = (name) => { try { return fs.readlinkSync(path.join(dir, 'state/app', name)); } catch { return null; } };
  const bad = (name) => fs.existsSync(path.join(dir, 'state/app/bad', name));
  return { dir, release, link, run, read, target, bad, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('sans mise à jour : la version livrée avec l\'ISO est lancée, puis la session est refermée', () => {
  const s = sandbox();
  try {
    s.run('ok');
    assert.equal(s.read('launched'), path.join(s.dir, 'factory'));
    assert.match(s.read('sway-calls'), /exit/);
  } finally { s.cleanup(); }
});

test('mise à jour qui démarre bien : elle est lancée et conservée', () => {
  const s = sandbox();
  try {
    const r1 = s.release('aaaaaaa'); s.link('current', r1);
    s.run('ok');
    assert.equal(s.read('launched'), path.join(s.dir, 'state/app/current'));
    assert.equal(s.target('current'), r1);
    assert.equal(s.bad('aaaaaaa'), false);
  } finally { s.cleanup(); }
});

test('mise à jour qui plante au démarrage, sans version précédente : retour à la version de l\'ISO', () => {
  const s = sandbox();
  try {
    s.link('current', s.release('badbad1'));
    s.run('crash');
    assert.equal(s.target('current'), null, 'le lien current est retiré');
    assert.equal(s.bad('badbad1'), true, 'la version est marquée défectueuse');
    s.run('ok');
    assert.equal(s.read('launched'), path.join(s.dir, 'factory'), 'prochain démarrage : version de l\'ISO');
  } finally { s.cleanup(); }
});

test('mise à jour qui plante : retour à la version précédente quand elle existe', () => {
  const s = sandbox();
  try {
    const good = s.release('goodgo1'); const broken = s.release('badbad2');
    s.link('previous', good); s.link('current', broken);
    s.run('crash');
    assert.equal(s.target('current'), good);
    assert.equal(s.bad('badbad2'), true);
  } finally { s.cleanup(); }
});

test('mise à jour qui ne dit jamais « bien démarré » : arrêtée par le chien de garde puis retirée', () => {
  const s = sandbox();
  try {
    s.link('current', s.release('hunghu1'));
    const t0 = Date.now();
    s.run('hang');
    assert.ok(Date.now() - t0 < 15000, 'le faux Electron (30 s) a bien été arrêté');
    assert.equal(s.bad('hunghu1'), true);
    assert.equal(s.target('current'), null);
  } finally { s.cleanup(); }
});

test('une version précédente déjà jugée défectueuse n\'est jamais restaurée', () => {
  const s = sandbox();
  try {
    const old = s.release('oldbad1'); const cur = s.release('curbad1');
    fs.mkdirSync(path.join(s.dir, 'state/app/bad'), { recursive: true });
    fs.writeFileSync(path.join(s.dir, 'state/app/bad/oldbad1'), '');
    s.link('previous', old); s.link('current', cur);
    s.run('crash');
    assert.equal(s.target('current'), null);
  } finally { s.cleanup(); }
});

test('l\'assistant d\'installation de l\'ISO ignore les mises à jour', () => {
  const s = sandbox();
  try {
    s.link('current', s.release('ignore1'));
    s.run('ok', { FRHIOS_MODE: '--installer' });
    assert.equal(s.read('launched'), path.join(s.dir, 'factory'));
  } finally { s.cleanup(); }
});
