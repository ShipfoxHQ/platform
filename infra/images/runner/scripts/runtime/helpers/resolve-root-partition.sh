#!/usr/bin/env sh

resolve_root_partition() {
  root_partition_name="$(basename "$1")"
  root_disk_name="$(lsblk -ndo PKNAME "$1" 2>/dev/null | head -n 1 | tr -d '[:space:]')"
  root_partition_number="$(cat "/sys/class/block/$root_partition_name/partition" 2>/dev/null | tr -d '[:space:]')"
  [ -n "$root_disk_name" ] && [ -n "$root_partition_number" ]
}
