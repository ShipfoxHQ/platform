#!/usr/bin/env sh
set -eu

root_source=''
root_device=''
read_ops=''
read_sectors=''
uptime_seconds=''
temporary_path=''
boot_io_marker_emitted=0

emit_boot_io_marker() {
  if [ "$boot_io_marker_emitted" -eq 1 ]; then
    return 0
  fi

  if [ -z "$uptime_seconds" ]; then
    uptime_seconds="$(awk '{print $1}' /proc/uptime 2>/dev/null || printf 'unknown')"
  fi

  boot_io_marker_emitted=1
  if [ "$1" = ok ]; then
    printf 'shipfox-boot phase=boot-io status=ok uptime=%s root_device=%s read_ops=%s read_sectors=%s\n' \
      "$uptime_seconds" "$root_device" "$read_ops" "$read_sectors"
  else
    printf 'shipfox-boot phase=boot-io status=fail uptime=%s\n' "$uptime_seconds"
  fi
}

on_exit() {
  if [ -n "$temporary_path" ]; then
    rm -f "$temporary_path" || true
  fi
  emit_boot_io_marker fail
}

on_signal() {
  emit_boot_io_marker fail
  exit 124
}

trap on_exit EXIT
trap on_signal HUP INT TERM

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
  boot_io_marker_emitted=1
  exit 0
fi

temporary_path="$(mktemp /run/shipfox/boot-io.XXXXXX)"
cat > "$temporary_path" <<EOF
root_device=$root_device
read_ops=$read_ops
read_sectors=$read_sectors
uptime_seconds=$uptime_seconds
EOF
chmod 0644 "$temporary_path"
if ! ln -- "$temporary_path" /run/shipfox/boot-io 2>/dev/null; then
  if [ -e /run/shipfox/boot-io ]; then
    boot_io_marker_emitted=1
    exit 0
  fi
  printf 'runner boot telemetry: failed to publish the boot I/O sample\n' >&2
  exit 1
fi
rm -f "$temporary_path"
temporary_path=''
emit_boot_io_marker ok
