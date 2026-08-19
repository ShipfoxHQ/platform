#!/usr/bin/env sh
set -eu

umask 077

imds_base_url='http://169.254.169.254'
runner_env_dir='/etc/shipfox'
runner_env_path="$runner_env_dir/runner.env"
runner_env_temp_path="$runner_env_dir/runner.env.tmp"
workspace_root='/var/lib/shipfox/workspaces'
workspace_mount_unit='var-lib-shipfox-workspaces.mount'
runner_mount_dropin_dir='/etc/systemd/system/shipfox-runner.service.d'
# A fixed attempt count spends a different amount of wall clock on every instance type and
# provider. Bound the wait by time instead, below the unit's own TimeoutStartSec.
retry_deadline_seconds="${SHIPFOX_BOOTSTRAP_RETRY_DEADLINE_SECONDS:-240}"
retry_delay_seconds="${SHIPFOX_BOOTSTRAP_RETRY_DELAY_SECONDS:-1}"

# chrony starts alongside this unit and steps the clock on its first updates, so a wall-clock
# bound can move under the retry loop. /proc/uptime cannot.
uptime_seconds() {
  awk '{print int($1)}' /proc/uptime
}

abort_boot() {
  printf 'shipfox bootstrap: %s\n' "$1" >&2
  printf '%s\n' 'shipfox bootstrap: link and route state at abort:' >&2
  ip -brief address >&2 || true
  ip route >&2 || true
  if ! systemctl poweroff --no-wall; then
    /sbin/poweroff -f || true
  fi
  exit 1
}

validate_runner_env() {
  awk '
  BEGIN {
    required_count = split("SHIPFOX_API_URL SHIPFOX_RUNNER_BOOTSTRAP_TOKEN SHIPFOX_RUNNER_PROVIDER_KIND SHIPFOX_RUNNER_PROTOCOL_VERSION SHIPFOX_RUNNER_LABELS SHIPFOX_RUNNER_WORKSPACE_ROOT SHIPFOX_POLL_MAX_DURATION_MS SHIPFOX_RUNNER_MAX_LIFETIME_SECONDS", required, " ")
    for (i = 1; i <= required_count; i++) allowed[required[i]] = 1
  }

  {
    separator = index($0, "=")
    if (separator < 2 || $0 ~ /\r/) {
      invalid = 1
      next
    }

    key = substr($0, 1, separator - 1)
    value = substr($0, separator + 1)
    if (!(key in allowed) || seen[key] || value == "" || value == "\"\"") invalid = 1
    seen[key] = 1
  }

  END {
    for (i = 1; i <= required_count; i++) {
      if (!seen[required[i]]) invalid = 1
    }
    exit invalid
  }
  ' "$1"
}

fetch_user_data() {
  token=''
  # Each attempt can block in curl for longer than the delay, so the bound reads a clock rather
  # than counting iterations. Testing it before the attempt keeps a sleep that crosses the
  # deadline from buying one more full attempt.
  deadline=$(($(uptime_seconds) + retry_deadline_seconds))
  while [ "$(uptime_seconds)" -lt "$deadline" ]; do
    token="$(curl --fail --silent --show-error --noproxy '*' --connect-timeout 2 --max-time 5 \
      --request PUT \
      --header 'X-aws-ec2-metadata-token-ttl-seconds: 21600' \
      "$imds_base_url/latest/api/token" 2>/dev/null || true)"
    if [ -n "$token" ] && curl --fail --silent --show-error --noproxy '*' --connect-timeout 2 --max-time 5 \
      --header "X-aws-ec2-metadata-token: $token" \
      --output "$user_data_fetch_path" \
      "$imds_base_url/latest/user-data"; then
      return 0
    fi

    rm -f "$user_data_fetch_path"
    sleep "$retry_delay_seconds"
  done
  return 1
}

