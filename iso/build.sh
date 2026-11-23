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

# oh-my-zsh : copie de celui de votre PC (sans .git ni cache), pour le terminal du mini PC
if [[ -d "$HOME/.oh-my-zsh" ]]; then
  echo "==> Copie d'oh-my-zsh depuis $HOME/.oh-my-zsh"
  mkdir -p "$STAGE/frhios-home"
  tar -C "$HOME" --exclude='.oh-my-zsh/.git' --exclude='.oh-my-zsh/cache' -cf - .oh-my-zsh | tar -C "$STAGE/frhios-home" -xf -
else
  echo "!! $HOME/.oh-my-zsh introuvable : le terminal n'aura pas oh-my-zsh"
fi

echo "==> Construction dans Docker (archlinux:latest)"
docker run --rm --privileged \
  -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" \
  -v "$ROOT:/src:ro" \
  -v "$STAGE:/stage:ro" \
  -v "$OUT:/out" \
  -v frhios-pacman-cache:/var/cache/pacman/pkg \
  archlinux:latest \
  bash /src/iso/container-build.sh

echo
echo "ISO prête :"
ls -lh "$OUT"/*.iso
