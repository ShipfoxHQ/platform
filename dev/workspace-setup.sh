#!/usr/bin/env bash

set -euo pipefail

die() {
  printf 'workspace setup: %s\n' "$*" >&2
  exit 1
}

resolve_profile() {
  local explicit_profile=${SHIPFOX_SETUP_PROFILE:-}

  if [[ -n "$explicit_profile" ]]; then
    case "$explicit_profile" in
      conductor-local|conductor-cloud|workflow|developer)
        printf '%s\n' "$explicit_profile"
        return
        ;;
      *)
        die "SHIPFOX_SETUP_PROFILE must be one of conductor-local, conductor-cloud, workflow, or developer (received '$explicit_profile')."
        ;;
    esac
  fi

  case "${CONDUCTOR_IS_LOCAL:-}" in
    1)
      printf '%s\n' conductor-local
      ;;
    0)
      printf '%s\n' conductor-cloud
      ;;
    '')
      if [[ -n "${SHIPFOX_WORKSPACE:-}" ]]; then
        printf '%s\n' workflow
      else
        printf '%s\n' developer
      fi
      ;;
    *)
      die "CONDUCTOR_IS_LOCAL must be 1 or 0 when set (received '${CONDUCTOR_IS_LOCAL}')."
      ;;
  esac
}

require_command() {
  local command_name=$1

  command -v "$command_name" >/dev/null 2>&1 ||
    die "'$command_name' is required; install it before running workspace:setup."
}

prepare_root_tools() {
  local root_path=${CONDUCTOR_ROOT_PATH:-}

  [[ -z "$root_path" ]] && return

  [[ -d "$root_path" ]] ||
    die "CONDUCTOR_ROOT_PATH '$root_path' does not exist or is not a directory."
  [[ -f "$root_path/mise.toml" ]] ||
    die "CONDUCTOR_ROOT_PATH '$root_path' does not contain mise.toml."

  require_command mise
  mise -C "$root_path" trust --yes mise.toml
  mise -C "$root_path" install
}

install_dependencies() {
  require_command pnpm
  pnpm -r install --frozen-lockfile
  printf 'workspace setup: repository context is tracked; no generated context step is required.\n'
}

has_linux_dependency_privileges() {
  if [[ "$(id -u)" -eq 0 ]]; then
    return 0
  fi

  command -v sudo >/dev/null 2>&1 || return 1
  sudo -n -v >/dev/null 2>&1
}

install_test_browser() {
  local args=(install chromium)

  if [[ "$(uname -s)" == Linux ]]; then
    if has_linux_dependency_privileges; then
      args=(install --with-deps chromium)
    else
      printf 'workspace setup: passwordless sudo is unavailable; installing Chromium without Linux dependencies.\n' >&2
    fi
  fi

  require_command pnpm
  pnpm --filter=@shipfox/playwright exec playwright "${args[@]}"
}

start_worktree_services() {
  if ! command -v docker >/dev/null 2>&1; then
    die "Docker is required for this setup profile; install Docker before running workspace:setup."
  fi

  if ! docker compose version >/dev/null 2>&1; then
    die "Docker Compose is required for this setup profile; install or enable the Docker Compose plugin."
  fi

  if ! docker info >/dev/null 2>&1; then
    die "Docker daemon is unavailable; start Docker before running workspace:setup."
  fi

  require_command pnpm
  pnpm dev:services:up
}

start_shared_ollama() {
  require_command mise
  mise run ollama:up
}

run_context() {
  local profile
  profile=$(resolve_profile)

  if [[ "$profile" == "conductor-local" ]]; then
    prepare_root_tools
  fi

  install_dependencies
}

run_services() {
  local profile
  profile=$(resolve_profile)

  case "$profile" in
    conductor-local|developer)
      start_worktree_services
      start_shared_ollama
      ;;
    workflow)
      start_worktree_services
      ;;
    conductor-cloud)
      ;;
  esac

  install_test_browser
  printf 'workspace setup: ready (%s).\n' "$profile"
}

usage() {
  printf 'Usage: %s <context|services>\n' "${0##*/}" >&2
  exit 1
}

main() {
  case "${1:-}" in
    context)
      run_context
      ;;
    services)
      run_services
      ;;
    *)
      usage
      ;;
  esac
}

main "$@"
