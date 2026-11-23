'use strict';
// Home Assistant local, géré par FrHiOS sans intervention :
//  - attend que le conteneur réponde (http://127.0.0.1:8123)
//  - au tout premier démarrage, fait l'« onboarding » à la place de l'utilisateur : compte
//    administrateur (mot de passe aléatoire), réglages France, jeton d'accès longue durée
//  - ensuite, sert d'intermédiaire pour ajouter des appareils (« config flows » de Home Assistant :
//    Tapo, télé, Matter…) depuis l'interface tactile, sans passer par l'interface web de HA.
//
// Les identifiants sont gardés dans <userData>/home-assistant.json (droits 0600).
// Documentation des API utilisées : code source de homeassistant/components/{onboarding,auth,config}.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');

const HA_URL = 'http://127.0.0.1:8123';
// Même « client_id » que l'interface web de HA ouverte à cette adresse : le jeton de rafraîchissement
// obtenu ici peut donc aussi servir à ouvrir l'administration déjà connectée (voir adminTokens()).
const CLIENT_ID = `${HA_URL}/`;
const MATTER_URL = 'ws://127.0.0.1:5580/ws';

const HANDLER_RE = /^[a-z0-9_]{1,64}$/;
const FLOW_ID_RE = /^[A-Za-z0-9]{8,64}$/;
const ENTRY_ID_RE = /^[A-Za-z0-9]{8,64}$/;

class HAError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

/* ------------------------- HTTP / WebSocket ------------------------- */

async function http(method, url, { token, json, form, timeout = 15000 } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let body;
  if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString(); }
  const res = await fetch(HA_URL + url, { method, headers, body, signal: AbortSignal.timeout(timeout) });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = (data && (data.message || data.error_description || data.error)) || `HTTP ${res.status}`;
    throw new HAError(String(msg), res.status);
  }
  return data;
}

// Petite session WebSocket : authentification, puis requêtes { type, ... } -> résultat
function wsSession(url, token) {
  return new Promise((resolve, reject) => {
    if (typeof WebSocket !== 'function') { reject(new Error('WebSocket indisponible')); return; }
    const ws = new WebSocket(url);
    const pending = new Map();
    let nextId = 1;
    const timer = setTimeout(() => { reject(new Error('Délai dépassé (WebSocket)')); try { ws.close(); } catch { /* */ } }, 15000);

    const session = {
      request(payload, timeoutMs = 30000) {
        return new Promise((res, rej) => {
          const id = nextId++;
          const t = setTimeout(() => { pending.delete(id); rej(new Error('Délai dépassé')); }, timeoutMs);
          pending.set(id, { res, rej, t });
          ws.send(JSON.stringify({ id, ...payload }));
        });
      },
      close() { try { ws.close(); } catch { /* déjà fermé */ } },
    };

    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: token }));
      else if (msg.type === 'auth_ok') { clearTimeout(timer); resolve(session); }
      else if (msg.type === 'auth_invalid') { clearTimeout(timer); reject(new HAError('Jeton refusé', 401)); ws.close(); }
      else if (msg.type === 'result') {
        const p = pending.get(msg.id);
        if (!p) return;
        pending.delete(msg.id);
        clearTimeout(p.t);
        if (msg.success) p.res(msg.result);
        else p.rej(new HAError(msg.error?.message || msg.error?.code || 'Erreur Home Assistant'));
      }
    };
    ws.onerror = () => { clearTimeout(timer); reject(new Error('Connexion WebSocket impossible')); };
    ws.onclose = () => {
      pending.forEach((p) => { clearTimeout(p.t); p.rej(new Error('Connexion fermée')); });
      pending.clear();
    };
  });
}

/* ------------------------- Gestionnaire ------------------------- */

class LocalHA extends EventEmitter {
  constructor(file) {
    super();
    this.file = file;
    this.creds = this.#read();          // { username, password, refreshToken, token }
    this.access = null;                 // { token, expires } jeton court (rafraîchi au besoin)
    this.status = { state: 'waiting', message: 'Démarrage de Home Assistant…' };
    this.timer = null;
    this.running = false;
  }

