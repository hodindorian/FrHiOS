'use strict';
// Exécuté dans YouTube / Deezer, dans un monde JavaScript isolé : la page ne voit ni ce script,
// ni ipcRenderer. Il n'expose rien. Rôle unique : signaler quand un champ de texte prend ou perd
// le focus, pour que l'interface affiche son clavier à l'écran.
const { ipcRenderer } = require('electron');

const TEXT_TYPES = new Set(['text', 'search', 'url', 'password', 'email', 'tel', '']);
let lastPointer = 'mouse';

function isEditable(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA') return !el.readOnly && !el.disabled;
  if (el.tagName === 'INPUT') {
    return TEXT_TYPES.has((el.type || 'text').toLowerCase()) && !el.readOnly && !el.disabled;
  }
  return false;
}

// Élément réellement actif, même dans un shadow DOM (YouTube en utilise beaucoup)
function deepActive() {
  let a = document.activeElement;
  while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
  return a;
}

const notify = (editable) => ipcRenderer.send('osk:page-focus', { editable, touch: lastPointer === 'touch' });

window.addEventListener('pointerdown', (e) => { lastPointer = e.pointerType; }, true);

window.addEventListener('focusin', (e) => {
  const target = (e.composedPath && e.composedPath()[0]) || e.target;
  if (isEditable(target)) notify(true);
}, true);

window.addEventListener('focusout', () => {
  setTimeout(() => {
    // Si la fenêtre elle-même perd le focus (on a tapé sur le clavier de l'interface), le champ
    // reste actif : ne pas fermer le clavier. On ne ferme que si le focus est passé à autre chose.
    if (document.hasFocus() && !isEditable(deepActive())) notify(false);
  }, 0);
}, true);

// Demandé par le bouton ✕ du clavier : quitter le champ
ipcRenderer.on('osk:blur', () => {
  const a = deepActive();
  if (a && typeof a.blur === 'function') a.blur();
});
