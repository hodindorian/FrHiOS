// Page « Connecter des appareils » : ajoute des appareils au Home Assistant local sans passer par
// son interface web. Elle pilote les « config flows » de HA (formulaires étape par étape décrits
// par HA lui-même) via le processus principal (window.frhios.ha, voir electron/ha-local.js).
//
// Les appareils de la maison (scan du réseau du 23/11/2026) sont proposés en un geste, adresse
// déjà remplie : il ne reste que le code affiché sur la télé ou le compte Tapo à saisir.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Adresses fixées par bail DHCP dans la Bbox conseillé : sinon elles peuvent changer (HA retrouve
// quand même les appareils, ces raccourcis servent seulement à pré-remplir l'adresse).
export const HOME_DEVICES = [
  { id: 'tv', name: 'Télé du salon', detail: 'Philips 55OLED809 · 192.168.1.123', handler: 'androidtv_remote',
    values: { host: '192.168.1.123' }, hint: 'Marche/arrêt, volume, flèches, applis. Un code s’affiche sur la télé.' },
  { id: 'ambilight', name: 'Ambilight de la télé', detail: 'Philips · API JointSPACE 6', handler: 'philips_js',
    values: { host: '192.168.1.123', api_version: '6' }, hint: 'LEDs Ambilight. Un autre code s’affiche sur la télé.' },
  { id: 'tapo1', name: 'Prise Tapo', detail: 'P100 · 192.168.1.15', handler: 'tplink', values: { host: '192.168.1.15' } },
  { id: 'tapo2', name: 'Prise Tapo', detail: 'P100 · 192.168.1.34', handler: 'tplink', values: { host: '192.168.1.34' } },
  { id: 'tapo3', name: 'Ampoule Tapo', detail: 'L530 · 192.168.1.154', handler: 'tplink', values: { host: '192.168.1.154' } },
];

const OTHER = [
  { handler: 'tplink', name: 'Prise ou ampoule Tapo / Kasa' },
  { handler: 'androidtv_remote', name: 'Télé Android / Google TV' },
  { handler: 'philips_js', name: 'Télé Philips (Ambilight)' },
  { handler: 'cast', name: 'Chromecast / enceinte Google' },
  { handler: 'wled', name: 'Ruban LED WLED (contrôleur Wi-Fi local)' },
];

const DOMAIN_NAMES = {
  tplink: 'TP-Link · Tapo', androidtv_remote: 'Android TV', philips_js: 'Philips TV',
  matter: 'Matter', cast: 'Google Cast', met: 'Météo', radio_browser: 'Radios',
  shopping_list: 'Liste de courses', google_translate: 'Synthèse vocale', sun: 'Soleil',
  hassio: 'Supervisor', backup: 'Sauvegardes', go2rtc: 'Flux vidéo', thread: 'Thread',
  dlna_dmr: 'Lecteur DLNA', wled: 'WLED', upnp: 'Box (UPnP)', spotify: 'Spotify', alexa_devices: 'Amazon Alexa',
};
// Intégrations techniques ajoutées d'office par HA : inutile de les montrer
const HIDDEN_DOMAINS = new Set(['sun', 'met', 'radio_browser', 'shopping_list', 'google_translate', 'backup', 'go2rtc', 'hassio']);

const LABELS = {
  host: 'Adresse IP', pin: 'Code affiché sur la télé', username: 'E-mail du compte', password: 'Mot de passe',
  api_version: 'Version de l’API', url: 'Adresse du serveur', device: 'Appareil', name: 'Nom', code: 'Code',
};
const MESSAGES = {
  already_configured: 'Cet appareil est déjà connecté.',
  already_in_progress: 'Un ajout est déjà en cours pour cet appareil (voir « Détectés automatiquement »).',
  cannot_connect: 'Connexion impossible. L’appareil est-il allumé et sur le même réseau ?',
  invalid_auth: 'Code ou identifiants incorrects.',
  invalid_host: 'Adresse invalide.',
  no_devices_found: 'Aucun appareil trouvé sur le réseau.',
  single_instance_allowed: 'Déjà configuré.',
  unknown: 'Erreur inconnue.',
};

