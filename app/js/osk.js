// Clavier à l'écran (AZERTY) pour l'écran tactile seul.
//
// Deux cibles possibles :
//   - « local » : un champ de texte de NOTRE interface (réglages, lien de musique…)
//   - « web »   : un champ dans YouTube / Deezer. Ces sites sont des vues natives Electron :
//                 on le sait par `bridge.onFocus`, et les touches partent vers le processus
//                 principal (`bridge.send`) qui les injecte dans la page.
//
// Le clavier prend la place d'une barre en bas de `.main` : le contenu au-dessus rétrécit
// tout seul (la zone des sites se redimensionne donc automatiquement).

import { icons } from './icons.js';

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'password', 'email', 'tel', '']);

export function isTextField(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el.tagName === 'TEXTAREA') return !el.readOnly && !el.disabled;
  if (el.tagName !== 'INPUT') return false;
  return TEXT_INPUT_TYPES.has((el.type || 'text').toLowerCase()) && !el.readOnly && !el.disabled;
}

/* ---------- Dispositions ---------- */

const ch = (v, w = 1) => ({ t: 'char', v, w });
const chars = (s) => [...s].map((c) => ch(c));
const fn = (t, w = 1) => ({ t, w });

const LAYOUTS = {
  alpha: [
    chars('azertyuiop'),
    chars('qsdfghjklm'),
    [fn('shift', 1.5), ...chars('wxcvbn'), ch("'"), fn('back', 1.5)],
    [fn('close', 1.2), fn('sym', 1.4), ch('é'), ch('è'), ch('à'), ch('ç'), fn('space', 2.4), ch('.'), fn('enter', 1.6)],
  ],
  sym: [
    chars('1234567890'),
    [...'@#&-_():;/'].map((c) => ch(c)),
    [...'ùêâîôûïüœ'].map((c) => ch(c)).concat(fn('back', 1)),
    [fn('close', 1.2), fn('abc', 1.4), fn('sym2', 1.4), fn('paste', 1.6), ch('!'), ch('?'), fn('space', 2), ch(','), ch('.'), fn('enter', 1.6)],
  ],
  // Symboles pour le terminal et la programmation
  sym2: [
    [...'~|\\^`{}[]%'].map((c) => ch(c)),
    [...'$*+=<>"\'!?'].map((c) => ch(c)),
    [fn('sym', 1.5), ...[...'#&@_-;:'].map((c) => ch(c)), fn('back', 1.5)],
    [fn('close', 1.2), fn('abc', 1.4), fn('paste', 1.6), ch('/'), ch('('), ch(')'), fn('space', 2), ch(','), ch('.'), fn('enter', 1.6)],
  ],
};

// Rangée supplémentaire en mode terminal : touches que le clavier d'un terminal doit avoir
const tkey = (label, seq, w = 1) => ({ t: 'tkey', label, seq, w });
const TERM_ROW = [
  tkey('Échap', '\x1b', 1.3), tkey('Tab', '\t', 1.1), fn('ctrl', 1.1),
  tkey('←', '\x1b[D'), tkey('↓', '\x1b[B'), tkey('↑', '\x1b[A'), tkey('→', '\x1b[C'),
  tkey('^C', '\x03'), tkey('^D', '\x04'),
];

/* ---------- Composant ---------- */

