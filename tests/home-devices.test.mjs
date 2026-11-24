// « Connecter des appareils » : un appareil de la maison déjà connecté ne doit plus être proposé.
import test from 'node:test';
import assert from 'node:assert/strict';
import { connectedHomeIds } from '../app/js/setup.js';

const E = (entryId, domain, title, hints = []) => ({ entryId, domain, title, state: 'loaded', hints });
const tapo = (id, alias, model, ip) => E(id, 'tplink', `${alias} ${model}`, [alias, model, 'TP-Link', `http://${ip}`]);
const ids = (entries, memo = {}) => [...connectedHomeIds(entries, memo)].sort();

test('tout est connecté → toute la liste est masquée', () => {
  assert.deepEqual(ids([
    tapo('e1', 'Prise cuisine', 'P100', '192.168.1.15'), tapo('e2', 'Prise bureau', 'P100', '192.168.1.34'),
    tapo('e3', 'Lampe salon', 'L530', '192.168.1.154'), E('e4', 'androidtv_remote', 'Philips TV'), E('e5', 'philips_js', 'Philips TV'),
  ]), ['ambilight', 'tapo1', 'tapo2', 'tapo3', 'tv']);
});

test('deux prises identiques (P100) : chacune est reconnue par son adresse IP', () => {
  assert.deepEqual(ids([tapo('e1', 'Prise', 'P100', '192.168.1.15')]), ['tapo1']);
  assert.deepEqual(ids([tapo('e2', 'Prise', 'P100', '192.168.1.34')]), ['tapo2']);
});

test('la télé seule ne masque pas l\'Ambilight', () => {
  assert.deepEqual(ids([E('e4', 'androidtv_remote', 'Philips TV')]), ['tv']);
});

test('mémoire des ajouts : exacte tant que l\'entrée existe, oubliée si elle est retirée', () => {
  assert.deepEqual(ids([E('x9', 'tplink', 'Smart Plug')], { tapo2: 'x9' }), ['tapo2']);
  assert.deepEqual(ids([], { tapo2: 'x9' }), []);
});

test('entrée ambiguë (sans IP ni modèle) : on ne masque rien plutôt que de se tromper', () => {
  assert.deepEqual(ids([E('x1', 'tplink', 'Smart Plug')]), []);
});

test('ampoule reconnue par son modèle seul', () => {
  assert.deepEqual(ids([E('x2', 'tplink', 'Lampe L530')]), ['tapo3']);
});
