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

temporary_fstab="$(mktemp)"
trap 'rm -f "$temporary_fstab"' EXIT

verify_fstab() {
  awk '
  function fail(message) {
    print "configure-boot: " message > "/dev/stderr"
    invalid = 1
  }

  function trim(value) {
    sub(/^[[:space:]]+/, "", value)
    sub(/[[:space:]]+$/, "", value)
    return value
  }

  function has_option(options, option, values, count, i, value) {
    count = split(options, values, ",")
    for (i = 1; i <= count; i++) {
      value = tolower(trim(values[i]))
      if (value == option) return 1
    }
    return 0
  }

  /^[[:space:]]*#/ || NF == 0 {
    next
  }

  {
    if ($2 == "/" || $2 == "/boot" || $2 == "/boot/efi") {
      if (NF < 6) {
        fail("expected six fields for fstab mount " $2)
        next
      }
      if ($5 !~ /^[0-9]+$/ || $6 !~ /^[0-9]+$/) {
        fail("expected numeric dump and pass fields for fstab mount " $2)
        next
      }
    }
    if ($2 == "/boot" || $2 == "/boot/efi") {
      seen[$2] = 1
      if (!has_option($4, "noauto")) fail("fstab mount " $2 " is missing noauto")
      if ($6 != 0) fail("fstab mount " $2 " must use pass 0")
    }
  }

  END {
    if (!seen["/boot"]) fail("missing fstab mount /boot")
    if (!seen["/boot/efi"]) fail("missing fstab mount /boot/efi")
    exit invalid
  }
  ' "$1"
}

awk '
function fail(message) {
  print "configure-boot: " message > "/dev/stderr"
  exit 1
}

function trim(value) {
  sub(/^[[:space:]]+/, "", value)
  sub(/[[:space:]]+$/, "", value)
  return value
}

function merge_option_field(options, value) {
  value = trim(value)
  if (options == "" || options ~ /,[[:space:]]*$/) return options value
  return options "," value
}

function add_option(options, option, values, count, i, value, normalized, found) {
  count = split(options, values, ",")
  normalized = ""
  found = 0
  for (i = 1; i <= count; i++) {
    value = trim(values[i])
    if (value == "") continue
    if (tolower(value) == option) {
      value = option
      found = 1
    }
    normalized = normalized == "" ? value : normalized "," value
  }
  if (!found) normalized = normalized == "" ? option : normalized "," option
  return normalized
}

/^[[:space:]]*#/ || NF == 0 {
  print
  next
}

{
  if ($2 == "/" || $2 == "/boot" || $2 == "/boot/efi") {
    if (NF < 6) fail("expected six fields for fstab mount " $2)
    option_field = 5
    while (option_field <= NF && $option_field !~ /^[0-9]+$/) {
      $4 = merge_option_field($4, $option_field)
      option_field++
    }
    if (option_field > 5 && option_field + 1 <= NF) {
      if ($(option_field + 1) ~ /^[0-9]+$/ && $option_field ~ /^[0-9]+$/) {
        field_shift = option_field - 5
        for (i = 5; i <= NF - field_shift; i++) $i = $(i + field_shift)
        NF -= field_shift
      }
    }
    if ($5 !~ /^[0-9]+$/ || $6 !~ /^[0-9]+$/) {
      fail("expected numeric dump and pass fields for fstab mount " $2)
    }
  }
  if ($2 == "/" || $2 == "/boot") {
    $4 = add_option($4, "noatime")
  }
  if ($2 == "/boot" || $2 == "/boot/efi") {
    $4 = add_option($4, "noauto")
    $6 = 0
  }
  print
}
' "$fstab" > "$temporary_fstab"

if ! verify_fstab "$temporary_fstab"; then
  exit 1
fi

systemctl set-default multi-user.target
if [ "$(systemctl get-default)" != 'multi-user.target' ]; then
  printf '%s\n' 'configure-boot: default target is not multi-user.target' >&2
  exit 1
fi

install -m 0644 "$temporary_fstab" "$fstab"

if ! verify_fstab "$fstab"; then
  exit 1
fi

# The image is checked during the bake; running root fsck on every ephemeral boot
# only adds latency and cannot repair a durable runner volume.
systemctl mask systemd-fsck-root.service
