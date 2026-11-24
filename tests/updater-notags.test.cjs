// Dépôt sans aucun tag : rien n'est proposé (et le message l'explique). Fichier à part car les réglages
// du module sont lus une seule fois, au chargement.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const T = fs.mkdtempSync(path.join(os.tmpdir(), 'frhios-notag-'));
const work = path.join(T, 'work');
const remote = path.join(T, 'remote.git');
process.env.FRHIOS_REPO = remote;
process.env.FRHIOS_STATE_DIR = path.join(T, 'state');
const { Updater } = require('../electron/updater.js');
const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const sh = (c, cwd) => cp.execSync(c, { cwd, stdio: 'pipe', env }).toString().trim();

test.after(() => fs.rmSync(T, { recursive: true, force: true }));

test('sans tag sur GitHub : état « none », aucune installation', async () => {
  fs.mkdirSync(path.join(work, 'app'), { recursive: true });
  fs.writeFileSync(path.join(work, 'app/index.html'), 'x');
  sh('git init -q -b main && git add -A && git commit -q -m un', work);
  sh(`git init -q --bare ${remote}`);
  sh(`git push -q ${remote} main`, work);
  const u = new Updater('/nulle/part');
  assert.equal((await u.check()).state, 'none');
  const r = await u.apply();
  assert.equal(r.ok, false);
  assert.match(r.error, /Aucune version publiée/);
});

test('dépôt injoignable : erreur claire, pas d\'exception', async () => {
  fs.rmSync(remote, { recursive: true, force: true });
  const s = await new Updater('/nulle/part').check();
  assert.equal(s.state, 'error');
  assert.match(s.error, /injoignable/);
});
