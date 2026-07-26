---
'@shipfox/client-shell': minor
'@shipfox/node-email': patch
---

Serve `/email-logo.png` from `@shipfox/client-shell`. Transactional emails link the logo at `CLIENT_BASE_URL + /email-logo.png`, but the asset only existed in this repository's own `apps/client/public/`, so any other client composed with the shell answered that path with its SPA fallback and mail clients rendered a broken image. The manifest plugin now owns the asset alongside the favicons, and it ships in the package. An application that keeps its own `public/email-logo.png` must delete it, since the plugin rejects conflicting copies.
