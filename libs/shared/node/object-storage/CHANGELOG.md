# @shipfox/node-object-storage

## 0.1.0

### Minor Changes

- 9f898d9: Replaces the logs-only `LOG_STORAGE_S3_*` base configuration with shared `OBJECT_STORAGE_S3_*` settings, per-consumer prefixes, and optional overrides, and adds encrypted agent-session transcript persistence. Self-hosters must migrate their S3 settings and provide `AGENT_SESSION_ENCRYPTION_KEK`; the DTO packages receive matching major versions for the API package-family release without DTO schema changes.
