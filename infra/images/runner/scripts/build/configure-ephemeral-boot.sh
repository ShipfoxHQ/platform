#!/usr/bin/env sh
set -eu

# Runner instances are ephemeral. These units either repeat work already done while
# baking the image or write state that has no value after the instance exits.
systemctl mask \
  apt-daily.service \
  apt-daily-upgrade.service \
  apt-daily.timer \
  apt-daily-upgrade.timer \
  unattended-upgrades.service \
  systemd-fsck-root.service \
  systemd-fsck@.service \
  systemd-journal-flush.service

journald_drop_in=/etc/systemd/journald.conf.d/shipfox-volatile.conf
install -d -m 0755 "$(dirname "$journald_drop_in")"
cat > "$journald_drop_in" <<'EOF'
[Journal]
Storage=volatile
EOF
