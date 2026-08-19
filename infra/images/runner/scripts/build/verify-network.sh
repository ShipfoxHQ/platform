#!/usr/bin/env sh
set -eu

# The bake is the only place that can prove the shipped network configuration selects a real
# interface. A build instance boots on the base image's own generated configuration and keeps
# using it for the whole bake, so an image-provided file that matches nothing passes every text
# assertion and then strands every launched instance without an address.
#
# This removes the base image's configuration, reconfigures the live link from the shipped file,
# and waits for it to become routable. Packer's SSH session rides on that link, so a match that
# selects nothing fails the build here instead of in production.

network_unit="${SHIPFOX_NETWORK_UNIT:-/etc/systemd/network/10-shipfox-primary.network}"
wait_seconds="${SHIPFOX_NETWORK_WAIT_SECONDS:-60}"

if [ ! -f "$network_unit" ]; then
  printf 'verify-network: %s is not installed\n' "$network_unit" >&2
  exit 1
fi

primary_interface="$(ip -o -4 route show default | awk '{print $5; exit}')"
if [ -z "$primary_interface" ]; then
  printf '%s\n' 'verify-network: no default-route interface to verify against' >&2
  exit 1
fi

rm -f /run/systemd/network/*-netplan-*.network
networkctl reload
networkctl reconfigure "$primary_interface"

# Routable alone would also be satisfied by a leftover configuration. Requiring the applied
# network file to be the shipped one is what proves the match selected this link.
elapsed=0
while [ "$elapsed" -lt "$wait_seconds" ]; do
  status="$(networkctl status --no-pager "$primary_interface" 2>/dev/null || true)"
  case "$status" in
    *"Network File: $network_unit"*)
      case "$status" in
        *'State: routable'*)
          printf '%s\n' "$status"
          exit 0
          ;;
      esac
      ;;
  esac
  sleep 1
  elapsed=$((elapsed + 1))
done

printf 'verify-network: %s did not become routable under %s within %ss\n' \
  "$primary_interface" "$network_unit" "$wait_seconds" >&2
networkctl status --no-pager "$primary_interface" >&2 || true
exit 1