export function createOsk({ root, getSettings, bridge }) {
  let mode = null;          // 'local' | 'web' | 'term' | null
  let termSink = null;      // fonction qui reçoit le texte à envoyer au terminal
  let ctrl = false;         // touche Ctrl « collante » (une seule frappe)
  let localEl = null;       // champ de notre interface ciblé
  let layer = 'alpha';
  let shift = 'off';        // 'off' | 'once' | 'lock'
  let lastPointer = 'mouse';
  let specs = [];           // touches actuellement affichées, indexées par data-i
  let repeatTimer = null;
  const kiosk = new URLSearchParams(location.search).has('kiosk');

  // Faut-il l'afficher ? « Auto » = seulement après un contact tactile (ou toujours en mode kiosque).
  const allowed = (touch) => {
    const m = getSettings().osk;
    if (m === 'off') return false;
    return m === 'on' || kiosk || touch;
  };

  /* ----- Rendu ----- */

  function label(spec) {
    switch (spec.t) {
      case 'char': return layer === 'alpha' && shift !== 'off' ? spec.v.toUpperCase() : spec.v;
      case 'shift': return icons.shift;
      case 'back': return icons.backspace;
      case 'enter': return icons.enter;
      case 'close': return icons.close;
      case 'sym': return '?123';
      case 'sym2': return '#+=';
      case 'tkey': return spec.label;
      case 'ctrl': return 'Ctrl';
      case 'abc': return 'ABC';
      case 'paste': return 'Coller';
      case 'space': return '';
      default: return '';
    }
  }

  function render() {
    specs = [];
    const rows = mode === 'term' ? [TERM_ROW, ...LAYOUTS[layer]] : LAYOUTS[layer];
    root.innerHTML = rows.map((row) =>
      `<div class="osk-row">${row.map((spec) => {
        const i = specs.push(spec) - 1;
        const cls = ['osk-key'];
        if (['shift', 'back', 'close', 'sym', 'sym2', 'abc', 'space', 'paste', 'tkey', 'ctrl'].includes(spec.t)) cls.push('fn');
        if (spec.t === 'ctrl' && ctrl) cls.push('on');
        if (spec.t === 'enter') cls.push('enter');
        if (spec.t === 'shift' && shift !== 'off') cls.push('on');
        const aria = { shift: 'Majuscule', back: 'Effacer', enter: 'Entrée', close: 'Fermer le clavier', space: 'Espace' }[spec.t] || '';
        return `<button type="button" class="${cls.join(' ')}" style="--w:${spec.w}" data-i="${i}"${aria ? ` aria-label="${aria}"` : ''}>${label(spec)}</button>`;
      }).join('')}</div>`).join('');
  }

  /* ----- Envoi des touches ----- */

  function localInsert(text) {
    const el = localEl;
    if (!el || !el.isConnected) return;
    const s = el.selectionStart ?? el.value.length;
    const e = el.selectionEnd ?? el.value.length;
    el.setRangeText(text, s, e, 'end');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function localBackspace() {
    const el = localEl;
    if (!el || !el.isConnected) return;
    const s = el.selectionStart ?? el.value.length;
    const e = el.selectionEnd ?? el.value.length;
    if (s === e && s > 0) el.setRangeText('', s - 1, s, 'end');
    else if (s !== e) el.setRangeText('', s, e, 'end');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function localEnter() {
    const el = localEl;
    if (!el) return;
    if (el.form) el.form.requestSubmit();
    else el.blur();
  }

  // Terminal : Ctrl + une lettre envoie le caractère de contrôle (Ctrl+C = 0x03, etc.)
  function termText(t) {
    if (ctrl && t.length === 1 && /[a-z]/i.test(t)) {
      termSink?.(String.fromCharCode(t.toLowerCase().charCodeAt(0) - 96));
    } else {
      termSink?.(t);
    }
    if (ctrl) { ctrl = false; render(); }
  }

  const sendText = (t) => {
    if (mode === 'web') bridge?.send({ type: 'text', value: t });
    else if (mode === 'term') termText(t);
    else localInsert(t);
  };
  const sendKey = (k) => {
    if (mode === 'term') termSink?.(k === 'Backspace' ? '\x7f' : '\r');
    else if (mode === 'web') bridge?.send({ type: 'key', value: k });
    else if (k === 'Backspace') localBackspace();
    else if (k === 'Enter') localEnter();
  };

  function press(spec) {
    switch (spec.t) {
      case 'char': {
        const up = layer === 'alpha' && shift !== 'off';
        sendText(up ? spec.v.toUpperCase() : spec.v);
        if (shift === 'once') { shift = 'off'; render(); }
        break;
      }
      case 'space': sendText(' '); break;
      case 'paste':
        // Le presse-papiers est lu par le processus principal (copié depuis un site, par exemple)
        Promise.resolve(window.frhios?.clipboard?.read()).then((text) => {
          const clean = String(text || '').replace(/[\r\n]+/g, ' ').trim();
          if (clean) sendText(clean);
        });
        break;
      case 'back': sendKey('Backspace'); break;
      case 'enter': sendKey('Enter'); break;
      case 'shift': shift = shift === 'off' ? 'once' : shift === 'once' ? 'lock' : 'off'; render(); break;
      case 'sym': layer = 'sym'; render(); break;
      case 'sym2': layer = 'sym2'; render(); break;
      case 'tkey': termSink?.(spec.seq); break;
      case 'ctrl': ctrl = !ctrl; render(); break;
      case 'abc': layer = 'alpha'; render(); break;
      case 'close': dismiss(); break;
    }
  }

  const stopRepeat = () => { clearTimeout(repeatTimer); clearInterval(repeatTimer); repeatTimer = null; };

  // Appui = frappe immédiate (plus réactif au doigt qu'un « clic »). L'effacement se répète si on maintient.
  root.addEventListener('pointerdown', (ev) => {
    const btn = ev.target.closest('.osk-key');
    if (!btn) return;
    ev.preventDefault(); // ne pas voler le focus du champ
    const spec = specs[Number(btn.dataset.i)];
    if (!spec) return;
    press(spec);
    if (spec.t === 'back') {
      stopRepeat();
      repeatTimer = setTimeout(() => { repeatTimer = setInterval(() => sendKey('Backspace'), 60); }, 420);
    }
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => root.addEventListener(t, stopRepeat));
  // Empêcher aussi le focus via les événements « souris/tactile » de compatibilité
  root.addEventListener('mousedown', (ev) => ev.preventDefault());
  root.addEventListener('touchstart', (ev) => ev.preventDefault(), { passive: false });

  /* ----- Affichage / masquage ----- */

  function show(newMode) {
    mode = newMode;
    if (root.hidden) { layer = 'alpha'; shift = 'off'; }
    root.hidden = false;
    render();
  }

  function hide() {
    stopRepeat();
    mode = null;
    localEl = null;
    root.hidden = true;
  }

  // ✕ : fermer ET retirer le focus du champ, pour que le prochain contact le rouvre
  function dismiss() {
    if (mode === 'local') localEl?.blur();
    else if (mode === 'web') bridge?.send({ type: 'blur' });
    // mode 'term' : rien à défocaliser, on referme simplement
    hide();
  }

  document.addEventListener('pointerdown', (ev) => { lastPointer = ev.pointerType; }, true);

  document.addEventListener('focusin', (ev) => {
    const el = ev.target;
    if (!isTextField(el) || root.contains(el)) return;
    if (el.closest && el.closest('.term-page')) return; // le terminal gère son propre clavier
    if (!allowed(lastPointer === 'touch')) return;
    localEl = el;
    show('local');
    requestAnimationFrame(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  });

  document.addEventListener('focusout', (ev) => {
    if (mode !== 'local' || ev.target !== localEl) return;
    setTimeout(() => { if (mode === 'local' && !isTextField(document.activeElement)) hide(); }, 0);
  });

  // Champ de recherche pris/quitté dans YouTube ou Deezer
  bridge?.onFocus(({ editable, touch }) => {
    if (editable) { if (allowed(touch)) show('web'); }
    else if (mode === 'web') hide();
  });

  return {
    // Bouton ⌨ de la page Musique : ouvre/ferme le clavier pour le site affiché
    toggleWeb() { if (mode === 'web') hide(); else show('web'); },
    isWebOpen: () => mode === 'web',
    // La page Musique disparaît : le clavier n'a plus de cible
    hideWeb() { if (mode === 'web') hide(); },
    // Terminal : sink(texte) reçoit ce qui est tapé
    showTerminal(sink, touch = true) {
      if (!allowed(touch)) return;
      termSink = sink; ctrl = false; show('term');
    },
    toggleTerminal(sink) {
      if (mode === 'term') hide(); else { termSink = sink; ctrl = false; show('term'); }
    },
    hideTerminal() { if (mode === 'term') hide(); },
  };
}
