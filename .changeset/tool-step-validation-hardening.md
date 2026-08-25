---
"@shipfox/api-definitions": patch
"@shipfox/workflow-document": patch
---

Hardens tool-step validation while the fields stay reserved:

- `tool` and `connection` reject interpolation at document parse and at
  workflow-model normalization (`tool-id-invalid`).
- A tool id that is not a standalone id or `family.method` with a single dot
  fails normalization with `tool-id-invalid`. This covers boundary dots
  (`issue_write.`, `.issue_read.get`) and a second dot
  (`issue_write.update.extra`).
- The three output-mapping structural failures (a duplicate `result`
  declaration, non-string mapping values, and values that are not exactly one
  expression) now emit `tool-output-invalid` instead of `tool-input-invalid`;
  `tool-input-invalid` stays reserved for input validation failures.

