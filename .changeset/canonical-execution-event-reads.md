---
"@shipfox/api-workflows": minor
"@shipfox/api-workflows-dto": minor
---

Exposes canonical workflow execution event list and detail reads. Context reads
use canonical listener rows when available and retain the legacy execution-array
fallback for older executions; canonical list and detail reads only include rows
with a listener-event record because legacy arrays do not retain event references.
