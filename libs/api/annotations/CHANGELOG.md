# @shipfox/annotations

## 12.0.0

### Patch Changes

- Updated dependencies [f78740d]
- Updated dependencies [f13e8bb]
  - @shipfox/inter-module@0.2.3
  - @shipfox/node-fastify@0.4.1
  - @shipfox/node-module@1.0.5
  - @shipfox/node-postgres@0.5.0
  - @shipfox/api-auth-context@12.0.0
  - @shipfox/annotations-dto@12.0.0
  - @shipfox/node-drizzle@0.3.5

## 11.0.0

### Major Changes

- 25158c8: Carry workspace lifecycle status in JWT membership claims and enforce suspended or inactive access at the stateless workspace gate while keeping access-token verification stateless.

  `getAuthenticatedSessionContext()` now reads refresh-session metadata from verified access-token claims without checking active refresh-session state; revoking a refresh session does not invalidate an already-issued access token.

### Patch Changes

- Updated dependencies [25158c8]
  - @shipfox/api-auth-context@11.0.0

## 10.2.0

### Patch Changes

- @shipfox/api-auth-context@10.2.0

## 10.1.0

### Patch Changes

- @shipfox/api-auth-context@10.1.0

## 10.0.0

### Patch Changes

- Updated dependencies [74f9e31]
  - @shipfox/node-fastify@0.4.0
  - @shipfox/api-auth-context@10.0.0
  - @shipfox/node-module@1.0.4
  - @shipfox/annotations-dto@9.0.2
  - @shipfox/config@1.2.4
  - @shipfox/inter-module@0.2.2
  - @shipfox/node-drizzle@0.3.4
  - @shipfox/node-postgres@0.4.4

## 9.3.0

### Patch Changes

- @shipfox/api-auth-context@9.3.0
- @shipfox/node-fastify@0.3.4
- @shipfox/node-module@1.0.3

## 9.2.0

### Patch Changes

- @shipfox/api-auth-context@9.2.0

## 9.0.3

### Patch Changes

- @shipfox/node-fastify@0.3.3
- @shipfox/node-module@1.0.2
- @shipfox/api-auth-context@9.0.3

## 9.0.2

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.
- Updated dependencies [4b85404]
  - @shipfox/annotations-dto@9.0.2
  - @shipfox/api-auth-context@9.0.2
  - @shipfox/config@1.2.4
  - @shipfox/inter-module@0.2.2
  - @shipfox/node-drizzle@0.3.4
  - @shipfox/node-fastify@0.3.2
  - @shipfox/node-module@1.0.1
  - @shipfox/node-postgres@0.4.4

## 9.0.1

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.
- Updated dependencies [475ce59]
- Updated dependencies [154e03f]
  - @shipfox/annotations-dto@9.0.1
  - @shipfox/api-auth-context@9.0.1
  - @shipfox/config@1.2.3
  - @shipfox/inter-module@0.2.1
  - @shipfox/node-drizzle@0.3.3
  - @shipfox/node-fastify@0.3.1
  - @shipfox/node-module@1.0.0
  - @shipfox/node-postgres@0.4.3

## 9.0.0

### Patch Changes

- @shipfox/api-auth-context@9.0.0
- @shipfox/annotations-dto@6.0.0
- @shipfox/config@1.2.2
- @shipfox/inter-module@0.2.0
- @shipfox/node-drizzle@0.3.2
- @shipfox/node-fastify@0.3.0
- @shipfox/node-module@0.5.0
- @shipfox/node-postgres@0.4.2

## 8.0.0

### Patch Changes

- b15f3a7: Removes Auth implementation dependencies from consumer test boundaries.

## 7.1.0

### Patch Changes

- Updated dependencies [ac42c96]
- Updated dependencies [6ce08c0]
  - @shipfox/node-fastify@0.3.0
  - @shipfox/node-module@0.5.0
  - @shipfox/api-auth-context@7.1.0

## 6.0.0

