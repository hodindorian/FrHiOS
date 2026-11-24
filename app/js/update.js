// Section « Mises à jour » des Réglages : version installée, recherche et installation d'une nouvelle
// version de l'application depuis GitHub (voir electron/updater.js). Absente hors Electron.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const frDate = (iso) => { try { return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }); } catch { return ''; } };

export function mountUpdate(box, { toast } = {}) {
  const api = window.frhios?.update;
  if (!api) { box.innerHTML = ''; return; }

  let st = null;        // état renvoyé par le processus principal
  let progress = '';    // étape en cours pendant l'installation
  let installing = false;
  let restarting = false;
  let message = '';

  const unsubProgress = api.onProgress?.((text) => { progress = text; if (installing) draw(); });

  function versionLine() {
    const c = st?.current;
    if (!c) return '';
    const origin = c.source === 'update' ? 'mise à jour' : 'installée avec l’ISO';
    const parts = [`<b>${esc(c.label)}</b> (${origin}${c.dirty ? ', avec modifications locales' : ''})`];
    if (c.date) parts.push(frDate(c.date));
    if (c.message) parts.push(`« ${esc(c.message)} »`);
    return `<p class="hint">Version actuelle : ${parts.join(' · ')}</p>`;
  }

  function statusBlock() {
    if (restarting) return '<p class="hint notice">Mise à jour installée. L’interface redémarre dans quelques secondes…</p>';
    if (installing) return `<p class="hint notice">${esc(progress || 'Installation…')}</p>`;
    if (!st) return '<p class="hint">Lecture de l’état…</p>';
    switch (st.state) {
      case 'unsupported': return `<p class="hint">${esc(st.error)}</p>`;
      case 'uptodate': return `<p class="hint">✦ Vous avez la dernière version publiée${st.remote?.tag ? ` (${esc(st.remote.tag)})` : ''}.</p>`;
      case 'none': return '<p class="hint">Aucune version publiée pour l’instant. Les mises à jour suivent les <b>tags</b> du dépôt GitHub (par exemple <code>v1.0.0</code>).</p>';
      case 'available': return `
        <p class="hint notice">Nouvelle version publiée : <b>${esc(st.remote.tag)}</b></p>
        ${st.remote.changes.length ? `<ul class="changes">${st.remote.changes.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
        <button class="btn primary" data-u="apply">Installer et redémarrer</button>`;
      case 'bad':
      case 'error': return `<p class="hint err-text">${esc(st.error)}</p>`;
      default: return '<p class="hint">Aucune recherche effectuée.</p>';
    }
  }

  function draw() {
    if (!box.isConnected) { unsubProgress?.(); return; }
    const disabled = installing || restarting || st?.busy || st?.supported === false;
    box.innerHTML = `
      <div class="field-label"><span>Mises à jour de FrHiOS</span></div>
      ${versionLine()}
      ${statusBlock()}
      ${message ? `<p class="hint err-text">${esc(message)}</p>` : ''}
      <button class="btn" data-u="check" ${disabled ? 'disabled' : ''}>Rechercher une mise à jour</button>
      <p class="hint">Ne met à jour que l’application. Pour les paquets du système, utilisez la commande <code>upg</code> du terminal.</p>`;
  }

  box.addEventListener('click', async (ev) => {
    const act = ev.target.closest('[data-u]')?.dataset.u;
    if (act === 'check') {
      message = '';
      st = { ...(st || {}), busy: true };
      progress = 'Recherche…';
      draw();
      st = await api.check();
      draw();
    } else if (act === 'apply') {
      message = '';
      installing = true;
      progress = 'Démarrage…';
      draw();
      const r = await api.apply();
      installing = false;
      if (r.ok) { restarting = true; toast?.('Mise à jour installée : redémarrage…'); } else { message = r.error; }
      draw();
    }
  });

  draw();
  api.status().then((s) => { st = s; draw(); });
}
