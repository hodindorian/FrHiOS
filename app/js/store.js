// Réglages persistés localement (localStorage). Tout est enveloppé dans try/catch :
// le stockage peut être indisponible (mode privé, profil verrouillé…).
const KEY = 'frhios.settings.v1';

const defaults = {
  // 'auto' : Home Assistant local configuré tout seul par FrHiOS (démo hors de l'application)
  // 'ha'   : autre serveur Home Assistant (adresse + jeton saisis à la main)
  // 'mock' : démo, faux appareils
  backend: 'auto',
  haUrl: 'http://127.0.0.1:8123',   // utilisé seulement en mode 'ha'
  haToken: '',
  showAll: false,           // true : toutes les entités de HA (réglages des appareils compris)
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