### Major Changes

- 9cb2442: Moves workflow capability-warning annotations behind the producer-owned inter-module API.

### Patch Changes

- f73da5d: Enforces bounded API context imports and routes inter-module consumers through producer contracts.
- Updated dependencies [9cb2442]
- Updated dependencies [54ce48b]
- Updated dependencies [c0162b0]
- Updated dependencies [7ac43a4]
- Updated dependencies [a01e917]
- Updated dependencies [8bdc149]
- Updated dependencies [3810996]
- Updated dependencies [b00ed29]
- Updated dependencies [8aa7cd3]
- Updated dependencies [81f9544]
  - @shipfox/annotations-dto@6.0.0
  - @shipfox/node-module@0.4.0
  - @shipfox/node-drizzle@0.3.2
  - @shipfox/api-auth-context@6.0.0
  - @shipfox/node-fastify@0.2.4
  - @shipfox/inter-module@0.2.0

## 5.0.0

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.
- Updated dependencies [bb037af]
  - @shipfox/annotations-dto@5.0.0
  - @shipfox/api-auth-context@5.0.0
  - @shipfox/config@1.2.2
  - @shipfox/node-drizzle@0.3.1
  - @shipfox/node-fastify@0.2.3
  - @shipfox/node-module@0.3.2
  - @shipfox/node-postgres@0.4.2

## 4.0.0

### Patch Changes

- Updated dependencies [bbba3b7]
  - @shipfox/node-drizzle@0.3.0
  - @shipfox/node-module@0.3.1

## 3.0.0

### Patch Changes

- Updated dependencies [3976f8c]
  - @shipfox/node-module@0.3.0
  - @shipfox/node-fastify@0.2.2
  - @shipfox/api-auth-context@3.0.0

## 2.0.0

### Minor Changes

- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.

### Patch Changes

- Updated dependencies [0cd6dd4]
- Updated dependencies [1b0d344]
  - @shipfox/node-module@0.2.0
  - @shipfox/annotations-dto@2.0.0
  - @shipfox/api-auth-context@2.0.0
  - @shipfox/config@1.2.1
  - @shipfox/node-drizzle@0.2.1
  - @shipfox/node-fastify@0.2.1
  - @shipfox/node-postgres@0.4.1

## 0.0.3

### Patch Changes

- @shipfox/node-module@0.1.2

## 0.0.2

### Patch Changes

- Updated dependencies [ec75cd5]
- Updated dependencies [6a1fb54]
  - @shipfox/node-drizzle@0.2.0
  - @shipfox/node-postgres@0.4.0
  - @shipfox/node-module@0.1.1

## 0.0.1

### Patch Changes

- 5707d6d: Adds the user-authenticated annotations read route with workspace-scoped run-attempt filtering, DTO conversion, and a continuation cursor.
- 0dd23a7: Warns on agent tool capability mismatches during dispatch without blocking label-matched runners.
- Updated dependencies [34ba284]
- Updated dependencies [5707d6d]
- Updated dependencies [b9c3f32]
- Updated dependencies [a81b68c]
- Updated dependencies [c0a883c]
- Updated dependencies [72ce351]
- Updated dependencies [e47f8da]
- Updated dependencies [ae7a63c]
- Updated dependencies [f92122b]
- Updated dependencies [857fd73]
- Updated dependencies [75520ff]
- Updated dependencies [d6d4862]
- Updated dependencies [c0a883c]
- Updated dependencies [6077301]
- Updated dependencies [3bea87f]
- Updated dependencies [82d22e4]
- Updated dependencies [6181819]
- Updated dependencies [9c149d1]
  - @shipfox/node-fastify@0.2.0
  - @shipfox/annotations-dto@0.0.1
  - @shipfox/node-drizzle@0.1.0
  - @shipfox/api-auth-context@0.1.0
  - @shipfox/node-postgres@0.3.2
  - @shipfox/node-module@0.1.0
  - @shipfox/config@1.2.0
