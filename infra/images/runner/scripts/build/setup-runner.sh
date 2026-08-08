#!/usr/bin/env sh
set -eu

apt-get update
apt-get install --yes --no-install-recommends \
  ca-certificates curl wget git openssh-client tar gzip xz-utils bzip2 zip unzip jq \
  build-essential python3 pkg-config ripgrep fd-find sudo amazon-ec2-utils
rm -rf /var/lib/apt/lists/*

ln -sf "$(command -v fdfind)" /usr/local/bin/fd
groupadd --system shipfox || true
id shipfox >/dev/null 2>&1 || useradd --system --gid shipfox --create-home --home-dir /home/shipfox shipfox
printf '%s\n' 'shipfox ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/shipfox
chmod 0440 /etc/sudoers.d/shipfox
printf '%s\n' 'LANG=C.UTF-8' > /etc/default/locale
install -d -o shipfox -g shipfox /opt/runner
