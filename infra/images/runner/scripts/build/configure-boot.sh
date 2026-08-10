#!/usr/bin/env sh
set -eu

root_dir=${RUNNER_IMAGE_ROOT:-/}
grub_dropin_dir="$root_dir/etc/default/grub.d"
grub_dropin="$grub_dropin_dir/zz-shipfox-runner.cfg"
grub_config="$root_dir/boot/grub/grub.cfg"
fstab="$root_dir/etc/fstab"

install -d -m 0755 "$grub_dropin_dir"
printf '%s\n' 'GRUB_CMDLINE_LINUX_DEFAULT="${GRUB_CMDLINE_LINUX_DEFAULT:-} fsck.mode=skip"' > "$grub_dropin"
update-grub

if [ ! -r "$grub_config" ] || ! grep -Eq '(^|[[:space:]])fsck\.mode=skip([[:space:]]|$)' "$grub_config"; then
  printf '%s\n' 'configure-boot: regenerated grub.cfg does not contain fsck.mode=skip' >&2
  exit 1
fi

systemctl set-default multi-user.target
if [ "$(systemctl get-default)" != 'multi-user.target' ]; then
  printf '%s\n' 'configure-boot: default target is not multi-user.target' >&2
  exit 1
fi

# The image is checked during the bake; running root fsck on every ephemeral boot
# only adds latency and cannot repair a durable runner volume.
systemctl mask systemd-fsck-root.service

temporary_fstab="$(mktemp)"
trap 'rm -f "$temporary_fstab"' EXIT
awk '
function fail(message) {
  print "configure-boot: " message > "/dev/stderr"
  exit 1
}

function add_option(options, option, values, count, i) {
  count = split(options, values, ",")
  for (i = 1; i <= count; i++) {
    if (values[i] == option) return options
  }
  return options == "" ? option : options "," option
}

/^[[:space:]]*#/ || NF == 0 {
  print
  next
}

{
  changed = 0
  if ($2 == "/" || $2 == "/boot" || $2 == "/boot/efi") {
    if (NF < 6) fail("expected six fields for fstab mount " $2)
  }
  if ($2 == "/" || $2 == "/boot") {
    $4 = add_option($4, "noatime")
    changed = 1
  }
  if ($2 == "/boot" || $2 == "/boot/efi") {
    $4 = add_option($4, "noauto")
    $6 = 0
    changed = 1
  }
  if (changed) {
    print
  } else {
    print
  }
}
' "$fstab" > "$temporary_fstab"
install -m 0644 "$temporary_fstab" "$fstab"
