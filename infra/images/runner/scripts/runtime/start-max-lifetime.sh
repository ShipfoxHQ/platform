#!/usr/bin/env sh
set -eu

. /opt/shipfox-runner/scripts/runtime/helpers/logger.sh

# This fail-closed image default is deliberately independent from provisioner-core's
# configurable default: it still bounds a runner when user-data is absent or malformed.
default_lifetime_seconds=3600
lifetime_seconds="$default_lifetime_seconds"

if [ -r /etc/shipfox/runner.env ]; then
  configured_lifetime="$(sed -n 's/^SHIPFOX_RUNNER_MAX_LIFETIME_SECONDS=//p' /etc/shipfox/runner.env | tail -n 1)"
  case "$configured_lifetime" in
    \"*\")
      configured_lifetime="${configured_lifetime#\"}"
      configured_lifetime="${configured_lifetime%\"}"
      ;;
  esac
  case "$configured_lifetime" in
    ''|*[!0-9]*) ;;
    *)
      if [ "$configured_lifetime" -gt 0 ]; then
        lifetime_seconds="$configured_lifetime"
      fi
      ;;
  esac
fi

log "Scheduling hard runner lifetime limit in ${lifetime_seconds}s"
exec systemd-run --unit=shipfox-max-lifetime-poweroff --on-active="${lifetime_seconds}s" /usr/bin/systemctl poweroff --force
