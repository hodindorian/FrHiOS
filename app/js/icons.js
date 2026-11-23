// Icônes SVG intégrées (pas de police d'icônes à installer sur le PC kiosque).
const svg = (body) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;

export const icons = {
  home: svg('<path d="M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1z"/>'),
  grid: svg('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
  music: svg('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'),
  tv: svg('<rect x="2" y="7" width="20" height="13" rx="2"/><path d="M8 3l4 4 4-4"/>'),
  settings: svg('<path d="M4 6h3M11 6h9M4 12h9M17 12h3M4 18h2M10 18h10"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="8" cy="18" r="2"/>'),
  keyboard: svg('<rect x="2" y="6" width="20" height="12" rx="2.5"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7.5 14h9"/>'),
  // Fleur à cinq pétales (nemophila) : logo de l'app
  flower: svg('<g fill="currentColor" fill-opacity=".22"><ellipse cx="12" cy="6.4" rx="3" ry="4.4"/><ellipse cx="12" cy="6.4" rx="3" ry="4.4" transform="rotate(72 12 12)"/><ellipse cx="12" cy="6.4" rx="3" ry="4.4" transform="rotate(144 12 12)"/><ellipse cx="12" cy="6.4" rx="3" ry="4.4" transform="rotate(216 12 12)"/><ellipse cx="12" cy="6.4" rx="3" ry="4.4" transform="rotate(288 12 12)"/></g><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/>'),
  enter: svg('<path d="M20 5v7a3 3 0 0 1-3 3H5"/><path d="M9 11l-4 4 4 4"/>'),
  backspace: svg('<path d="M9 5h11a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-6-7z"/><path d="M13 10l4 4M17 10l-4 4"/>'),
  shift: svg('<path d="M12 4l8 9h-5v6H9v-6H4z"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  bulb: svg('<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z"/>'),
  plug: svg('<path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4"/>'),
  power: svg('<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/>'),
  fullscreen: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  volUp: svg('<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>'),
  volDown: svg('<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/>'),
  mute: svg('<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6M22 9l-5 6"/>'),
  back: svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'),
  chevLeft: svg('<path d="M15 5l-7 7 7 7"/>'),
  reload: svg('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>'),
  moon: svg('<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/>'),
};

export const domainIcon = (domain) =>
  ({ light: icons.bulb, switch: icons.plug, media_player: icons.tv }[domain] || icons.plug);