grow_root_filesystem() {
  root_source="$(findmnt -n -o SOURCE / 2>/dev/null || true)"
  root_source="$(readlink -f "$root_source" 2>/dev/null || true)"
  if [ -z "$root_source" ] || [ ! -b "$root_source" ]; then
    abort_boot 'Unable to identify the root filesystem.'
  fi

  root_type="$(lsblk -ndo TYPE "$root_source" 2>/dev/null || true)"
  if [ "$root_type" = 'disk' ]; then
    root_disk="$root_source"
    root_disk_size="$(blockdev --getsize64 "$root_disk" 2>/dev/null || true)"
    root_filesystem_size="$(df -B1 --output=size / | tail -n 1 | tr -d '[:space:]')"
    if [ -z "$root_disk_size" ] || [ -z "$root_filesystem_size" ]; then
      abort_boot 'Unable to measure the root filesystem.'
    fi
    if [ "$root_disk_size" -gt "$root_filesystem_size" ]; then
      if ! resize2fs "$root_source"; then
        abort_boot 'Unable to grow the root filesystem.'
      fi
    fi
    return
  fi

  root_disk_name="$(lsblk -ndo PKNAME "$root_source" 2>/dev/null | head -n 1 | tr -d '[:space:]')"
  root_partition_number="$(lsblk -ndo PARTNUM "$root_source" 2>/dev/null | head -n 1 | tr -d '[:space:]')"
  if [ -z "$root_disk_name" ] || [ -z "$root_partition_number" ]; then
    abort_boot 'Unable to identify the root partition.'
  fi
  root_disk="/dev/$root_disk_name"
  root_disk_size="$(blockdev --getsize64 "$root_disk" 2>/dev/null || true)"
  root_partition_size="$(blockdev --getsize64 "$root_source" 2>/dev/null || true)"
  if [ -z "$root_disk_size" ] || [ -z "$root_partition_size" ]; then
    abort_boot 'Unable to measure the root partition.'
  fi
  if [ "$root_disk_size" -le "$root_partition_size" ]; then
    return
  fi

  if ! command -v growpart >/dev/null 2>&1; then
    abort_boot 'growpart is not installed.'
  fi
  if ! growpart "$root_disk" "$root_partition_number"; then
    abort_boot 'Unable to grow the root partition.'
  fi
  if ! resize2fs "$root_source"; then
    abort_boot 'Unable to grow the root filesystem.'
  fi
}

resolve_workspace_device() {
  workspace_candidate_count=0
  workspace_device=''
  for candidate in $(lsblk -dnro NAME,TYPE | awk '$2 == "disk" {print "/dev/" $1}'); do
    if [ "$candidate" = "$root_disk" ]; then
      continue
    fi

    model="$(cat "/sys/class/block/$(basename "$candidate")/device/model" 2>/dev/null || true)"
    case "$model" in
      *'Amazon EC2 NVMe Instance Storage'*)
        continue
        ;;
      *'Amazon Elastic Block Store'*)
        ;;
      '')
        case "$candidate" in
          /dev/sd*|/dev/xvd*)
            ;;
          *)
            continue
            ;;
        esac
        ;;
      *)
        continue
        ;;
    esac

    workspace_candidate_count=$((workspace_candidate_count + 1))
    workspace_device="$candidate"
  done

  if [ "$workspace_candidate_count" -ne 1 ]; then
    abort_boot "Unable to uniquely resolve the EC2 workspace disk; found $workspace_candidate_count non-root EBS disks."
  fi

  workspace_disk_name="$(lsblk -ndo PKNAME "$workspace_device" 2>/dev/null | head -n 1 | tr -d '[:space:]')"
  if [ -z "$workspace_disk_name" ]; then
    workspace_disk_name="$(lsblk -ndo NAME "$workspace_device" 2>/dev/null | head -n 1 | tr -d '[:space:]')"
  fi
  if [ -z "$workspace_disk_name" ] || [ "/dev/$workspace_disk_name" = "$root_disk" ]; then
    abort_boot 'The EC2 workspace disk resolves to the root disk.'
  fi
}

