#!/bin/bash
# Construit l'ISO FrHiOS (installable depuis une clé Ventoy) dans un conteneur Docker Arch.
# Aucun droit root sur votre machine n'est nécessaire, seulement l'accès à Docker.
#
#   ./iso/build.sh
#
# Résultat : iso/out/frhios-AAAA.MM.JJ-x86_64.iso
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="$ROOT/iso/.stage"
OUT="$ROOT/iso/out"

# Windows (Git Bash + Docker Desktop) : MSYS convertit d'office les arguments qui ressemblent à des
# chemins (« /src » devient « C:/Program Files/Git/src »). On coupe cette conversion et on donne à
# Docker les chemins au format Windows nous-mêmes.
if command -v cygpath >/dev/null 2>&1; then
  export MSYS_NO_PATHCONV=1
  dpath() { cygpath -m "$1"; }
else
  dpath() { printf '%s' "$1"; }
fi

echo "==> Préparation des fichiers de l'application"
rm -rf "$STAGE"
mkdir -p "$STAGE/frhios" "$OUT"
cp -a "$ROOT/app" "$ROOT/electron" "$ROOT/assets" "$STAGE/frhios/"
# package.json minimal : Electron vient du paquet Arch, pas de npm dans l'ISO
cat > "$STAGE/frhios/package.json" <<'EOF'
{
  "name": "frhios",
  "version": "0.1.0",
  "private": true,
  "main": "electron/main.js"
}
EOF

# version.json : quelle version du dépôt cette ISO contient (l'appareil compare avec GitHub pour proposer
# les mises à jour, voir electron/updater.js). « dirty » : des modifications non commitées sont dans l'ISO.
if git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  v_commit="$(git -C "$ROOT" rev-parse HEAD)"
  v_date="$(git -C "$ROOT" log -1 --format=%cI)"
  v_msg="$(git -C "$ROOT" log -1 --format=%s)"
  # Version publiée (tag) la plus proche de ce commit, ex. v1.2.0 ; vide s'il n'y a encore aucun tag
  v_tag="$(git -C "$ROOT" describe --tags --abbrev=0 2>/dev/null || true)"
  v_msg="${v_msg//\\/\\\\}"; v_msg="${v_msg//\"/\\\"}"
  v_dirty=false; [[ -n "$(git -C "$ROOT" status --porcelain -- app electron assets)" ]] && v_dirty=true
  printf '{\n  "tag": "%s",\n  "commit": "%s",\n  "date": "%s",\n  "message": "%s",\n  "dirty": %s\n}\n' \
    "$v_tag" "$v_commit" "$v_date" "$v_msg" "$v_dirty" > "$STAGE/frhios/version.json"
else
  echo '{}' > "$STAGE/frhios/version.json"
fi
echo "==> Version de l'application : $(tr -d '\n ' < "$STAGE/frhios/version.json" | cut -c1-80)"

# oh-my-zsh : téléchargé dans le conteneur de construction (container-build.sh), rien à avoir sur ce PC

# Images Docker de Home Assistant et du serveur Matter, embarquées dans l'ISO : l'appareil démarre
# sa domotique sans rien télécharger (chargées au premier démarrage par /usr/local/bin/frhios-image).
# FRHIOS_BUNDLE_IMAGES=0 ./iso/build.sh pour une ISO plus légère (téléchargement au premier démarrage).
if [[ "${FRHIOS_BUNDLE_IMAGES:-1}" != 0 ]]; then
  mkdir -p "$STAGE/images"
  for pair in "ghcr.io/home-assistant/home-assistant:stable homeassistant.tar" \
              "ghcr.io/home-assistant-libs/python-matter-server:stable matter-server.tar"; do
    set -- $pair
    echo "==> Image $1"
    docker pull --platform linux/amd64 "$1"
    docker save -o "$(dpath "$STAGE/images/$2")" "$1"
  done
fi

echo "==> Construction dans Docker (archlinux:latest)"
docker run --rm --privileged \
  -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" \
  -v "$(dpath "$ROOT"):/src:ro" \
  -v "$(dpath "$STAGE"):/stage:ro" \
  -v "$(dpath "$OUT"):/out" \
  -v frhios-pacman-cache:/var/cache/pacman/pkg \
  archlinux:latest \
  bash /src/iso/container-build.sh

echo
echo "ISO prête :"
ls -lh "$OUT"/*.iso
