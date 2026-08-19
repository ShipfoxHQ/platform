#!/usr/bin/env sh
set -eu

# Runner instances are ephemeral. These units either repeat work already done while
# baking the image or maintain state that has no value after the instance exits.
# configure-boot.sh leaves /boot and /boot/efi detached at runtime. This inventory
# includes the image's package, bootloader, and firmware writers so they cannot
# update the root-volume shadow directories behind those detached mounts.
# Keep the policy explicit. The bake fails when a base image no longer contains
# one of these units, so a renamed writer cannot silently weaken the gate.

# apt-daily.service: package indexes are installed and cleaned during the image bake.
apt_daily_service='apt-daily.service'
# apt-daily-upgrade.service: package upgrades are intentionally owned by image release.
apt_daily_upgrade_service='apt-daily-upgrade.service'
# apt-daily.timer: package refreshes must not start after the image is published.
apt_daily_timer='apt-daily.timer'
# apt-daily-upgrade.timer: package upgrades must not start after the image is published.
apt_daily_upgrade_timer='apt-daily-upgrade.timer'
# unattended-upgrades.service: security updates run during the image build instead.
unattended_upgrades_service='unattended-upgrades.service'
# systemd-journal-flush.service: the runner journal is volatile and has no disk journal to flush.
systemd_journal_flush_service='systemd-journal-flush.service'
# lvm2-monitor.service: runner root disks are direct EBS or QEMU devices, not LVM volumes.
lvm2_monitor_service='lvm2-monitor.service'
# multipathd.service: runners do not attach multipath storage.
multipathd_service='multipathd.service'
# multipathd.socket: runners do not attach multipath storage.
multipathd_socket='multipathd.socket'
# ufw.service: provider network controls own the runner boundary and no host firewall is configured.
ufw_service='ufw.service'
# plymouth-read-write.service: runners are headless and do not need a boot splash.
plymouth_read_write_service='plymouth-read-write.service'
# plymouth-quit.service: runners are headless and do not need a boot splash.
plymouth_quit_service='plymouth-quit.service'
# plymouth-quit-wait.service: runners are headless and do not need a boot splash.
plymouth_quit_wait_service='plymouth-quit-wait.service'
# udisks2.service: runners do not manage desktop or removable disks.
udisks2_service='udisks2.service'
# ModemManager.service: runners have no modem hardware to manage.
modem_manager_service='ModemManager.service'
# apport.service: job logs and runner telemetry replace local crash-report collection.
apport_service='apport.service'
# sysstat.service: ephemeral runner accounting has no value after instance termination.
sysstat_service='sysstat.service'
# e2scrub_reap.service: runners do not keep long-lived filesystem snapshots to scrub.
e2scrub_reap_service='e2scrub_reap.service'
# hibinit-agent.service: runner instances never hibernate and terminate after their work.
hibinit_agent_service='hibinit-agent.service'
# grub-common.service: the baked bootloader does not need per-instance maintenance.
grub_common_service='grub-common.service'
# grub-initrd-fallback.service: runners do not need an interactive bootloader fallback.
grub_initrd_fallback_service='grub-initrd-fallback.service'
# keyboard-setup.service: runners are headless and do not accept local keyboard input.
keyboard_setup_service='keyboard-setup.service'
# console-setup.service: runners are headless and do not need a local console layout.
console_setup_service='console-setup.service'
# cryptdisks-early.service: runner root volumes do not use encrypted block devices.
cryptdisks_early_service='cryptdisks-early.service'
# cryptdisks.service: runner root volumes do not use encrypted block devices.
cryptdisks_service='cryptdisks.service'
# hwclock.service: runner instances receive time from the provider instead of a hardware clock.
hwclock_service='hwclock.service'
# setvtrgb.service: runners are headless and do not need virtual-terminal colors.
setvtrgb_service='setvtrgb.service'
# getty@tty1.service: runners are headless and expose no interactive local login.
getty_tty1_service='getty@tty1.service'
# motd-news.timer: runner instances do not display a login message.
motd_news_timer='motd-news.timer'
# update-notifier-download.timer: runner instances do not need notification metadata.
update_notifier_download_timer='update-notifier-download.timer'
# update-notifier-motd.timer: runner instances do not display a login message.
update_notifier_motd_timer='update-notifier-motd.timer'
# fwupd-refresh.timer: runner instances do not own firmware updates.
fwupd_refresh_timer='fwupd-refresh.timer'
# man-db.timer: runner images do not need to rebuild local manual-page indexes.
man_db_timer='man-db.timer'
# logrotate.timer: host logs are volatile and job logs are retained by the job pipeline.
logrotate_timer='logrotate.timer'
# e2scrub_all.timer: runners do not keep long-lived filesystem snapshots to scrub.
e2scrub_all_timer='e2scrub_all.timer'
# fstrim.timer: the runner root disk is discarded with the instance.
fstrim_timer='fstrim.timer'
# dpkg-db-backup.timer: package database backups have no value on a disposable instance.
dpkg_db_backup_timer='dpkg-db-backup.timer'
# sysstat-collect.timer: ephemeral runner accounting has no value after instance termination.
sysstat_collect_timer='sysstat-collect.timer'
# sysstat-summary.timer: ephemeral runner accounting has no value after instance termination.
sysstat_summary_timer='sysstat-summary.timer'
# sudo.service: the image does not need a boot-time sudo helper.
sudo_service='sudo.service'
# x11-common.service: runners do not run an X11 session.
x11_common_service='x11-common.service'

