# @shipfox/node-rate-limit

## 0.4.0

### Minor Changes

- 9ebc5b4: Add an authenticated, rate-limited workspace slug availability endpoint.

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

- 1c1fb3e: Adds shared fixed-window rate limiting for provisioner token minting and ephemeral runner registration.
