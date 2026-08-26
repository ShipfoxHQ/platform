# @shipfox/worktree-services

## 1.0.0

### Major Changes

- 9f898d9: Replaces the logs-only `LOG_STORAGE_S3_*` base configuration with shared `OBJECT_STORAGE_S3_*` settings, per-consumer prefixes, and optional overrides, and adds encrypted agent-session transcript persistence. Self-hosters must migrate their S3 settings and provide `AGENT_SESSION_ENCRYPTION_KEK`; the DTO packages receive matching major versions for the API package-family release without DTO schema changes.

## 0.2.1

### Patch Changes

- f78740d: Remove Unicode dash punctuation from package prose and source comments.

## 0.2.0

### Minor Changes

- 5644381: Publish reusable worktree service lifecycle tooling for root checkouts and Conductor workspaces.
