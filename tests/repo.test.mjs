// Contrôles de bon sens sur le dépôt : décor, fichiers référencés, secrets.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('décor : seulement la photo et le cercle Zoltraak (pas d\'étoiles clignotantes)', () => {
  for (const f of ['app/index.html', 'app/installer.html']) {
    assert.ok(!/class="spark"/.test(read(f)), `${f} contient encore des étoiles`);
  }
  assert.ok(!/\.spark\b|twinkle/.test(read('app/css/style.css')), 'CSS des étoiles encore présent');
  assert.match(read('app/index.html'), /class="bg-circle"/);
  assert.match(read('app/css/style.css'), /\.bg-circle[^}]*animation:\s*spin/s, 'le cercle doit tourner');
});

test('fichiers référencés par la page d\'accueil et le CSS : tous présents', () => {
  const html = read('app/index.html');
  const refs = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map((m) => m[1]).filter((r) => !/^https?:/.test(r));
  const css = read('app/css/style.css');
  refs.push(...[...css.matchAll(/url\('?([^')]+)'?\)/g)].map((m) => m[1]).filter((r) => !/^(data:|https?:)/.test(r)));
  assert.ok(refs.length >= 3);
  for (const ref of refs) {
    const file = ref.startsWith('/assets/') ? ref.slice(1) : ref.startsWith('/') ? ref.slice(1) : path.join('app', ref);
    assert.ok(fs.existsSync(path.join(ROOT, file)), `introuvable : ${ref} (${file})`);
  }
});

test('le mode kiosque n\'expose pas le bouton « plein écran » (il gelait l\'affichage)', () => {
  const js = read('app/js/app.js');
  assert.match(js, /KIOSK_UI/);
  assert.match(read('electron/main.js'), /fullscreenable:\s*!KIOSK/);
});

test('aucun secret évident dans les fichiers suivis par git', () => {
  let files;
  try {
    files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch { return; } // pas de dépôt git (archive) : rien à contrôler
  const skip = /(^|\/)(node_modules|vendor)\/|package-lock\.json|\.(png|jpe?g|webp|ico|woff2?)$|^tests\//;
  const patterns = [
    [/\b(?:export\s+)?[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_?KEY)[A-Z0-9_]*\s*=\s*["']?[A-Za-z0-9_.\-]{12,}/, 'affectation de secret'],
    [/\b(?:mariadb|mysql)\s[^\n]*\s-p\S{3,}/, 'mot de passe dans une commande'],
    [/\bgh[pousr]_[A-Za-z0-9]{20,}/, 'jeton GitHub'],
    [/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\./, 'jeton JWT'],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'clé privée'],
  ];
  const found = [];
  for (const f of files.filter((x) => !skip.test(x))) {
    let text; try { text = read(f); } catch { continue; }
    if (text.includes('\0')) continue;
    for (const [re, label] of patterns) if (re.test(text)) found.push(`${f} : ${label}`);
  }
  assert.deepEqual(found, [], `secrets possibles :\n${found.join('\n')}`);
});
