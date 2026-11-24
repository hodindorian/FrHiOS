// Pipelines GitHub : garde-fous sur la publication de l'ISO (sécurité et cohérence avec l'appareil).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const { parseTag } = createRequire(import.meta.url)('../electron/updater.js');
const release = read('.github/workflows/release.yml');

test('l\'ISO est construite à la publication d\'un tag de version, après les tests', () => {
  assert.match(release, /on:\s*\n\s*push:\s*\n\s*tags:/);
  assert.ok(release.indexOf('npm test') < release.indexOf('./iso/build.sh'), 'les tests passent avant la construction');
  assert.match(release, /gh release upload "\$TAG" dist\/\*/);
  assert.match(release, /SHA256SUMS/);
});

test('l\'ISO de la pipeline n\'embarque pas les images Docker (limite de 2 Go par fichier de GitHub)', () => {
  assert.match(release, /FRHIOS_BUNDLE_IMAGES=0/);
  assert.match(release, /split -b/, 'découpage prévu si l\'ISO dépasse quand même la limite');
});

test('sécurité : écriture limitée au job de publication, aucune action tierce', () => {
  assert.match(release, /^permissions:\s*\n\s+contents: read/m, 'lecture seule par défaut');
  assert.equal((release.match(/contents: write/g) || []).length, 1, 'écriture donnée une seule fois (job de publication)');
  for (const f of ['ci.yml', 'release.yml']) {
    for (const [, action] of read(`.github/workflows/${f}`).matchAll(/uses:\s*(\S+)/g)) {
      assert.match(action, /^actions\//, `${f} : action tierce non autorisée (${action})`);
    }
  }
});

test('sécurité : le nom du tag n\'est jamais injecté dans un script (variable d\'environnement seulement)', () => {
  const lines = release.split('\n').filter((l) => /\$\{\{\s*(github\.event|github\.ref_name|inputs)/.test(l));
  assert.ok(lines.length > 0);
  for (const l of lines) assert.match(l, /^\s*(TAG|group|ref):/, `expression à risque : ${l.trim()}`);
});

test('le format de tag accepté par la pipeline est celui accepté par l\'appareil pour ses mises à jour', () => {
  const samples = ['v1', 'V1.0', '1.2.3', 'v10.20.30', 'latest', 'v1.0-rc1', 'v1.2.3.4', '1.x', 'test'];
  for (const tag of samples) {
    const bash = spawnSync('bash', ['-c', '[[ "$1" =~ ^[vV]?[0-9]+(\\.[0-9]+){0,2}$ ]]', '_', tag]).status === 0;
    assert.equal(bash, parseTag(tag) !== null, `désaccord sur « ${tag} »`);
  }
  assert.ok(release.includes('[[ "$TAG" =~ ^[vV]?[0-9]+(\\.[0-9]+){0,2}$ ]]'), 'contrôle du tag présent dans la pipeline');
});
