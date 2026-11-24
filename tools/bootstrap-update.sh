#!/bin/sh
# Active le système de mise à jour sur un appareil DÉJÀ INSTALLÉ avec une ISO plus ancienne que lui.
# À lancer UNE SEULE FOIS, dans le terminal de l'appareil (Réglages › Terminal) :
#
#   git clone --depth 1 https://github.com/hodindorian/FrHiOS.git /tmp/frhios && sh /tmp/frhios/tools/bootstrap-update.sh
#
# Il faut qu'un tag de version (ex. v1.0.0) contenant le système de mise à jour soit publié sur GitHub.
# Ce que fait le script :
#   1. cherche le tag de version le plus récent sur GitHub et le télécharge ;
#   2. remplace le script de démarrage /usr/local/bin/frhios-app (celui qui choisit la version à lancer
#      et revient en arrière si besoin) ; demande le mot de passe sudo ;
#   3. installe cette version dans /var/lib/frhios/app (comme le bouton « Installer ») ;
#   4. redémarre l'interface, qui se lance alors sur la version installée.
# Après ça, les mises à jour se font depuis Réglages › Mises à jour, sans réinstaller.
# Les variables FRHIOS_* ne servent qu'aux tests.
set -eu

REPO=${FRHIOS_REPO:-https://github.com/hodindorian/FrHiOS.git}
BIN_DIR=${FRHIOS_BIN_DIR:-/usr/local/bin}
STATE_DIR=${FRHIOS_STATE_DIR:-/var/lib/frhios}
SUDO=${FRHIOS_SUDO-sudo}
OWNER_ARGS=${FRHIOS_OWNER_ARGS--o frhios -g frhios}
NODE_CMD=${FRHIOS_NODE_CMD:-env ELECTRON_RUN_AS_NODE=1 /usr/bin/electron}
RESTART=${FRHIOS_RESTART:-1}

command -v git >/dev/null 2>&1 || { echo "git est introuvable sur cet appareil."; exit 1; }

echo "==> Recherche de la dernière version publiée sur GitHub"
TAG=$(GIT_TERMINAL_PROMPT=0 git ls-remote --tags --refs "$REPO" \
  | sed 's#.*refs/tags/##' | grep -E '^v?[0-9]+(\.[0-9]+){0,2}$' | sort -V | tail -n 1 || true)
if [ -z "$TAG" ]; then
  echo "Aucun tag de version (ex. v1.0.0) sur GitHub : créez-en un (git tag v1.0.0 && git push origin v1.0.0), puis relancez."
  exit 1
fi
echo "    version $TAG"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
echo "==> Téléchargement"
GIT_TERMINAL_PROMPT=0 git clone --quiet --depth 1 --branch "$TAG" "$REPO" "$TMP/src"
[ -f "$TMP/src/iso/overlay/airootfs/usr/local/bin/frhios-app" ] || { echo "Ce tag ne contient pas le système de mise à jour."; exit 1; }

echo "==> Installation du script de démarrage (mot de passe sudo demandé)"
$SUDO install -m 755 "$TMP/src/iso/overlay/airootfs/usr/local/bin/frhios-app" "$BIN_DIR/frhios-app"
# shellcheck disable=SC2086  # OWNER_ARGS contient volontairement plusieurs arguments
$SUDO install -d $OWNER_ARGS "$STATE_DIR"

echo "==> Installation de la version $TAG"
FRHIOS_STATE_DIR="$STATE_DIR" FRHIOS_REPO="$REPO" $NODE_CMD "$TMP/src/tools/apply-update.cjs"

echo "==> Terminé. Les prochaines mises à jour : Réglages › Mises à jour."
if [ "$RESTART" = 1 ]; then
  echo "L'interface redémarre (si vous êtes dans le terminal de l'appareil, il se ferme)."
  sleep 2
  pkill -x electron || true
fi