configure_workspace_mount() {
  if ! install -d -o shipfox -g shipfox "$workspace_root"; then
    abort_boot "Unable to create the EC2 workspace directory at $workspace_root."
  fi

  resolve_workspace_device
  if ! blkid "$workspace_device" >/dev/null 2>&1; then
    if ! mkfs.ext4 -F -E lazy_itable_init=1,lazy_journal_init=1 -L shipfox-workspc "$workspace_device"; then
      abort_boot "Unable to format the EC2 workspace device $workspace_device."
    fi
  fi

  workspace_uuid="$(blkid -s UUID -o value "$workspace_device" 2>/dev/null || true)"
  if [ -z "$workspace_uuid" ]; then
    abort_boot 'The EC2 workspace disk has no filesystem UUID.'
  fi

  workspace_mount_unit_path="/etc/systemd/system/$workspace_mount_unit"
  if ! printf '%s\n' \
    '[Unit]' \
    'Description=Mount the Shipfox job workspace volume' \
    '' \
    '[Mount]' \
    "What=UUID=$workspace_uuid" \
    "Where=$workspace_root" \
    'Type=ext4' \
    'Options=defaults,nofail' \
    '' \
    '[Install]' \
    'WantedBy=multi-user.target' > "$workspace_mount_unit_path"; then
    abort_boot "Unable to write the EC2 workspace mount unit at $workspace_mount_unit_path."
  fi

  runner_mount_dropin_path="$runner_mount_dropin_dir/10-shipfox-workspace.conf"
  if ! mkdir -p "$runner_mount_dropin_dir"; then
    abort_boot "Unable to create the runner mount dependency directory at $runner_mount_dropin_dir."
  fi
  if ! printf '%s\n' '[Unit]' "Requires=$workspace_mount_unit" "After=$workspace_mount_unit" > "$runner_mount_dropin_path"; then
    abort_boot "Unable to write the runner mount dependency at $runner_mount_dropin_path."
  fi

  if ! systemctl daemon-reload; then
    abort_boot 'Unable to reload systemd after configuring the EC2 workspace mount.'
  fi
  if ! systemctl enable "$workspace_mount_unit"; then
    abort_boot "Unable to enable the EC2 workspace mount unit $workspace_mount_unit."
  fi
  if ! systemctl start "$workspace_mount_unit"; then
    abort_boot "Unable to start the EC2 workspace mount unit $workspace_mount_unit."
  fi
  if ! mountpoint -q "$workspace_root"; then
    abort_boot "The EC2 workspace volume did not mount at $workspace_root."
  fi
  if ! chown shipfox:shipfox "$workspace_root"; then
    abort_boot "Unable to assign ownership of the EC2 workspace directory at $workspace_root."
  fi
}

install -d -m 0755 "$runner_env_dir"
rm -f "$runner_env_path" "$runner_env_temp_path"
user_data_fetch_path="$(mktemp "$runner_env_dir/runner.env.fetch.XXXXXX")"
trap 'rm -f "$user_data_fetch_path" "$runner_env_temp_path"' EXIT

# Cloud-init used to create these keys on each boot. Remove them from the AMI during
# the bake and recreate them here so EC2 Instance Connect never sees shared keys.
if ! /usr/bin/ssh-keygen -A; then
  abort_boot 'Unable to generate SSH host keys.'
fi

if ! fetch_user_data; then
  abort_boot 'Unable to read runner user data from IMDSv2 after retries.'
fi
if ! install -m 0600 -o root -g root "$user_data_fetch_path" "$runner_env_temp_path"; then
  abort_boot 'Unable to stage runner user data.'
fi
if ! validate_runner_env "$runner_env_temp_path"; then
  rm -f "$runner_env_temp_path"
  abort_boot 'Runner user data is not a valid environment file.'
fi

grow_root_filesystem
configure_workspace_mount

if ! mv -- "$runner_env_temp_path" "$runner_env_path"; then
  abort_boot 'Unable to publish the runner environment after boot setup.'
fi
