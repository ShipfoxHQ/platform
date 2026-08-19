#!/usr/bin/env sh
set -eu

composition_dir=${SHIPFOX_RUNNER_COMPOSITION_DIR:-/tmp/shipfox-runner-image-composition}
enabled_golden="$composition_dir/enabled.txt"
masked_golden="$composition_dir/masked.txt"
limits_file="$composition_dir/limits.env"
image_identity="${SHIPFOX_RUNNER_IMAGE_OS:-unknown}/${SHIPFOX_RUNNER_IMAGE_ARCHITECTURE:-unknown}"

fail() {
  printf 'runner image composition (%s): %s\n' "$image_identity" "$*" >&2
  exit 1
}

for required_file in "$enabled_golden" "$masked_golden" "$limits_file"; do
  [ -r "$required_file" ] || fail "required composition file is missing: $required_file"
done

inventory() {
  state=$1
  case "$state" in
    enabled)
      systemctl list-unit-files --state=enabled --no-legend --no-pager --plain
      ;;
    masked)
      systemctl list-unit-files --state=masked --no-legend --no-pager --plain
      ;;
    *)
      fail "unsupported systemd inventory state: $state"
      ;;
  esac |
    awk 'NF >= 2 {print $1 " " $2}' |
    LC_ALL=C sort
}

compare_inventory() {
  state=$1
  expected=$2
  actual=$(mktemp)
  inventory "$state" > "$actual"
  if ! diff -u "$expected" "$actual" >&2; then
    rm -f "$actual"
    fail "$state systemd unit inventory differs from $expected"
  fi
  rm -f "$actual"
}

compare_inventory enabled "$enabled_golden"
compare_inventory masked "$masked_golden"

default_target=$(systemctl get-default)
[ "$default_target" = 'multi-user.target' ] ||
  fail "systemd default target is $default_target, expected multi-user.target"

# A build instance does not reboot after GRUB is regenerated. Check the command
# line that the baked bootloader will pass to the next kernel instead of the
# command line of the temporary build instance.
grub_config=${SHIPFOX_GRUB_CONFIG:-/boot/grub/grub.cfg}
grep -Fq 'fsck.mode=skip' "$grub_config" ||
  fail "baked kernel command line is missing fsck.mode=skip in $grub_config"

fstab=${SHIPFOX_FSTAB:-/etc/fstab}
fstab_entry() {
  mount_point=$1
  awk -v mount_point="$mount_point" \
    '$0 !~ /^[[:space:]]*#/ && NF >= 6 && $2 == mount_point {print; exit}' "$fstab"
}

has_fstab_option() {
  options=$1
  option=$2
  case ",$options," in
    *,"$option",*) return 0 ;;
    *) return 1 ;;
  esac
}

check_fstab_entry() {
  mount_point=$1
  required_option=$2
  required_pass=$3
  second_option=${4:-}
  entry=$(fstab_entry "$mount_point")
  [ -n "$entry" ] || fail "$fstab has no entry for $mount_point"

  options=$(printf '%s\n' "$entry" | awk '{print $4}')
  has_fstab_option "$options" "$required_option" ||
    fail "$fstab entry for $mount_point is missing $required_option"
  if [ -n "$second_option" ]; then
    has_fstab_option "$options" "$second_option" ||
      fail "$fstab entry for $mount_point is missing $second_option"
  fi

  pass_number=$(printf '%s\n' "$entry" | awk '{print $6}')
  [ "$pass_number" = "$required_pass" ] ||
    fail "$fstab entry for $mount_point has pass $pass_number, expected $required_pass"
}

check_fstab_entry / noatime 1
check_fstab_entry /boot noatime 0 noauto
check_fstab_entry /boot/efi noauto 0

effective_journald_config=$(systemd-analyze cat-config systemd/journald.conf)
storage=$(printf '%s\n' "$effective_journald_config" |
  sed -n 's/^[[:space:]]*Storage[[:space:]]*=[[:space:]]*//p' |
  tail -n 1)
[ "$storage" = 'volatile' ] ||
  fail "effective journald storage is $storage, expected volatile"

package_state() {
  dpkg-query -W -f='${Status}' "$1" 2>/dev/null || true
}

for package in snapd cloud-init amazon-ssm-agent; do
  if [ "$(package_state "$package")" = 'install ok installed' ]; then
    fail "forbidden package remains installed: $package"
  fi
done

for package in cloud-guest-utils ec2-instance-connect; do
  [ "$(package_state "$package")" = 'install ok installed' ] ||
    fail "required package is missing: $package"
done

command -v growpart >/dev/null 2>&1 || fail 'required command is missing: growpart'

for unit in ssh.socket ec2-instance-connect-harvest-hostkeys.service; do
  systemctl cat "$unit" >/dev/null 2>&1 || fail "required unit is missing: $unit"
  unit_state=$(systemctl is-enabled "$unit" 2>/dev/null || true)
  [ "$unit_state" != 'masked' ] || fail "required unit is masked: $unit"
done

read_limit() {
  key=$1
  sed -n "s/^${key}=//p" "$limits_file" | tail -n 1
}

initramfs_ceiling=$(read_limit initramfs_max_bytes)
snapshot_ceiling=$(read_limit full_snapshot_size_max_bytes)
case "$initramfs_ceiling" in
  ''|*[!0-9]*) fail 'limits.env has no numeric initramfs_max_bytes' ;;
esac
case "$snapshot_ceiling" in
  ''|*[!0-9]*) fail 'limits.env has no numeric full_snapshot_size_max_bytes' ;;
esac

initramfs_path=${SHIPFOX_INITRAMFS_PATH:-}
if [ -z "$initramfs_path" ]; then
  initramfs_path=$(find /boot -maxdepth 1 -type f -name 'initrd.img-*' -print | LC_ALL=C sort | tail -n 1)
fi
[ -n "$initramfs_path" ] || fail 'no initramfs was found under /boot'

initramfs_size=$(stat -c '%s' "$initramfs_path")
case "$initramfs_size" in
  ''|*[!0-9]*) fail "could not read initramfs size for $initramfs_path" ;;
esac
[ "$initramfs_size" -le "$initramfs_ceiling" ] ||
  fail "initramfs $initramfs_path is $initramfs_size bytes, exceeding ceiling $initramfs_ceiling"

printf 'runner image composition verified: %s, initramfs %s bytes, snapshot ceiling %s bytes\n' \
  "$image_identity" "$initramfs_size" "$snapshot_ceiling"
