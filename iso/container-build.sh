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
pacman -Syu --noconfirm --needed archiso grub git

echo "==> Profil d'ISO (base : baseline d'archiso)"
rm -rf /build && mkdir -p /build
cp -r /usr/share/archiso/configs/baseline "$PROFILE"

# Nos fichiers système et notre liste de paquets
cp -a "$SRC/iso/overlay/." "$PROFILE/"
# Depuis Windows (Docker Desktop), les fichiers montés arrivent en 0777 : on remet des droits normaux
# (les exécutables et sudoers ont leurs droits fixés plus bas, dans file_permissions)
(cd "$SRC/iso/overlay" && find . -type d) | while IFS= read -r d; do chmod 755 "$PROFILE/$d"; done
(cd "$SRC/iso/overlay" && find . -type f) | while IFS= read -r f; do chmod 644 "$PROFILE/$f"; done
grep -v '^\s*#' "$SRC/iso/packages.txt" | grep -v '^\s*$' > "$PROFILE/packages.x86_64"

# L'application elle-même
mkdir -p "$PROFILE/airootfs/opt"
cp -a "$STAGE/frhios" "$PROFILE/airootfs/opt/frhios"
find "$PROFILE/airootfs/opt/frhios" -type d -exec chmod 755 {} +
find "$PROFILE/airootfs/opt/frhios" -type f -exec chmod 644 {} +

# oh-my-zsh pour le terminal : version officielle, téléchargée ici (aucune dépendance au PC qui construit).
# Copié dans le dossier personnel de « frhios » au premier démarrage (frhios-firstboot.service),
# utilisé par /usr/share/frhios/home/.zshrc (thème agnoster, plugin git).
echo "==> Téléchargement d'oh-my-zsh"
OMZ="$PROFILE/airootfs/usr/share/frhios/home/.oh-my-zsh"
mkdir -p "$(dirname "$OMZ")"
git clone --depth 1 https://github.com/ohmyzsh/ohmyzsh.git "$OMZ"
rm -rf "$OMZ/.git"
[ -f "$OMZ/oh-my-zsh.sh" ] && [ -f "$OMZ/themes/agnoster.zsh-theme" ] || { echo "oh-my-zsh incomplet" >&2; exit 1; }
chmod -R go-w "$OMZ"

# Images Docker de Home Assistant et du serveur Matter (préparées par build.sh)
if [ -d "$STAGE/images" ]; then
  mkdir -p "$PROFILE/airootfs/usr/share/frhios/images"
  cp "$STAGE"/images/*.tar "$PROFILE/airootfs/usr/share/frhios/images/"
fi

# Liens symboliques qui activent les services au démarrage (équivalent de « systemctl enable »)
W="$PROFILE/airootfs/etc/systemd/system"
mkdir -p "$W/multi-user.target.wants" "$W/network-online.target.wants" "$W/sysinit.target.wants"
ln -sf /usr/lib/systemd/system/NetworkManager.service            "$W/multi-user.target.wants/NetworkManager.service"
ln -sf /usr/lib/systemd/system/NetworkManager-dispatcher.service "$W/dbus-org.freedesktop.nm-dispatcher.service"
ln -sf /usr/lib/systemd/system/NetworkManager-wait-online.service "$W/network-online.target.wants/NetworkManager-wait-online.service"
ln -sf /usr/lib/systemd/system/docker.service                    "$W/multi-user.target.wants/docker.service"
ln -sf /etc/systemd/system/frhios-ha.service                     "$W/multi-user.target.wants/frhios-ha.service"
ln -sf /etc/systemd/system/frhios-matter.service                 "$W/multi-user.target.wants/frhios-matter.service"
ln -sf /usr/lib/systemd/system/bluetooth.service                 "$W/multi-user.target.wants/bluetooth.service"
ln -sf /usr/lib/systemd/system/bluetooth.service                 "$W/dbus-org.bluez.service"
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
  ["/usr/local/bin/frhios-image"]="0:0:755"
  ["/usr/local/bin/frhios-ha-config"]="0:0:755"
  ["/etc/sudoers.d/frhios"]="0:0:440"
)
EOF
# Titres des menus de démarrage
grep -rl "Arch Linux" "$PROFILE/syslinux" "$PROFILE/grub" 2>/dev/null | xargs -r sed -i 's/Arch Linux install medium/FrHiOS - Installation/g; s/Arch Linux/FrHiOS/g'

echo "==> Construction de l'ISO (plusieurs minutes)"
mkarchiso -v -w /build/work -o "$OUT" "$PROFILE"

chown -R "${HOST_UID:-1000}:${HOST_GID:-1000}" "$OUT"
ls -lh "$OUT"
