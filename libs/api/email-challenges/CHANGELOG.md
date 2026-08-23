# @shipfox/api-email-challenges

## 1.1.9

### Patch Changes

- Updated dependencies [6366319]
  - @shipfox/node-email@0.3.5

## 1.1.8

### Patch Changes

- @shipfox/node-opentelemetry@0.6.4
- @shipfox/node-mailer@0.2.5
- @shipfox/node-module@1.0.6

## 1.1.7

### Patch Changes

- Updated dependencies [f78740d]
- Updated dependencies [f13e8bb]
- Updated dependencies [34a5639]
  - @shipfox/api-common-dto@12.0.0
  - @shipfox/node-module@1.0.5
  - @shipfox/node-postgres@0.5.0
  - @shipfox/node-drizzle@0.3.5

## 1.1.6

### Patch Changes

- @shipfox/node-module@1.0.4
- @shipfox/api-common-dto@9.2.0
- @shipfox/config@1.2.4
- @shipfox/node-auth-root-key@0.2.3
- @shipfox/node-drizzle@0.3.4
- @shipfox/node-email@0.3.4
- @shipfox/node-mailer@0.2.4
- @shipfox/node-opentelemetry@0.6.3
- @shipfox/node-postgres@0.4.4

## 1.1.5

### Patch Changes

- Updated dependencies [4425c6d]
  - @shipfox/node-opentelemetry@0.6.3
  - @shipfox/node-mailer@0.2.4
  - @shipfox/node-module@1.0.3

## 1.1.4

### Patch Changes

- Updated dependencies [36d8338]
  - @shipfox/api-common-dto@9.2.0

## 1.1.3

### Patch Changes

- Updated dependencies [56e2c58]
  - @shipfox/node-email@0.3.4

## 1.1.2

### Patch Changes

- @shipfox/node-module@1.0.2

## 1.1.1

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.
- Updated dependencies [4b85404]
  - @shipfox/api-common-dto@9.0.2
  - @shipfox/config@1.2.4
  - @shipfox/node-auth-root-key@0.2.3
  - @shipfox/node-drizzle@0.3.4
  - @shipfox/node-email@0.3.3
  - @shipfox/node-mailer@0.2.3
  - @shipfox/node-module@1.0.1
  - @shipfox/node-opentelemetry@0.6.2
  - @shipfox/node-postgres@0.4.4

## 1.1.0

### Minor Changes

- 44c15c8: Adds an owner-owned test surface for initializing and resetting Email Challenges storage.

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.
- Updated dependencies [475ce59]
- Updated dependencies [154e03f]
  - @shipfox/api-common-dto@9.0.1
  - @shipfox/config@1.2.3
  - @shipfox/node-auth-root-key@0.2.2
  - @shipfox/node-drizzle@0.3.3
  - @shipfox/node-email@0.3.2
  - @shipfox/node-mailer@0.2.2
  - @shipfox/node-module@1.0.0
  - @shipfox/node-opentelemetry@0.6.1
  - @shipfox/node-postgres@0.4.3

## 1.0.0

### Major Changes

- 9083d20: Use the namespace-compliant `email_challenges` migration-history table for email challenge migrations.

### Patch Changes

- c279061: Improves release verification with owner-defined packed contracts, discovery-driven artifact checks, and an early publication preflight.
  - @shipfox/api-common-dto@6.0.0
  - @shipfox/config@1.2.2
  - @shipfox/node-auth-root-key@0.2.1
  - @shipfox/node-drizzle@0.3.2
  - @shipfox/node-email@0.3.1
  - @shipfox/node-mailer@0.2.1
  - @shipfox/node-module@0.5.0
  - @shipfox/node-opentelemetry@0.6.0
  - @shipfox/node-postgres@0.4.2

## 0.3.0

### Minor Changes

- 8bb32b2: Adds retry-safe continuation-bound email challenge creation and timing recovery.

### Patch Changes

- Updated dependencies [ac42c96]
- Updated dependencies [6ce08c0]
  - @shipfox/node-module@0.5.0
  - @shipfox/node-opentelemetry@0.6.0
  - @shipfox/node-mailer@0.2.1

## 0.2.3

### Patch Changes

- Updated dependencies [81c8f33]
  - @shipfox/node-auth-root-key@0.2.1

## 0.2.2

### Patch Changes

- ffc7fc9: Republishes the affected release set after recovering package publication.
- Updated dependencies [ffc7fc9]
  - @shipfox/node-email@0.3.1

## 0.2.1

### Patch Changes

- 4d7c87e: Adds a branded verification-code email with warmer account setup copy.
- Updated dependencies [4d7c87e]
  - @shipfox/node-email@0.3.0

## 0.2.0

### Minor Changes

- 905b6a3: Adds provider-neutral server-side email challenges with bounded code delivery and proof consumption.
- 6a52909: Replaces separate API auth secrets with domain-separated keys derived from one required AUTH_ROOT_KEY.

### Patch Changes

- Updated dependencies [7366f04]
- Updated dependencies [6a52909]
- Updated dependencies [54ce48b]
- Updated dependencies [c0162b0]
- Updated dependencies [7ac43a4]
- Updated dependencies [a01e917]
- Updated dependencies [3810996]
- Updated dependencies [4a91956]
- Updated dependencies [81f9544]
  - @shipfox/node-mailer@0.2.0
  - @shipfox/node-auth-root-key@0.2.0
  - @shipfox/node-module@0.4.0
  - @shipfox/node-drizzle@0.3.2
  - @shipfox/api-common-dto@6.0.0
