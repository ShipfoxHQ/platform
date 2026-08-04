---
"@shipfox/react-ui": patch
"@shipfox/client-integrations": patch
"@shipfox/client-triggers": patch
"@shipfox/client-runners": patch
"@shipfox/client-projects": patch
---

Migrates the integrations, triggers, runners, and projects client surfaces to semantic spacing roles and enables `no-raw-spacing` for them. Adds the `gap-x-*` and `gap-y-*` axis roles and the `-mx-inline` bleed role so grids with differing column and row rhythm, and rows that cancel their own `px-tight`, stay on the density-aware scale.
