#!/bin/bash
set -euo pipefail

# The runner service keeps its stdout attached to the EC2 console so the boot timeline can be
# collected with GetConsoleOutput. Keep the rest of the runner's output in journald: this filter
# forwards only the explicitly marked boot-timeline record to the inherited console descriptor.
exec 3>&1

if [ "$#" -eq 0 ]; then
  set -- /usr/local/bin/node dist/index.js
fi

set +e
"$@" 2>&1 |
  awk -v console_path=/dev/fd/3 '
    index($0, "\"console_marker\":\"runner_boot_timeline\"") {
      print $0 > console_path
      fflush(console_path)
      next
    }
    {
      print $0 > "/dev/stderr"
      fflush("/dev/stderr")
    }
  '

pipeline_status=("${PIPESTATUS[@]}")
set -e
runner_status=${pipeline_status[0]}
filter_status=${pipeline_status[1]}
if [ "$runner_status" -ne 0 ]; then
  exit "$runner_status"
fi
exit "$filter_status"
