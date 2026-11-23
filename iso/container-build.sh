#!/bin/bash
# Exécuté À L'INTÉRIEUR du conteneur Arch par iso/build.sh. Ne pas lancer directement sur votre PC.
set -euo pipefail

SRC=/src          # le dépôt FrHiOS (lecture seule)
STAGE=/stage      # fichiers de l'application préparés par build.sh
OUT=/out
PROFILE=/build/profile

echo "==> Installation d'archiso et de grub (outils de construction)"
pacman-key --init >/dev/null 2>&1
pacman-key --populate archlinux >/dev/null 2>&1
pacman -Syu --noconfirm --needed archiso grub

echo "==> Profil d'ISO (base : baseline d'archiso)"
rm -rf /build && mkdir -p /build
cp -r /usr/share/archiso/configs/baseline "$PROFILE"

# Nos fichiers système et notre liste de paquets
cp -a "$SRC/iso/overlay/." "$PROFILE/"
grep -v '^\s*#' "$SRC/iso/packages.txt" | grep -v '^\s*$' > "$PROFILE/packages.x86_64"

# L'application elle-même
mkdir -p "$PROFILE/airootfs/opt"
cp -a "$STAGE/frhios" "$PROFILE/airootfs/opt/frhios"

# oh-my-zsh (copie du PC de l'utilisateur, préparée par build.sh)
if [ -d "$STAGE/frhios-home/.oh-my-zsh" ]; then
  mkdir -p "$PROFILE/airootfs/usr/share/frhios/home"
  cp -a "$STAGE/frhios-home/.oh-my-zsh" "$PROFILE/airootfs/usr/share/frhios/home/.oh-my-zsh"
fi

# Liens symboliques qui activent les services au démarrage (équivalent de « systemctl enable »)
W="$PROFILE/airootfs/etc/systemd/system"
mkdir -p "$W/multi-user.target.wants" "$W/network-online.target.wants" "$W/sysinit.target.wants"
ln -sf /usr/lib/systemd/system/NetworkManager.service            "$W/multi-user.target.wants/NetworkManager.service"
ln -sf /usr/lib/systemd/system/NetworkManager-dispatcher.service "$W/dbus-org.freedesktop.nm-dispatcher.service"
ln -sf /usr/lib/systemd/system/NetworkManager-wait-online.service "$W/network-online.target.wants/NetworkManager-wait-online.service"
ln -sf /usr/lib/systemd/system/docker.service                    "$W/multi-user.target.wants/docker.service"
ln -sf /etc/systemd/system/frhios-ha.service                     "$W/multi-user.target.wants/frhios-ha.service"
ln -sf /etc/systemd/system/frhios-firstboot.service              "$W/multi-user.target.wants/frhios-firstboot.service"
ln -sf /etc/systemd/system/frhios-keyring.service                "$W/multi-user.target.wants/frhios-keyring.service"
ln -sf /usr/lib/systemd/system/systemd-timesyncd.service         "$W/sysinit.target.wants/systemd-timesyncd.service"
ln -sf /usr/share/zoneinfo/Europe/Paris                          "$PROFILE/airootfs/etc/localtime"

# Identité de l'ISO et droits des fichiers
sed -i \
  -e 's/^iso_name=.*/iso_name="frhios"/' \
  -e 's/^iso_label=.*/iso_label="FRHIOS"/' \
  -e 's/^iso_publisher=.*/iso_publisher="FrHiOS"/' \
  -e 's/^iso_application=.*/iso_application="FrHiOS - installation"/' \
  "$PROFILE/profiledef.sh"
cat >> "$PROFILE/profiledef.sh" <<'EOF'

file_permissions+=(
  ["/usr/local/bin/frhios-session"]="0:0:755"
  ["/usr/local/bin/frhios-app"]="0:0:755"
  ["/usr/local/bin/frhios-install"]="0:0:755"
  ["/etc/sudoers.d/frhios"]="0:0:440"
)
EOF
# Titres des menus de démarrage
grep -rl "Arch Linux" "$PROFILE/syslinux" "$PROFILE/grub" 2>/dev/null | xargs -r sed -i 's/Arch Linux install medium/FrHiOS - Installation/g; s/Arch Linux/FrHiOS/g'

echo "==> Construction de l'ISO (plusieurs minutes)"
mkarchiso -v -w /build/work -o "$OUT" "$PROFILE"

chown -R "${HOST_UID:-1000}:${HOST_GID:-1000}" "$OUT"
ls -lh "$OUT"
