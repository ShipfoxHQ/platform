# @shipfox/node-envelope-encryption

## 0.2.1

### Patch Changes

- b416c4c: Preserves existing package behavior while simplifying internal control flow.

## 0.2.0

### Minor Changes

- 9f898d9: Persists encrypted agent session transcripts to object storage, adds a retention sweep that deletes expired sessions, and adds KEK rotation for envelope-encrypted artifacts. Deployments must set `AGENT_SESSION_ENCRYPTION_KEK` to a unique base64-encoded 32-byte key before upgrading.
