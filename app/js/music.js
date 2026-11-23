// Page Musique : lecteurs web officiels intégrés (YouTube et Deezer).
//
// La page est construite UNE SEULE FOIS et seulement masquée quand on change d'onglet,
// pour que la musique continue pendant qu'on allume une lampe ou qu'on change de page.
// (Recréer ou déplacer une iframe la rechargerait et couperait le son.)
//
// - YouTube : lecteur intégré officiel (youtube-nocookie.com/embed).
// - Deezer  : « widget » officiel. Sans compte connecté dans ce navigateur, il ne lit
//   normalement que des extraits ; il n'existe pas d'API de lecture complète pour les apps tierces.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- Analyse des liens collés par l'utilisateur ---------- */

export function parseYouTube(input) {
  const s = String(input).trim();
  let video = null;
  let list = null;

  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^www\.|^m\.|^music\./, '');
    if (host === 'youtu.be') video = u.pathname.slice(1) || null;
    else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      video = u.searchParams.get('v') || (u.pathname.startsWith('/embed/') ? u.pathname.split('/')[2] : null);
    } else {
      return null;
    }
    list = u.searchParams.get('list');
  } catch {
    if (/^[\w-]{11}$/.test(s)) video = s;
    else if (/^(PL|OL|UU|RD|FL)[\w-]{10,}$/.test(s)) list = s;
  }

  if (video && !/^[\w-]{6,20}$/.test(video)) video = null;
  if (list && !/^[\w-]{10,60}$/.test(list)) list = null;
  if (!video && !list) return null;

  const base = 'https://www.youtube-nocookie.com/embed/';
  const embed = video
    ? `${base}${video}?autoplay=1&rel=0${list ? `&list=${list}` : ''}`
    : `${base}videoseries?list=${list}&autoplay=1&rel=0`;

  return {
    kind: 'youtube',
    embed,
    title: list && !video ? `Playlist YouTube …${list.slice(-4)}` : `Vidéo YouTube …${video.slice(-4)}`,
    watchUrl: video ? `https://www.youtube.com/watch?v=${video}` : null,
  };
}

export function parseDeezer(input) {
  const m = String(input).match(/deezer\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(playlist|album|track|artist)\/(\d+)/i);
  if (!m) return null;
  const [, type, id] = m;
  const label = { playlist: 'Playlist', album: 'Album', track: 'Titre', artist: 'Artiste' }[type.toLowerCase()];
  return {
    kind: 'deezer',
    embed: `https://widget.deezer.com/widget/dark/${type.toLowerCase()}/${id}?autoplay=true&tracklist=true`,
    title: `${label} Deezer …${id.slice(-4)}`,
  };
}

/* ---------- Page ---------- */

export function createMusicPage(root, settings, persist) {
  let tab = settings.musicTab === 'deezer' ? 'deezer' : 'youtube';
  let playingId = null;

  root.innerHTML = `
    <h1>Musique</h1>
    <div class="tabs" role="tablist">
      <button data-tab="youtube" role="tab">YouTube</button>
      <button data-tab="deezer" role="tab">Deezer</button>
    </div>
    <form class="add-row" data-role="form">
      <input class="text-input" data-role="input" type="text" inputmode="url"
             autocomplete="off" autocapitalize="off" spellcheck="false">
      <button class="btn primary" type="submit">Lire</button>
    </form>
    <p class="hint" data-role="hint"></p>
    <div data-role="player"></div>
    <h2>Favoris</h2>
    <div class="favs" data-role="favs"></div>
  `;

  const $ = (role) => root.querySelector(`[data-role="${role}"]`);
  const input = $('input');
  const hint = $('hint');

  const HINTS = {
    youtube: {
      placeholder: 'Collez un lien YouTube (vidéo ou playlist)',
      text: 'Collez le lien d’une vidéo ou d’une playlist YouTube. Elle est jouée avec le lecteur officiel et ajoutée à vos favoris.',
    },
    deezer: {
      placeholder: 'Collez un lien Deezer (playlist, album, titre, artiste)',
      text: 'Collez un lien deezer.com/…/playlist/123… (les liens courts « link.deezer.com » ne sont pas reconnus). Pour la lecture complète, connectez-vous à Deezer dans ce navigateur ; sinon ce sont des extraits.',
    },
  };

  function renderTabs() {
    root.querySelectorAll('[data-tab]').forEach((b) => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    });
    input.placeholder = HINTS[tab].placeholder;
    hint.textContent = HINTS[tab].text;
  }

  function renderFavs() {
    const items = settings.music.filter((m) => m.kind === tab);
    $('favs').innerHTML = items.length
      ? items.map((m) => `
          <div class="fav">
            <button data-play="${esc(m.id)}">${esc(m.title)}</button>
            <button class="x" data-del="${esc(m.id)}" aria-label="Supprimer">✕</button>
          </div>`).join('')
      : '<div class="hint">Aucun favori pour l’instant.</div>';
  }

  function play(item) {
    playingId = item.id;
    const cls = item.kind === 'youtube' ? 'yt' : 'dz';
    const box = $('player');
    // Créer l'iframe par DOM (pas innerHTML) : l'URL n'est jamais interprétée comme du HTML
    const frame = document.createElement('iframe');
    frame.className = `player ${cls}`;
    frame.src = item.embed;
    frame.allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture';
    frame.title = item.title;
    box.replaceChildren(frame);
  }

  async function fetchYouTubeTitle(item, watchUrl) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 4000);
      const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watchUrl)}`, { signal: ctl.signal });
      clearTimeout(t);
      if (!r.ok) return;
      const data = await r.json();
      if (data.title) {
        item.title = data.title.slice(0, 60);
        persist();
        renderFavs();
      }
    } catch { /* hors ligne ou bloqué : on garde le titre générique */ }
  }

  function submit() {
    const value = input.value.trim();
    if (!value) return;
    const parsed = tab === 'youtube' ? parseYouTube(value) : parseDeezer(value);
    if (!parsed) {
      hint.textContent = tab === 'youtube'
        ? '⚠ Lien YouTube non reconnu. Essayez un lien de type youtube.com/watch?v=… ou youtu.be/…'
        : '⚠ Lien Deezer non reconnu. Essayez un lien de type deezer.com/fr/playlist/123…';
      return;
    }
    let item = settings.music.find((m) => m.embed === parsed.embed);
    if (!item) {
      item = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, kind: parsed.kind, title: parsed.title, embed: parsed.embed };
      settings.music.push(item);
      persist();
      if (parsed.kind === 'youtube' && parsed.watchUrl) fetchYouTubeTitle(item, parsed.watchUrl);
    }
    input.value = '';
    input.blur();
    renderTabs();
    renderFavs();
    play(item);
  }

  root.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-tab],[data-play],[data-del]');
    if (!t) return;
    if (t.dataset.tab) {
      tab = t.dataset.tab;
      settings.musicTab = tab;
      persist();
      renderTabs();
      renderFavs();
    } else if (t.dataset.play) {
      const item = settings.music.find((m) => m.id === t.dataset.play);
      if (item) play(item);
    } else if (t.dataset.del) {
      const id = t.dataset.del;
      settings.music = settings.music.filter((m) => m.id !== id);
      persist();
      renderFavs();
      if (playingId === id) { $('player').replaceChildren(); playingId = null; }
    }
  });

  $('form').addEventListener('submit', (ev) => { ev.preventDefault(); submit(); });

  renderTabs();
  renderFavs();

  // Rien à faire à l'affichage ou au masquage : la page est simplement cachée,
  // l'iframe reste chargée et la musique continue.
  return { onShow() {}, onHide() {} };
}
