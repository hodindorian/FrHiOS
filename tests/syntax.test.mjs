// Tout le code doit au moins se charger : syntaxe JavaScript (interface et processus principal),
// scripts shell de l'ISO, fichiers JSON. Attrape les fautes de frappe avant qu'elles n'arrivent sur l'appareil.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const list = (dir, filter) => fs.readdirSync(path.join(ROOT, dir)).filter(filter).map((f) => path.join(dir, f));

test('interface (app/js) : syntaxe ES modules', () => {
  for (const file of list('app/js', (f) => f.endsWith('.js'))) {
    const r = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: fs.readFileSync(path.join(ROOT, file)), encoding: 'utf8' });
    assert.equal(r.status, 0, `${file} :\n${r.stderr}`);
  }
});

test('processus principal (electron/*.js) : syntaxe CommonJS', () => {
  for (const file of [...list('electron', (f) => f.endsWith('.js')), ...list('tools', (f) => f.endsWith('.cjs'))]) {
    const r = spawnSync(process.execPath, ['--check', path.join(ROOT, file)], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${file} :\n${r.stderr}`);
  }
});

test('scripts shell (iso/*.sh et scripts de l\'ISO) : syntaxe', () => {
  const files = [
    ...list('iso', (f) => f.endsWith('.sh')),
    ...list('tools', (f) => f.endsWith('.sh')),
    ...list('iso/overlay/airootfs/usr/local/bin', () => true),
  ];
  assert.ok(files.length >= 5, 'scripts introuvables');
  for (const file of files) {
    const first = fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n')[0];
    const shell = /bash/.test(first) ? 'bash' : 'sh';
    const r = spawnSync(shell, ['-n', path.join(ROOT, file)], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${file} (${shell} -n) :\n${r.stderr}`);
  }
});

test('JSON : package.json valide, point d\'entrée présent', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(fs.existsSync(path.join(ROOT, pkg.main)), `main introuvable : ${pkg.main}`);
});