masked_units="
  $apt_daily_service
  $apt_daily_upgrade_service
  $apt_daily_timer
  $apt_daily_upgrade_timer
  $unattended_upgrades_service
  $systemd_journal_flush_service
  $lvm2_monitor_service
  $multipathd_service
  $multipathd_socket
  $ufw_service
  $plymouth_read_write_service
  $plymouth_quit_service
  $plymouth_quit_wait_service
  $udisks2_service
  $modem_manager_service
  $apport_service
  $sysstat_service
  $e2scrub_reap_service
  $hibinit_agent_service
  $grub_common_service
  $grub_initrd_fallback_service
  $keyboard_setup_service
  $console_setup_service
  $cryptdisks_early_service
  $cryptdisks_service
  $hwclock_service
  $setvtrgb_service
  $getty_tty1_service
  $motd_news_timer
  $update_notifier_download_timer
  $update_notifier_motd_timer
  $fwupd_refresh_timer
  $man_db_timer
  $logrotate_timer
  $e2scrub_all_timer
  $fstrim_timer
  $dpkg_db_backup_timer
  $sysstat_collect_timer
  $sysstat_summary_timer
  $sudo_service
  $x11_common_service
"

# systemctl mask creates a /dev/null alias even for a unit that does not exist.
# Check the targeted policy before masking so a removed or renamed writer needs review.
for unit in $masked_units; do
  if ! systemctl cat "$unit" >/dev/null 2>&1; then
    echo "Runner image boot policy requires unit $unit, but it is not installed." >&2
    exit 1
  fi
done

# --now closes an already-running maintenance window before Packer snapshots the image.
systemctl mask --now $masked_units

# Verify the manager accepted every mask instead of trusting systemctl's exit status alone.
for unit in $masked_units; do
  state="$(systemctl is-enabled "$unit" 2>/dev/null || true)"
  if [ "$state" != 'masked' ]; then
    echo "Runner image boot policy failed to mask $unit (state: $state)." >&2
    exit 1
  fi
done

# This override is test-only. Production always writes the system drop-in below /etc.
journald_drop_in="${SHIPFOX_JOURNAL_DROP_IN:-/etc/systemd/journald.conf.d/shipfox-volatile.conf}"
journal_runtime_max_use='64M'
journal_rate_limit_interval='30s'
journal_rate_limit_burst='1000'
install -d -m 0755 "$(dirname "$journald_drop_in")"
cat > "$journald_drop_in" <<EOF
[Journal]
Storage=volatile
RuntimeMaxUse=$journal_runtime_max_use
RateLimitIntervalSec=$journal_rate_limit_interval
RateLimitBurst=$journal_rate_limit_burst
EOF

# cat-config includes every applicable drop-in in precedence order. The last value
# for each key is the effective value, so a later image-provided override fails the bake.
effective_journald_config="$(systemd-analyze cat-config systemd/journald.conf)"
config_value() {
  printf '%s\n' "$effective_journald_config" |
    sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" |
    tail -n 1
}

if [ "$(config_value Storage)" != 'volatile' ]; then
  echo 'Runner image boot policy requires volatile journald storage.' >&2
  exit 1
fi
if [ "$(config_value RuntimeMaxUse)" != "$journal_runtime_max_use" ]; then
  echo "Runner image boot policy requires RuntimeMaxUse=$journal_runtime_max_use." >&2
  exit 1
fi
if [ "$(config_value RateLimitIntervalSec)" != "$journal_rate_limit_interval" ]; then
  echo "Runner image boot policy requires RateLimitIntervalSec=$journal_rate_limit_interval." >&2
  exit 1
fi
if [ "$(config_value RateLimitBurst)" != "$journal_rate_limit_burst" ]; then
  echo "Runner image boot policy requires RateLimitBurst=$journal_rate_limit_burst." >&2
  exit 1
fi
