// Page Terminal : xterm.js (affichage) branché sur un shell zsh/bash géré par le processus principal.
// Le shell reste vivant quand on change de page. Clavier : celui de l'appareil, ou le clavier à
// l'écran en mode terminal (Échap, Tab, Ctrl, flèches…) quand on touche l'écran.

const loadScript = (src) => new Promise((resolve, reject) => {
  const s = document.createElement('script');
  s.src = src;
  s.onload = resolve;
  s.onerror = () => reject(new Error(`Chargement impossible : ${src}`));
  document.head.appendChild(s);
});

export function createTerminalPage(root, icons, osk) {
  const api = window.frhios.terminal;
  let term = null;
  let fit = null;
  let initializing = false;
  let visible = false;
  let exited = false;
  let restartAfterExit = false;

  root.classList.add('web-music', 'term-page');
  root.innerHTML = `
    <div class="web-bar">
      <h1 class="web-title">Terminal</h1>
      <div class="web-actions">
        <button class="icon-btn" data-t="up" aria-label="Défiler vers le haut">${icons.chevLeft.replace('<svg', '<svg style="transform:rotate(90deg)"')}</button>
        <button class="icon-btn" data-t="down" aria-label="Défiler vers le bas">${icons.chevLeft.replace('<svg', '<svg style="transform:rotate(-90deg)"')}</button>
        <button class="icon-btn" data-t="kbd" aria-label="Clavier à l’écran">${icons.keyboard}</button>
        <button class="icon-btn" data-t="restart" aria-label="Relancer le shell">${icons.reload}</button>
      </div>
    </div>
    <div class="term-host" data-role="host"></div>
  `;
  const host = root.querySelector('[data-role="host"]');
  const sink = (text) => api.input(text);

  async function init() {
    if (term || initializing) return;
    initializing = true;
    try {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'vendor/xterm/xterm.css';
      document.head.appendChild(css);
      await loadScript('vendor/xterm/xterm.js');
      await loadScript('vendor/xterm/addon-fit.js');

      term = new window.Terminal({
        // DejaVu Sans Mono + police de symboles : les glyphes du thème agnoster (powerline) s'affichent
        fontFamily: '"DejaVu Sans Mono", "Symbols Nerd Font Mono", "Noto Sans Mono", monospace',
        fontSize: 17,
        cursorBlink: true,
        scrollback: 5000,
        theme: {
          background: '#0d0820', foreground: '#f4f0ff', cursor: '#b99cff', cursorAccent: '#0d0820',
          selectionBackground: 'rgba(185,156,255,.35)',
        },
      });
      fit = new window.FitAddon.FitAddon();
      term.loadAddon(fit);
      term.open(host);
      fit.fit();

      term.onData((d) => { if (!exited) api.input(d); });
      term.onResize(({ cols, rows }) => api.resize(cols, rows));
      api.onData((text) => term?.write(text));
      api.onExit(({ code }) => {
        exited = true;
        term?.write(`\r\n\x1b[2m[shell terminé (code ${code}) — touchez ↻ pour en relancer un]\x1b[0m\r\n`);
        if (restartAfterExit) { restartAfterExit = false; startShell(); }
      });

      new ResizeObserver(() => { if (visible && fit) fit.fit(); }).observe(host);

      // Toucher l'écran = ouvrir le clavier à l'écran en mode terminal
      host.addEventListener('pointerdown', (ev) => {
        if (ev.pointerType === 'touch') osk.showTerminal(sink, true);
      });

      await startShell();
      term.focus();
    } catch (err) {
      host.textContent = `Terminal indisponible : ${err.message}`;
    } finally {
      initializing = false;
    }
  }

  async function startShell() {
    exited = false;
    term.reset();
    await api.start(term.cols, term.rows);
  }

  root.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-t]')?.dataset.t;
    if (!t || !term) return;
    if (t === 'up') term.scrollPages(-1);
    else if (t === 'down') term.scrollPages(1);
    else if (t === 'kbd') osk.toggleTerminal(sink);
    else if (t === 'restart') {
      if (exited) startShell();
      else { restartAfterExit = true; api.kill(); }
    }
  });

  return {
    onShow() {
      visible = true;
      requestAnimationFrame(() => {
        if (!term) { init(); return; }
        fit?.fit();
        term.focus();
      });
    },
    onHide() {
      visible = false;
      osk.hideTerminal();
    },
  };
}
