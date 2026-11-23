// Réglages persistés localement (localStorage). Tout est enveloppé dans try/catch :
// le stockage peut être indisponible (mode privé, profil verrouillé…).
const KEY = 'frhios.settings.v1';

const defaults = {
  backend: 'mock',          // 'mock' (démo) | 'ha' (Home Assistant)
  haUrl: 'http://127.0.0.1:8123',   // Home Assistant tourne sur le mini PC lui-même (conteneur)
  haToken: '',
  hideCursor: false,        // true sur le PC kiosque (écran tactile, pas de souris)
  osk: 'auto',              // clavier à l'écran : 'auto' (après un contact tactile) | 'on' | 'off'
  musicTab: 'youtube',
  music: [],                // [{ id, kind: 'youtube'|'deezer', title, embed }]
};

export function load() {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...defaults };
  }
}

export function save(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* stockage indisponible : on continue sans persistance */
  }
}
