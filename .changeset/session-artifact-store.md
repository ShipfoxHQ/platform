---
"@shipfox/api-agent": minor
"@shipfox/api-secrets": patch
"@shipfox/node-envelope-encryption": minor
---

Persists encrypted agent session transcripts to object storage, adds a retention sweep that deletes expired sessions, and adds KEK rotation for envelope-encrypted artifacts. Deployments must set `AGENT_SESSION_ENCRYPTION_KEK` to a unique base64-encoded 32-byte key before upgrading.
