---
"@shipfox/api-definitions": patch
"@shipfox/workflow-document": patch
---

Hardens tool-step validation while the fields stay reserved: `tool` and
`connection` reject interpolation at document parse, a tool id with more than one
dot (`family.method.extra`) is rejected at normalization with `tool-id-invalid`,
and the three output-mapping structural failures (redeclaring `result`,
non-string mapping values, and values that are not exactly one expression) now
emit `tool-output-invalid` instead of `tool-input-invalid`.
