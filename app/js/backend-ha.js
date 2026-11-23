// Client Home Assistant via l'API WebSocket officielle.
// Doc : https://developers.home-assistant.io/docs/api/websocket
//
// Il faut un « jeton d'accès longue durée » : Home Assistant > Profil > Sécurité.
// Même interface que backend-mock.js.

const DOMAINS = new Set(['light', 'switch', 'media_player', 'remote']);

export class HABackend {
  constructor(url, token) {
    this.url = String(url || '').trim().replace(/\/+$/, '');
    this.token = String(token || '').trim();
    this.entities = new Map();   // entity_id -> entité normalisée
    this.rooms = new Map();      // entity_id -> nom de pièce
    this.changeCbs = new Set();
    this.statusCbs = new Set();
    this.pending = new Map();
    this.nextId = 1;
    this.ws = null;
    this.closed = false;
    this.everConnected = false;
  }

  onChange(cb) { this.changeCbs.add(cb); }
  onStatus(cb) { this.statusCbs.add(cb); }
  #emit() { this.changeCbs.forEach((cb) => cb()); }
  #status(kind, text) { this.statusCbs.forEach((cb) => cb(kind, text)); }

  get wsUrl() { return this.url.replace(/^http/i, 'ws') + '/api/websocket'; }

  connect() {
    if (!/^https?:\/\//i.test(this.url)) {
      return Promise.reject(new Error("Adresse invalide (ex. http://192.168.1.20:8123)"));
    }
    if (!this.token) return Promise.reject(new Error('Jeton d\'accès manquant'));

    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (fn, v) => { if (!settled) { settled = true; fn(v); } };

      let ws;
      try { ws = new WebSocket(this.wsUrl); } catch (e) { return reject(e); }
      this.ws = ws;

      ws.onmessage = async (ev) => {
        const msg = JSON.parse(ev.data);
        switch (msg.type) {
          case 'auth_required':
            ws.send(JSON.stringify({ type: 'auth', access_token: this.token }));
            break;
          case 'auth_invalid':
            this.closed = true; // inutile de réessayer avec un mauvais jeton
            done(reject, new Error('Jeton refusé par Home Assistant'));
            break;
          case 'auth_ok':
            try {
              await this.#init();
              this.everConnected = true;
              this.#status('ok', 'Home Assistant · connecté');
              done(resolve);
            } catch (e) { done(reject, e); }
            break;
          case 'result': {
            const p = this.pending.get(msg.id);
            if (p) {
              this.pending.delete(msg.id);
              msg.success ? p.resolve(msg.result) : p.reject(new Error(msg.error?.message || 'Erreur HA'));
            }
            break;
          }
          case 'event':
            if (msg.event?.event_type === 'state_changed') this.#onStateChanged(msg.event.data);
            break;
        }
      };

      ws.onerror = () => done(reject, new Error(`Connexion impossible à ${this.url}`));

      ws.onclose = () => {
        this.pending.forEach((p) => p.reject(new Error('Connexion fermée')));
        this.pending.clear();
        done(reject, new Error(`Connexion impossible à ${this.url}`));
        if (!this.closed && this.everConnected) {
          this.#status('err', 'Reconnexion…');
          setTimeout(() => { if (!this.closed) this.connect().catch(() => {}); }, 3000);
        }
      };
    });
  }

  close() {
    this.closed = true;
    try { this.ws?.close(); } catch { /* déjà fermé */ }
  }

  #request(payload) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, ...payload }));
    });
  }

  async #init() {
    // Pièces (« zones » dans Home Assistant) : facultatif, on n'échoue pas si refusé
    try {
      const [areas, devices, registry] = await Promise.all([
        this.#request({ type: 'config/area_registry/list' }),
        this.#request({ type: 'config/device_registry/list' }),
        this.#request({ type: 'config/entity_registry/list' }),
      ]);
      const areaName = new Map(areas.map((a) => [a.area_id, a.name]));
      const deviceArea = new Map(devices.map((d) => [d.id, d.area_id]));
      this.rooms.clear();
      for (const r of registry) {
        const area = r.area_id || deviceArea.get(r.device_id);
        if (area && areaName.has(area)) this.rooms.set(r.entity_id, areaName.get(area));
      }
    } catch { /* pas de pièces : tout ira dans « Sans pièce » */ }

    const states = await this.#request({ type: 'get_states' });
    this.entities.clear();
    states.forEach((s) => this.#upsert(s));
    await this.#request({ type: 'subscribe_events', event_type: 'state_changed' });
    this.#emit();
  }

  #upsert(s) {
    const domain = s.entity_id.split('.')[0];
    if (!DOMAINS.has(domain)) return;
    this.entities.set(s.entity_id, {
      id: s.entity_id,
      name: s.attributes?.friendly_name || s.entity_id,
      domain,
      state: s.state,
      room: this.rooms.get(s.entity_id) || null,
      attributes: s.attributes || {},
    });
  }

  #onStateChanged({ entity_id, new_state }) {
    if (new_state) this.#upsert(new_state);
    else this.entities.delete(entity_id);
    this.#emit();
  }

  getEntities() { return [...this.entities.values()]; }

  async call(domain, service, entityId, data = {}) {
    await this.#request({
      type: 'call_service',
      domain,
      service,
      service_data: data,
      target: { entity_id: entityId },
    });
  }
}
