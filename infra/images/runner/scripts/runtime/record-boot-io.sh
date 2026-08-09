#!/usr/bin/env sh
set -eu

root_source="$(findmnt -no SOURCE / || true)"
root_device="$(lsblk -no PKNAME "$root_source" 2>/dev/null | head -n1 | tr -d '[:space:]' || true)"
if [ -z "$root_device" ]; then
  root_device="$(basename "$root_source")"
fi

stat_path="/sys/block/$root_device/stat"
if [ ! -r "$stat_path" ]; then
  printf 'runner boot telemetry: root device stats are unavailable: %s\n' "$stat_path" >&2
  exit 1
fi

read -r read_ops _ read_sectors _ < "$stat_path"
uptime_seconds="$(awk '{print $1}' /proc/uptime)"

install -d -m 0755 /run/shipfox
if [ -e /run/shipfox/boot-io ]; then
  exit 0
fi

temporary_path="$(mktemp /run/shipfox/boot-io.XXXXXX)"
trap 'rm -f "$temporary_path"' EXIT
cat > "$temporary_path" <<EOF
root_device=$root_device
read_ops=$read_ops
read_sectors=$read_sectors
uptime_seconds=$uptime_seconds
EOF
chmod 0644 "$temporary_path"
if ! ln -- "$temporary_path" /run/shipfox/boot-io 2>/dev/null; then
  if [ -e /run/shipfox/boot-io ]; then
    exit 0
  fi
  printf 'runner boot telemetry: failed to publish the boot I/O sample\n' >&2
  exit 1
fi
rm -f "$temporary_path"
trap - EXIT