  /* ---- stockage ---- */

  #read() {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')) || {}; } catch { return {}; }
  }

  #write() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.creds, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  #setStatus(state, message = '') {
    if (this.status.state === state && this.status.message === message) return;
    this.status = { state, message };
    this.emit('status', this.publicStatus());
  }

  // Ce que l'interface a le droit de savoir. Le mot de passe sert à se connecter à l'administration
  // web de HA si besoin (affiché dans Réglages, l'appareil est à la maison).
  publicStatus() {
    return {
      ...this.status,
      url: HA_URL,
      token: this.status.state === 'ready' ? this.creds.token : null,
      username: this.creds.username || null,
      password: this.creds.password || null,
    };
  }

  /* ---- boucle de surveillance ---- */

  start() {
    if (this.running) return;
    this.running = true;
    const loop = async () => {
      let delay = 5000;
      try {
        await this.#check();
        if (this.status.state === 'ready') delay = 60000;   // juste une vérification de temps en temps
      } catch (err) {
        if (err.status === undefined) this.#setStatus('waiting', 'Démarrage de Home Assistant…');
        else this.#setStatus('error', err.message);
      }
      if (this.running) this.timer = setTimeout(loop, delay);
    };
    loop();
  }

  stop() { this.running = false; clearTimeout(this.timer); }

  async #check() {
    // Une fois la configuration initiale terminée, HA n'expose plus /api/onboarding (404) :
    // c'est le cas normal à chaque démarrage après le premier.
    let steps = null;
    try {
      steps = await http('GET', '/api/onboarding', { timeout: 5000 });
    } catch (err) {
      if (err.status !== 404) throw err;
    }
    const done = new Set((Array.isArray(steps) ? steps : []).filter((s) => s.done).map((s) => s.step));
    const all = !Array.isArray(steps) || steps.every((s) => s.done);

    if (!all) await this.#onboard(done);

    if (!this.creds.token) {
      if (this.creds.refreshToken) {
        await this.#createLongLivedToken();
      } else {
        // Quelqu'un a déjà créé le compte à la main (interface web) : on ne peut pas deviner le jeton
        this.#setStatus('foreign', 'Home Assistant a été configuré à la main : saisissez un jeton dans Réglages.');
        return;
      }
    }

    // Le jeton est-il toujours valable ?
    try {
      await http('GET', '/api/', { token: this.creds.token, timeout: 5000 });
    } catch (err) {
      if (err.status === 401) {
        this.creds.token = null;
        this.#write();
        if (this.creds.refreshToken) { await this.#createLongLivedToken(); }
        else { this.#setStatus('foreign', 'Jeton refusé par Home Assistant.'); return; }
      } else throw err;
    }
    this.#setStatus('ready', 'Home Assistant · local');
  }

  /* ---- premier démarrage ---- */

  async #onboard(done) {
    this.#setStatus('setup', 'Configuration initiale de Home Assistant…');

    if (!done.has('user')) {
      const password = crypto.randomBytes(18).toString('base64url');
      const username = 'frhios';
      const r = await http('POST', '/api/onboarding/users', {
        json: { name: 'FrHiOS', username, password, client_id: CLIENT_ID, language: 'fr' },
      });
      // Enregistré tout de suite : si la suite échoue, on pourra toujours se connecter
      this.creds = { username, password };
      this.#write();
      const tok = await http('POST', '/auth/token', {
        form: { grant_type: 'authorization_code', code: r.auth_code, client_id: CLIENT_ID },
      });
      this.creds.refreshToken = tok.refresh_token;
      this.access = { token: tok.access_token, expires: Date.now() + (tok.expires_in - 60) * 1000 };
      this.#write();
    }

    if (!this.creds.refreshToken) return; // compte créé par quelqu'un d'autre : voir #check()
    const token = await this.#accessToken();

    for (const step of ['core_config', 'analytics']) {
      if (!done.has(step)) await http('POST', `/api/onboarding/${step}`, { token, json: {} }).catch(ignore403);
    }
    if (!done.has('integration')) {
      await http('POST', '/api/onboarding/integration', {
        token, json: { client_id: CLIENT_ID, redirect_uri: `${HA_URL}/?auth_callback=1` },
      }).catch(ignore403);
    }

    // Réglages régionaux (facultatif : on continue si refusé)
    try {
      const ws = await wsSession(`${HA_URL.replace(/^http/, 'ws')}/api/websocket`, token);
      try {
        await ws.request({
          type: 'config/core/update',
          country: 'FR', language: 'fr', time_zone: 'Europe/Paris', unit_system: 'metric', currency: 'EUR',
        });
      } finally { ws.close(); }
    } catch { /* pas grave */ }
  }

  async #accessToken() {
    if (this.access && this.access.expires > Date.now()) return this.access.token;
    const tok = await http('POST', '/auth/token', {
      form: { grant_type: 'refresh_token', refresh_token: this.creds.refreshToken, client_id: CLIENT_ID },
    });
    this.access = { token: tok.access_token, expires: Date.now() + (tok.expires_in - 60) * 1000 };
    return this.access.token;
  }

  async #createLongLivedToken() {
    const ws = await wsSession(`${HA_URL.replace(/^http/, 'ws')}/api/websocket`, await this.#accessToken());
    try {
      this.creds.token = await ws.request({ type: 'auth/long_lived_access_token', client_name: 'FrHiOS', lifespan: 3650 });
      this.#write();
    } finally { ws.close(); }
  }

  // Jetons au format attendu par l'interface web de HA (localStorage « hassTokens ») : l'administration
  // s'ouvre déjà connectée.
  async adminTokens() {
    if (!this.creds.refreshToken) return null;
    try {
      const token = await this.#accessToken();
      return {
        hassUrl: HA_URL,
        clientId: CLIENT_ID,
        access_token: token,
        refresh_token: this.creds.refreshToken,
        token_type: 'Bearer',
        expires_in: Math.max(60, Math.round((this.access.expires - Date.now()) / 1000)),
        expires: this.access.expires,
      };
    } catch { return null; }
  }

  /* ---- ajout d'appareils (config flows) ---- */

  #token() {
    if (this.status.state !== 'ready' || !this.creds.token) throw new Error('Home Assistant n’est pas prêt');
    return this.creds.token;
  }

  async #ws(payload) {
    const ws = await wsSession(`${HA_URL.replace(/^http/, 'ws')}/api/websocket`, this.#token());
    try { return await ws.request(payload, 120000); } finally { ws.close(); }
  }

  // Appareils découverts par HA (en attente de confirmation) + intégrations déjà configurées
  async overview() {
    const token = this.#token();
    const [progress, entries] = await Promise.all([
      this.#ws({ type: 'config_entries/flow/progress' }).catch(() => []),
      http('GET', '/api/config/config_entries/entry', { token }),
    ]);
    return {
      discovered: (progress || []).map((f) => ({
        flowId: f.flow_id,
        handler: f.handler,
        stepId: f.step_id,
        source: f.context?.source || '',
        name: f.context?.title_placeholders?.name || '',
      })),
      entries: (entries || [])
        .filter((e) => e.source !== 'system' && !['ignore'].includes(e.source))
        .map((e) => ({ entryId: e.entry_id, domain: e.domain, title: e.title, state: e.state })),
    };
  }

  async startFlow(handler) {
    if (!HANDLER_RE.test(String(handler))) throw new Error('Intégration invalide');
    return http('POST', '/api/config/config_entries/flow', {
      token: this.#token(), json: { handler, show_advanced_options: false }, timeout: 60000,
    });
  }

  async flowStep(flowId, data) {
    if (!FLOW_ID_RE.test(String(flowId))) throw new Error('Étape invalide');
    const body = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    if (JSON.stringify(body).length > 8192) throw new Error('Données trop longues');
    return http('POST', `/api/config/config_entries/flow/${flowId}`, { token: this.#token(), json: body, timeout: 120000 });
  }

  async getFlow(flowId) {
    if (!FLOW_ID_RE.test(String(flowId))) throw new Error('Étape invalide');
    return http('GET', `/api/config/config_entries/flow/${flowId}`, { token: this.#token() });
  }

  async abortFlow(flowId) {
    if (!FLOW_ID_RE.test(String(flowId))) return;
    await http('DELETE', `/api/config/config_entries/flow/${flowId}`, { token: this.#token() }).catch(() => {});
  }

  async deleteEntry(entryId) {
    if (!ENTRY_ID_RE.test(String(entryId))) throw new Error('Intégration invalide');
    return http('DELETE', `/api/config/config_entries/entry/${entryId}`, { token: this.#token() });
  }

  // Textes en français des formulaires (titres, champs, erreurs) d'une ou plusieurs intégrations
  async translations(domains) {
    const list = (Array.isArray(domains) ? domains : []).filter((d) => HANDLER_RE.test(String(d))).slice(0, 20);
    if (!list.length) return {};
    const r = await this.#ws({ type: 'frontend/get_translations', language: 'fr', category: 'config', integration: list, config_flow: true });
    return r?.resources || {};
  }

  /* ---- Matter (LEDs et appareils compatibles) ---- */

  async #ensureMatterEntry() {
    const entries = await http('GET', '/api/config/config_entries/entry?domain=matter', { token: this.#token() });
    if ((entries || []).some((e) => e.domain === 'matter' && e.state === 'loaded')) return;
    let step = await this.startFlow('matter');
    for (let i = 0; i < 4 && step?.type === 'form'; i++) {
      step = await this.flowStep(step.flow_id, step.step_id === 'manual' ? { url: MATTER_URL } : {});
    }
    if (step?.type === 'abort' && step.reason !== 'already_configured' && step.reason !== 'single_instance_allowed') {
      throw new Error(`Serveur Matter indisponible (${step.reason})`);
    }
    if (step?.type === 'form') throw new Error('Serveur Matter injoignable');
  }

  // Les identifiants Wi-Fi ne servent qu'aux appareils neufs (appairage par Bluetooth) : ils sont
  // transmis au serveur Matter local, qui les donne à l'appareil.
  async #matterWifi(ssid, password) {
    const ws = new WebSocket(MATTER_URL);
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => { reject(new Error('Serveur Matter injoignable')); ws.close(); }, 10000);
      let greeted = false;
      ws.onmessage = (ev) => {
        let msg; try { msg = JSON.parse(ev.data); } catch { return; }
        if (!greeted) {           // premier message : informations sur le serveur
          greeted = true;
          ws.send(JSON.stringify({ message_id: 'wifi', command: 'set_wifi_credentials', args: { ssid, credentials: password } }));
          return;
        }
        if (msg.message_id === 'wifi') {
          clearTimeout(t); ws.close();
          if (msg.error_code) reject(new Error(msg.details || 'Identifiants Wi-Fi refusés')); else resolve();
        }
      };
      ws.onerror = () => { clearTimeout(t); reject(new Error('Serveur Matter injoignable')); };
    });
  }

  async matterCommission({ code, ssid, password } = {}) {
    const c = String(code || '').replace(/[\s-]/g, '');
    if (!/^(\d{11}|\d{21}|MT:[0-9A-Z.\-]{10,})$/.test(c)) throw new Error('Code d’appairage invalide (11 chiffres ou code QR « MT:… »)');
    await this.#ensureMatterEntry();
    const ble = Boolean(ssid);
    if (ble) {
      if (typeof ssid !== 'string' || ssid.length > 32 || typeof password !== 'string' || password.length > 63) {
        throw new Error('Nom de réseau ou mot de passe invalide');
      }
      await this.#matterWifi(ssid, password);
    }
    await this.#ws({ type: 'matter/commission', code: c, network_only: !ble });
    return { ok: true };
  }
}

function ignore403(err) { if (err.status !== 403) throw err; }

module.exports = { LocalHA, HA_URL };
