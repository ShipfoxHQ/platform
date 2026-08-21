---
"@shipfox/client-integrations": patch
---

Closes the integration usage modal through the shared Modal lifecycle instead of unmounting it directly. Requires the matching `@shipfox/react-ui` patch for the closed-state pointer-events guard.
