---
"@shipfox/api-definitions": patch
"@shipfox/workflow-document": patch
---

Hardens tool-step validation while the fields stay reserved:

- `tool` and `connection` reject interpolation at document parse and at
  workflow-model normalization (`tool-id-invalid`), so a tool step always
  resolves to a fixed catalog entry and connection slug.
- A tool id that is not a standalone id or `family.method` with a single dot —
  including boundary dots (`issue_write.`, `.issue_read.get`) and a second dot
  (`issue_write.update.extra`) — is rejected at normalization with
  `tool-id-invalid`.
- The three output-mapping structural failures (redeclaring `result`,
  non-string mapping values, and values that are not exactly one expression)
  now emit `tool-output-invalid` instead of `tool-input-invalid`;
  `tool-input-invalid` stays reserved for input validation failures.

`@shipfox/api-definitions` and `@shipfox/workflow-document` release together;
install them as a pair so document parsing and model validation report the same
diagnostics.
