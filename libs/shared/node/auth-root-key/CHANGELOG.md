# @shipfox/node-auth-root-key

## 0.3.0

### Minor Changes

- ebe5c00: Add `agentAccessTokenKey()` for signing agent access tokens.

## 0.2.3

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.
- Updated dependencies [4b85404]
  - @shipfox/config@1.2.4

## 0.2.2

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.
- Updated dependencies [475ce59]
  - @shipfox/config@1.2.3

## 0.2.1

### Patch Changes

- 81c8f33: Republishes the auth root key package with a dist-only runtime entry point for Node 24 consumers.

## 0.2.0

### Minor Changes

- 6a52909: Replaces separate API auth secrets with domain-separated keys derived from one required AUTH_ROOT_KEY.
