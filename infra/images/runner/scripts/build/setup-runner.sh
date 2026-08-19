#!/usr/bin/env sh
set -eu

root_dir=${RUNNER_IMAGE_ROOT:-/}

apt-get update
apt-get install --yes --no-install-recommends \
  ca-certificates curl wget git openssh-client tar gzip xz-utils bzip2 zip unzip jq \
  build-essential cloud-guest-utils python3 pkg-config ripgrep fd-find sudo amazon-ec2-utils \
  ec2-instance-connect

# Keep a disk-backed memory reserve available while jobs run.
swapfile="$root_dir/swapfile"
fallocate -l 4G "$swapfile"
chmod 600 "$swapfile"
mkswap "$swapfile"
swapon "$swapfile"
printf '%s\n' '/swapfile none swap sw 0 0' >> "$root_dir/etc/fstab"

# The final image reads its one user-data payload directly from IMDSv2. Keep cloud-init
# only long enough for Packer's initial NoCloud SSH bootstrap, then remove its package and state.
apt-get purge --yes cloud-init
rm -rf "$root_dir/etc/cloud"
# Runner instances have no host-management credentials. Remove snapd and its seeded
# snaps instead of carrying a failed host-management path into every boot.
# Stop snapd before unmounting its seeded loop-backed squashfs filesystems. The base
# image can have these mounts live even after the snapd package is purged.
systemctl stop snapd.seeded.service snapd.service snapd.socket 2>/dev/null || true
for snap_mount in "$root_dir"/snap/* "$root_dir/snap"; do
  if [ -e "$snap_mount" ]; then
    umount "$snap_mount" 2>/dev/null || umount -l "$snap_mount" 2>/dev/null || true
  fi
done
apt-get purge --yes snapd
rm -rf "$root_dir/var/lib/snapd" "$root_dir/snap"

if command -v snap >/dev/null 2>&1 || command -v snapd >/dev/null 2>&1; then
  printf '%s\n' 'runner image setup: snap or snapd is still available after purge' >&2
  exit 1
fi

for removed_path in \
  "$root_dir/var/lib/snapd" \
  "$root_dir/snap" \
  "$root_dir/usr/bin/snap" \
  "$root_dir/usr/lib/snapd/snapd" \
  "$root_dir/lib/systemd/system/snapd.service" \
  "$root_dir/lib/systemd/system/snapd.seeded.service"; do
  if [ -e "$removed_path" ]; then
    printf 'runner image setup: removed snap path still exists: %s\n' "$removed_path" >&2
    exit 1
  fi
done

rm -rf "$root_dir/var/lib/apt/lists/"*

ln -sf "$(command -v fdfind)" "$root_dir/usr/local/bin/fd"
groupadd --system shipfox || true
id shipfox >/dev/null 2>&1 || useradd --system --gid shipfox --create-home --home-dir /home/shipfox shipfox
printf '%s\n' 'shipfox ALL=(ALL) NOPASSWD:ALL' > "$root_dir/etc/sudoers.d/shipfox"
chmod 0440 "$root_dir/etc/sudoers.d/shipfox"
printf '%s\n' 'LANG=C.UTF-8' > "$root_dir/etc/default/locale"
install -d -o shipfox -g shipfox "$root_dir/opt/runner"