const domainName = (d) => DOMAIN_NAMES[d] || d;

// Un seul écouteur IPC pour toute l'application ; les pages s'y abonnent et se désabonnent.
const statusListeners = new Set();
let statusHooked = false;
export function onHaStatus(cb) {
  if (!statusHooked && window.frhios?.ha?.onStatus) {
    statusHooked = true;
    window.frhios.ha.onStatus((st) => statusListeners.forEach((fn) => fn(st)));
  }
  statusListeners.add(cb);
  return () => statusListeners.delete(cb);
}

export function mountSetup(box, { toast } = {}) {
  const api = window.frhios?.ha;
  if (!api) {
    box.innerHTML = '<h1>Connecter des appareils</h1><div class="empty">Disponible uniquement dans l’application FrHiOS.</div>';
    return;
  }

  const tr = {};            // traductions par intégration
  let mode = 'overview';    // 'overview' | 'flow' | 'busy' | 'matter'
  let status = null;
  let data = null;          // { discovered, entries }
  let flow = null;          // étape en cours (réponse de HA)
  let preset = {};          // valeurs pré-remplies (appareil de la maison)
  let values = {};          // choix faits dans les listes du formulaire
  let busyText = '';
  let message = '';
  let confirmDelete = null;
  let matterNew = false;
  let alive = true;
  let pollTimer = null;
  let unsubscribe = null;

  const unwrap = (r) => { if (!r?.ok) throw new Error(r?.error || 'Erreur'); return r.result; };
  const t = (domain, key) => tr[domain]?.[`component.${domain}.config.${key}`];

  async function loadTranslations(domains) {
    const missing = [...new Set(domains)].filter((d) => !tr[d]);
    if (!missing.length) return;
    try {
      const res = unwrap(await api.translations(missing));
      missing.forEach((d) => { tr[d] = res; });
    } catch { missing.forEach((d) => { tr[d] = {}; }); }
  }

  async function refresh() {
    status = unwrap(await api.status());
    if (status.state !== 'ready') { data = null; draw(); return; }
    data = unwrap(await api.overview());
    await loadTranslations(data.discovered.map((f) => f.handler));
    draw();
  }

  /* ---------------- étapes d'un ajout ---------------- */

  function busy(text) { mode = 'busy'; busyText = text; draw(); }

  async function start(handler, presetValues = {}) {
    preset = presetValues;
    values = {};
    message = '';
    busy('Recherche de l’appareil…');
    try {
      await loadTranslations([handler]);
      await show(unwrap(await api.startFlow(handler)), true);
    } catch (err) { back(`Échec : ${err.message}`); }
  }

  async function resume(flowId, handler) {
    preset = {};
    values = {};
    message = '';
    busy('Ouverture…');
    try {
      await loadTranslations([handler]);
      await show(unwrap(await api.getFlow(flowId)), false);
    } catch (err) { back(`Échec : ${err.message}`); }
  }

  // Affiche une étape. autoFill : si tous les champs demandés sont déjà connus (adresse…),
  // l'étape est validée sans rien demander.
  async function show(step, autoFill) {
    if (!alive) return;
    flow = step;
    clearTimeout(pollTimer);

    if (step.type === 'form') {
      const fields = (step.data_schema || []).filter((f) => f.type !== 'constant');
      const hasErrors = step.errors && Object.keys(step.errors).length;
      if (autoFill && !hasErrors && fields.length && fields.every((f) => f.name in preset)) {
        const payload = {};
        fields.forEach((f) => { payload[f.name] = preset[f.name]; });
        return submit(payload);
      }
      values = {};
      mode = 'flow';
      draw();
      return;
    }
    if (step.type === 'progress') {
      mode = 'busy';
      busyText = t(step.handler, `progress.${step.progress_action}`) || 'Patientez…';
      draw();
      pollTimer = setTimeout(async () => {
        try { await show(unwrap(await api.getFlow(step.flow_id)), false); } catch (err) { back(`Échec : ${err.message}`); }
      }, 2000);
      return;
    }
    if (step.type === 'menu') { mode = 'flow'; draw(); return; }
    if (step.type === 'create_entry') {
      toast?.(`Connecté : ${step.title || domainName(step.handler)}`);
      back(`« ${step.title || domainName(step.handler)} » est connecté. Ses commandes apparaissent dans Appareils.`);
      return;
    }
    if (step.type === 'abort') {
      const reason = step.reason || 'unknown';
      back(fill(t(step.handler, `abort.${reason}`) || MESSAGES[reason] || `Ajout interrompu (${reason}).`,
        step.description_placeholders));
      return;
    }
    if (step.type === 'external' || step.type === 'external_step') {
      api.abortFlow(step.flow_id);
      back('Cet appareil demande une connexion dans un navigateur : utilisez l’administration de Home Assistant (Réglages).');
      return;
    }
    back(`Étape non prise en charge (${step.type}).`);
  }

  async function submit(payload) {
    const f = flow;
    busy(f.handler === 'androidtv_remote' || f.handler === 'philips_js' ? 'Connexion à la télé…' : 'Connexion…');
    try {
      await show(unwrap(await api.flowStep(f.flow_id, payload)), true);
    } catch (err) {
      // L'étape est toujours valable : on la réaffiche avec l'erreur
      flow = { ...f, errors: { base: 'unknown' } };
      message = err.message;
      mode = 'flow';
      draw();
    }
  }

  function cancel() {
    if (flow?.flow_id && mode === 'flow') api.abortFlow(flow.flow_id);
    back('');
  }

  function back(msg) {
    clearTimeout(pollTimer);
    flow = null;
    mode = 'overview';
    message = msg;
    draw();
    refresh().catch(() => {});
  }

  /* ---------------- formulaire ---------------- */

  function fieldKind(f) {
    const sel = f.selector && Object.keys(f.selector)[0];
    if (sel === 'text') return f.selector.text?.type === 'password' ? 'password' : 'text';
    if (sel === 'select') return 'select';
    if (sel === 'boolean') return 'boolean';
    if (sel === 'number') return 'number';
    if (f.type === 'select') return 'select';
    if (f.type === 'boolean') return 'boolean';
    if (f.type === 'integer' || f.type === 'float') return 'number';
    if (/password|pin/i.test(f.name) && !/^pin$/.test(f.name)) return 'password';
    return 'text';
  }

  function optionsOf(f) {
    const raw = f.selector?.select?.options ?? f.options ?? [];
    return raw.map((o) => (Array.isArray(o) ? { value: o[0], label: o[1] }
      : typeof o === 'object' ? { value: o.value, label: o.label ?? o.value } : { value: o, label: o }));
  }

  function currentValue(f) {
    if (f.name in values) return values[f.name];
    if (f.name in preset) return preset[f.name];
    return f.default ?? f.description?.suggested_value ?? '';
  }

  function fieldHTML(f, domain, stepId) {
    const label = t(domain, `step.${stepId}.data.${f.name}`) || LABELS[f.name] || f.name;
    const help = t(domain, `step.${stepId}.data_description.${f.name}`);
    const kind = fieldKind(f);
    const err = flow.errors?.[f.name];
    const errText = err ? `<p class="hint err-text">${esc(errorText(domain, err))}</p>` : '';
    const v = currentValue(f);
    let input;
    if (kind === 'select') {
      input = `<div class="opt-list">${optionsOf(f).map((o) => `
        <button type="button" class="wifi-item ${String(v) === String(o.value) ? 'active' : ''}"
                data-s="opt" data-field="${esc(f.name)}" data-value="${esc(o.value)}">${esc(o.label)}</button>`).join('')}</div>`;
    } else if (kind === 'boolean') {
      input = `<button type="button" class="btn" data-s="bool" data-field="${esc(f.name)}">${v ? 'Oui' : 'Non'}</button>`;
    } else {
      const numeric = kind === 'number' || f.name === 'pin';
      input = `<input class="text-input" data-field="${esc(f.name)}" data-kind="${kind}"
                 type="${kind === 'password' ? 'password' : 'text'}" ${numeric ? 'inputmode="numeric"' : ''}
                 autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(v)}">`;
    }
    return `<div><div class="field-label"><span>${esc(label)}${f.required ? '' : ' <span class="muted">(facultatif)</span>'}</span></div>
      ${input}${help ? `<p class="hint">${esc(help)}</p>` : ''}${errText}</div>`;
  }

  // Remplace les {variables} des textes de HA (ex. « Erreur de connexion : {error} ») par leurs valeurs,
  // envoyées à part dans description_placeholders ; une variable inconnue disparaît.
  function fill(text, placeholders) {
    let out = String(text || '');
    for (const [k, v] of Object.entries(placeholders || {})) out = out.split(`{${k}}`).join(String(v ?? ''));
    return out.replace(/\s*\{[a-z_]+\}/gi, '').replace(/\s*:\s*$/, '');
  }

  function errorText(domain, code) {
    const raw = t(domain, `error.${code}`) || MESSAGES[code] || code;
    let text = fill(raw, flow.description_placeholders);
    // Tapo récents (chiffrement « TPAP ») : pas encore gérés par Home Assistant, voir README
    if (domain === 'tplink' && /TPAP|unsupported/i.test(JSON.stringify(flow.description_placeholders || {}))) {
      text += ' — Ce Tapo utilise le nouveau chiffrement « TPAP », pas encore géré : dans l’appli Tapo, '
        + 'activez Moi › Services tiers › « Compatibilité tierce », puis réessayez.';
    }
    return text;
  }

  function describe(domain, stepId, placeholders) {
    const text = fill(t(domain, `step.${stepId}.description`) || '', placeholders);
    return text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_`#]/g, '');
  }

  function flowHTML() {
    const f = flow;
    const domain = f.handler;
    const title = t(domain, `step.${f.step_id}.title`) || domainName(domain);
    const desc = describe(domain, f.step_id, f.description_placeholders);
    if (f.type === 'menu') {
      const opts = Array.isArray(f.menu_options) ? f.menu_options : Object.keys(f.menu_options || {});
      return `
        <h1>${esc(title)}</h1>
        ${desc ? `<p class="hint pre">${esc(desc)}</p>` : ''}
        <div class="opt-list">${opts.map((o) => `<button class="wifi-item" data-s="menu" data-value="${esc(o)}">
          ${esc(t(domain, `step.${f.step_id}.menu_options.${o}`) || (Array.isArray(f.menu_options) ? o : f.menu_options[o]))}</button>`).join('')}</div>
        <button class="btn" data-s="cancel" style="margin-top:1rem">Annuler</button>`;
    }
    const fields = (f.data_schema || []).filter((x) => x.type !== 'constant');
    const baseErr = f.errors?.base;
    return `
      <h1>${esc(title)}</h1>
      <form class="form" data-s="form">
        ${desc ? `<p class="hint pre">${esc(desc)}</p>` : ''}
        ${fields.map((x) => fieldHTML(x, domain, f.step_id)).join('')}
        ${baseErr ? `<p class="hint err-text">${esc(message || errorText(domain, baseErr))}</p>` : ''}
        <div class="inst-actions">
          <button class="btn" type="button" data-s="cancel">Annuler</button>
          <button class="btn primary" type="submit">${fields.length ? 'Valider' : 'Confirmer'}</button>
        </div>
      </form>`;
  }

  function collect() {
    const payload = {};
    for (const f of (flow.data_schema || []).filter((x) => x.type !== 'constant')) {
      const kind = fieldKind(f);
      let v;
      if (kind === 'select' || kind === 'boolean') v = currentValue(f);
      else {
        v = box.querySelector(`[data-field="${CSS.escape(f.name)}"]`)?.value ?? '';
        if (kind !== 'password') v = v.trim();
        if (kind === 'number' && v !== '') v = Number(v.replace(',', '.'));
      }
      if (v === '' && !f.required) continue;
      if (kind === 'boolean') v = Boolean(v);
      payload[f.name] = v;
    }
    return payload;
  }

  /* ---------------- Matter ---------------- */

  function matterHTML() {
    return `
      <h1>Appareil Matter</h1>
      <form class="form" data-s="matter-form">
        <p class="hint">Pour les LEDs et appareils portant le logo Matter. Le code d’appairage est sous le
          code QR (11 chiffres), sur l’appareil ou sa boîte. Si l’appareil est déjà installé dans une autre
          appli (Alexa, Google Home, appli du fabricant…), choisissez « Partager » / « Associer à une autre
          appli » dans cette appli pour obtenir un nouveau code.</p>
        <div><div class="field-label"><span>Code d’appairage</span></div>
          <input class="text-input" id="mt-code" inputmode="numeric" autocomplete="off" spellcheck="false"
                 placeholder="1234-567-8901 ou MT:…"></div>
        <div class="switch-row">
          <span>Appareil neuf <span class="muted">(jamais installé : appairage par Bluetooth)</span></span>
          <button type="button" class="btn" data-s="mt-new">${matterNew ? 'Oui' : 'Non'}</button>
        </div>
        ${matterNew ? `
          <p class="hint">L’appareil a besoin du Wi-Fi de la maison (2,4 GHz). Ces informations ne sont
            transmises qu’à l’appareil, via le serveur Matter local.</p>
          <div><div class="field-label"><span>Nom du réseau Wi-Fi</span></div>
            <input class="text-input" id="mt-ssid" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
          <div><div class="field-label"><span>Mot de passe Wi-Fi</span></div>
            <input class="text-input" id="mt-pw" type="password" autocomplete="off" autocapitalize="off" spellcheck="false"></div>` : ''}
        ${message ? `<p class="hint err-text">${esc(message)}</p>` : ''}
        <div class="inst-actions">
          <button class="btn" type="button" data-s="back">Retour</button>
          <button class="btn primary" type="submit">Appairer</button>
        </div>
      </form>`;
  }

  async function commission() {
    const code = box.querySelector('#mt-code')?.value.trim();
    const ssid = matterNew ? box.querySelector('#mt-ssid')?.value.trim() : undefined;
    const password = matterNew ? box.querySelector('#mt-pw')?.value : undefined;
    busy(matterNew ? 'Appairage Bluetooth en cours (jusqu’à 2 minutes)…' : 'Appairage en cours…');
    const r = await api.matterCommission({ code, ssid, password });
    if (r.ok) { toast?.('Appareil Matter ajouté'); back('Appareil Matter ajouté. Il apparaît dans Appareils.'); return; }
    mode = 'matter';
    message = r.error;
    draw();
  }

  /* ---------------- vue d'ensemble ---------------- */

  function statusHTML() {
    if (!status) return '<div class="empty">Lecture de l’état de Home Assistant…</div>';
    if (status.state === 'ready') return '';
    if (status.state === 'foreign') {
      return `<div class="empty">${esc(status.message)}<br>Ajoutez les appareils depuis l’administration de Home Assistant (Réglages).</div>`;
    }
    return `<div class="empty">${esc(status.message || 'Home Assistant démarre…')}<br>
      <span class="muted">Au tout premier démarrage, cela peut prendre quelques minutes.</span></div>`;
  }

  function overviewHTML() {
    const head = `<h1>Connecter des appareils</h1>${message ? `<p class="hint notice">${esc(message)}</p>` : ''}`;
    if (!status || status.state !== 'ready' || !data) return head + statusHTML();

    const discovered = data.discovered.filter((f) => !HIDDEN_DOMAINS.has(f.handler));
    const entries = data.entries.filter((e) => !HIDDEN_DOMAINS.has(e.domain));
    return `${head}
      ${discovered.length ? `
        <h2>Détectés automatiquement</h2>
        <div class="setup-list">${discovered.map((f) => `
          <button class="wifi-item" data-s="resume" data-flow="${esc(f.flowId)}" data-handler="${esc(f.handler)}">
            <span>${esc(f.name || domainName(f.handler))}</span><span class="muted">${esc(domainName(f.handler))} · Ajouter</span>
          </button>`).join('')}</div>` : ''}

      <h2>Appareils de la maison</h2>
      <div class="setup-list">${HOME_DEVICES.map((d) => `
        <button class="wifi-item" data-s="home" data-id="${d.id}">
          <span>${esc(d.name)} <span class="muted">· ${esc(d.detail)}</span>${d.hint ? `<br><span class="muted small">${esc(d.hint)}</span>` : ''}</span>
          <span class="muted">Connecter</span>
        </button>`).join('')}</div>

      <h2>LEDs et autres appareils</h2>
      <div class="setup-list">
        <button class="wifi-item" data-s="matter"><span>Appareil Matter <span class="muted">· LEDs, ampoules, prises au logo Matter</span></span><span class="muted">Appairer</span></button>
        ${OTHER.map((o) => `<button class="wifi-item" data-s="start" data-handler="${o.handler}"><span>${esc(o.name)}</span><span class="muted">Rechercher</span></button>`).join('')}
      </div>

      <h2>Déjà connectés${entries.length ? ` · ${entries.length}` : ''}</h2>
      ${entries.length ? `<div class="setup-list">${entries.map((e) => `
        <div class="wifi-item static">
          <span>${esc(e.title)} <span class="muted">· ${esc(domainName(e.domain))}${e.state === 'loaded' ? '' : ` · ${esc(e.state)}`}</span></span>
          <button class="btn ${confirmDelete === e.entryId ? 'danger' : ''}" data-s="delete" data-entry="${esc(e.entryId)}">
            ${confirmDelete === e.entryId ? 'Confirmer' : 'Retirer'}</button>
        </div>`).join('')}</div>` : '<div class="empty">Aucun appareil connecté pour l’instant.</div>'}`;
  }

  function draw() {
    if (!alive || !box.isConnected) { alive = false; clearTimeout(pollTimer); unsubscribe?.(); return; }
    if (mode === 'busy') box.innerHTML = `<h1>Connexion</h1><div class="empty">${esc(busyText)}</div>`;
    else if (mode === 'flow' && flow) box.innerHTML = flowHTML();
    else if (mode === 'matter') box.innerHTML = matterHTML();
    else box.innerHTML = overviewHTML();
    if (mode === 'flow') box.querySelector('input.text-input')?.focus();
  }

  /* ---------------- événements ---------------- */

  box.addEventListener('click', async (ev) => {
    const el = ev.target.closest('[data-s]');
    if (!el) return;
    switch (el.dataset.s) {
      case 'home': {
        const d = HOME_DEVICES.find((x) => x.id === el.dataset.id);
        if (d) start(d.handler, d.values);
        break;
      }
      case 'start': start(el.dataset.handler); break;
      case 'resume': resume(el.dataset.flow, el.dataset.handler); break;
      case 'cancel': cancel(); break;
      case 'back': back(''); break;
      case 'opt': values[el.dataset.field] = el.dataset.value; draw(); break;
      case 'bool': {
        const f = flow.data_schema.find((x) => x.name === el.dataset.field);
        values[el.dataset.field] = !currentValue(f);
        draw();
        break;
      }
      case 'menu': submit({ next_step_id: el.dataset.value }); break;
      case 'matter': mode = 'matter'; message = ''; draw(); break;
      case 'mt-new': {
        const code = box.querySelector('#mt-code')?.value;
        matterNew = !matterNew;
        draw();
        if (code) box.querySelector('#mt-code').value = code;
        break;
      }
      case 'delete': {
        const id = el.dataset.entry;
        if (confirmDelete !== id) { confirmDelete = id; draw(); break; }
        confirmDelete = null;
        const r = await api.deleteEntry(id);
        back(r.ok ? 'Appareil retiré.' : `Échec : ${r.error}`);
        break;
      }
    }
  });

  box.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (ev.target.dataset.s === 'form' && flow) { message = ''; submit(collect()); }
    else if (ev.target.dataset.s === 'matter-form') commission();
  });

  unsubscribe = onHaStatus(() => {
    if (!box.isConnected) { alive = false; unsubscribe(); return; }
    if (mode === 'overview') refresh().catch(() => {});
  });

  draw();
  refresh().catch((err) => { message = err.message; draw(); });
}
