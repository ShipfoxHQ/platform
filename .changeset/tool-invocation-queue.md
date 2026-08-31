---
'@shipfox/api-workflows': minor
'@shipfox/api-workflows-dto': minor
'@shipfox/client-workflows': patch
---

Server workflow tool steps now return a `wait` protocol while a scheduled tool call is pending, and clients recognize the new `tool_error`, `tool_config_invalid`, and `invocation_interrupted` step error reasons.
