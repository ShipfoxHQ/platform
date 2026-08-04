# @shipfox/node-jwt

## 0.4.0

### Minor Changes

- f13e8bb: Add Jira dynamic webhook registration and authenticated event ingestion through
  the shared stored-webhook workflow. Update the SPI webhook request exports and
  serialize Jira installation replacement across API replicas. Preserve Jira
  delivery identifiers and require lifecycle callbacks for registration. Remove
  the unused Jira webhook signing-secret configuration and allow HS256 verification
  at a supplied receipt time.

## 0.3.2

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.

## 0.3.1

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.

## 0.3.0

### Minor Changes

- 6a52909: Replaces separate API auth secrets with domain-separated keys derived from one required AUTH_ROOT_KEY.

## 0.2.1

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.

## 0.2.0

### Minor Changes

- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.

## 0.1.0

### Minor Changes

- fb64f13: Extracts the HS256 sign/verify mechanics into a shared `@shipfox/node-jwt` package and refactors auth user-token signing onto it, leaving the auth public API unchanged.

### Patch Changes

- b0a0e1a: Add `durationToSeconds`, which parses a jose timespan string (the same `expiresIn` values `signHs256` accepts, e.g. `90m`, `7d`) into whole seconds. Lets callers reason about a token's lifetime without minting one; units and rounding mirror jose's own parser.
