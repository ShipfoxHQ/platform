#!/usr/bin/env sh
set -eu

# The runner service keeps its stdout attached to the EC2 console so the boot timeline can be
# collected with GetConsoleOutput. Keep the rest of the runner's output in journald by redirecting
# the child process to stderr while preserving the console descriptor as an extra file descriptor.
exec 3>&1

if [ "$#" -eq 0 ]; then
  set -- /usr/local/bin/node dist/index.js
fi

export SHIPFOX_BOOT_CONSOLE_FD=3
exec "$@" 1>&2
