---
"@shipfox/client-agent": patch
"@shipfox/client-integrations": patch
"@shipfox/client-projects": patch
"@shipfox/client-secrets": patch
"@shipfox/client-triggers": patch
---

Compose the shared `Panel` primitives instead of hand-rolling the panel class string in each package. Grids of openable things, such as the integration gallery, the available providers grid, and the harness picker, become cells inside one panel rather than standalone bordered tiles. That matches the projects hub and gives every one of these surfaces the same hover, focus, and elevation treatment.
