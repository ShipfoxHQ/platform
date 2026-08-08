#!/usr/bin/env sh
set -eu

grub_defaults=/etc/default/grub
if ! grep -Eq '^[^#]*fsck\.mode=skip' "$grub_defaults"; then
  if grep -Eq '^GRUB_CMDLINE_LINUX_DEFAULT=' "$grub_defaults"; then
    sed -i -E 's/^(GRUB_CMDLINE_LINUX_DEFAULT="[^"]*)"/\1 fsck.mode=skip"/' "$grub_defaults"
  else
    printf '%s\n' 'GRUB_CMDLINE_LINUX_DEFAULT="fsck.mode=skip"' >> "$grub_defaults"
  fi
fi
update-grub

# The image is checked during the bake; running root fsck on every ephemeral boot
# only adds latency and cannot repair a durable runner volume.
systemctl mask systemd-fsck-root.service

fstab=/etc/fstab
temporary_fstab="$(mktemp)"
trap 'rm -f "$temporary_fstab"' EXIT
awk '
function add_option(options, option, values, count, index) {
  count = split(options, values, ",")
  for (index = 1; index <= count; index++) {
    if (values[index] == option) return options
  }
  return options == "" ? option : options "," option
}

/^[[:space:]]*#/ || NF < 4 {
  print
  next
}

{
  changed = 0
  if ($2 == "/" || $2 == "/boot") {
    $4 = add_option($4, "noatime")
    changed = 1
  }
  if ($2 == "/boot" || $2 == "/boot/efi") {
    $6 = 0
    changed = 1
  }
  if (changed) {
    print $1, $2, $3, $4, $5, $6
  } else {
    print
  }
}
' "$fstab" > "$temporary_fstab"
install -m 0644 "$temporary_fstab" "$fstab"
