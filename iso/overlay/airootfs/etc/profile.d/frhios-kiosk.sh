# Console 1, utilisateur frhios : on lance l'interface plein écran (jamais sur une session SSH ou une autre console)
if [ "$(id -un)" = "frhios" ] && [ -z "${WAYLAND_DISPLAY:-}" ] && [ "$(tty)" = "/dev/tty1" ]; then
  exec /usr/local/bin/frhios-session
fi
