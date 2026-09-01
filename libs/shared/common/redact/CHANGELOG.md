# @shipfox/redact

## 0.2.7

### Patch Changes

- b416c4c: Preserves existing package behavior while simplifying internal control flow.

## 0.2.6

### Patch Changes

- f78740d: Remove Unicode dash punctuation from package prose and source comments.

## 0.2.5

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.

## 0.2.4

### Patch Changes

- 8436596: Adds Dependency Cruiser checks to all classified API packages so source-edge enforcement remains active after retiring the duplicate import scan.
- 475ce59: Republishes all public packages after restoring release authorization.

## 0.2.3

### Patch Changes

- 7ac43a4: Consolidates packed-consumer validation around stable publication and composition contracts instead of package-state snapshots.

## 0.2.2

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.

## 0.2.1

### Patch Changes

- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.

## 0.2.0

### Minor Changes

- 68b8d03: Publishes the supported redaction helpers for external ESM consumers with public package metadata and packed-install coverage.

## 0.1.0

### Minor Changes

- 360d06d: Add the runner log transform stage between capture and the spool: a streaming secret masker and GitHub-style group-marker detection. Captured output is masked before any byte reaches the plaintext spool, replacing the runner's own credentials (runner token and job lease token) plus every base64, base64url, URL-encoded, and hex form with `***` through a rolling lookbehind that never emits a secret split across capture-chunk or flush boundaries, and `::group::`/`::endgroup::` lines become `group_start`/`group_end` control records with the marker line swallowed. Output streams continuously (complete lines flush immediately, unterminated lines stream their masked safe prefix) so live tail, stream order, and frame timestamps are preserved. `@shipfox/redact` gains `secretWireForms` to derive a secret's wire forms, and `@shipfox/runner-protocol` exposes `runnerToken` so the orchestrator can assemble the mask set.

### Patch Changes

- f8f339a: Add the `@shipfox/redact` package with shared credential-redaction helpers: `redactUrlCredentials` (scheme-agnostic free-text scrubber), `stripUrlCredentials` (structured single-URL stripper), `redactSecrets` (literal-secret scrubber), and the `REDACTION_PLACEHOLDER` constant. Move `redactCheckoutSpec` from `@shipfox/api-integration-core-dto` into `@shipfox/api-integration-core` so it can reuse the shared `stripUrlCredentials` without breaking the dto-only-dependency rule; its public export path (`@shipfox/api-integration-core`) is unchanged. No behavior change.
