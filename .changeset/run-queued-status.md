---
"@shipfox/client-workflows": patch
---

Report a run that is waiting for a runner as `Queued` rather than as running. The run header
and the run list now split queue time from run time, name the job a queued run is blocked on,
and read the same rule from the jobs each surface already carries.
