---
"@shipfox/api-definitions": patch
"@shipfox/api-projects-dto": minor
---

Resolves a workflow lineage id on GET /definitions/:id by selecting the project's default-branch row, or 404 when the file is not on that branch.
