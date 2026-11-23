#!/bin/bash
# Essaie l'ISO dans une machine virtuelle (QEMU, UEFI, KVM) AVANT de la mettre sur la clé.
#
#   ./iso/test-vm.sh install     # démarre l'ISO avec un disque virtuel vide (pour tester l'installateur)
#   ./iso/test-vm.sh boot        # démarre le disque virtuel (le système installé), sans l'ISO
#
# Le disque virtuel est iso/out/vm-disk.qcow2 (supprimez-le pour repartir de zéro).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/iso/out"
DISK="$OUT/vm-disk.qcow2"
ISO="${FRHIOS_ISO:-$(ls -t "$OUT"/frhios-*.iso 2>/dev/null | head -n1 || true)}"
OVMF_CODE=/usr/share/edk2/x64/OVMF_CODE.4m.fd
OVMF_VARS_TEMPLATE=/usr/share/edk2/x64/OVMF_VARS.4m.fd
VARS="$OUT/vm-ovmf-vars.fd"
MODE="${1:-install}"

[[ -f "$DISK" ]] || qemu-img create -f qcow2 "$DISK" 32G >/dev/null
[[ -f "$VARS" ]] || cp "$OVMF_VARS_TEMPLATE" "$VARS"

# Accélération matérielle (KVM) par défaut. Impossible si VirtualBox tourne en même temps :
# dans ce cas FRHIOS_VM_ACCEL=tcg force l'émulation logicielle (beaucoup plus lente).
if [[ "${FRHIOS_VM_ACCEL:-kvm}" == "tcg" ]]; then ACCEL=(-accel tcg -cpu max); else ACCEL=(-enable-kvm -cpu host); fi

ARGS=(
  "${ACCEL[@]}" -smp 4 -m 4096
  -machine q35
  -drive "if=pflash,format=raw,readonly=on,file=$OVMF_CODE"
  -drive "if=pflash,format=raw,file=$VARS"
  -drive "file=$DISK,if=none,id=hd0,format=qcow2" -device nvme,drive=hd0,serial=frhios0
  -device VGA,vgamem_mb=64
  -device qemu-xhci -device usb-tablet
  -device intel-hda -device hda-duplex
  -nic user,model=virtio-net-pci
)

if [[ "$MODE" == "install" ]]; then
  [[ -n "$ISO" ]] || { echo "Aucune ISO dans $OUT : lancez d'abord ./iso/build.sh"; exit 1; }
  ARGS+=(-drive "file=$ISO,media=cdrom,readonly=on")
  echo "ISO : $ISO"
fi

# Options supplémentaires (ex. -display none -vnc :1 -monitor unix:...) passées après le mode
exec qemu-system-x86_64 "${ARGS[@]}" "${@:2}"
