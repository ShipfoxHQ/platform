---
'@shipfox/api-runners': patch
---

Align demand polling and reservation cleanup runner row lock ordering.
Recheck runner eligibility before binding after row-lock acquisition.
