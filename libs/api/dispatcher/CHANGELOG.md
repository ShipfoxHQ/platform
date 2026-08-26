# @shipfox/api-dispatcher

## 17.0.0

### Patch Changes

- Updated dependencies [9f898d9]
  - @shipfox/node-postgres@0.5.1
  - @shipfox/node-outbox@0.2.6

## 15.0.0

### Patch Changes

- @shipfox/node-opentelemetry@0.6.5
- @shipfox/node-module@1.0.7
- @shipfox/node-temporal@0.4.6

## 12.2.0

### Patch Changes

- @shipfox/node-opentelemetry@0.6.4
- @shipfox/node-module@1.0.6
- @shipfox/node-temporal@0.4.5

## 12.0.0

### Patch Changes

- Updated dependencies [f78740d]
- Updated dependencies [f13e8bb]
  - @shipfox/node-module@1.0.5
  - @shipfox/node-postgres@0.5.0
  - @shipfox/node-outbox@0.2.6

## 10.0.0

### Patch Changes

- @shipfox/node-module@1.0.4
- @shipfox/config@1.2.4
- @shipfox/node-error-monitoring@0.3.0
- @shipfox/node-opentelemetry@0.6.3
- @shipfox/node-outbox@0.2.6
- @shipfox/node-postgres@0.4.4
- @shipfox/node-temporal@0.4.4

## 9.3.0

### Patch Changes

- Updated dependencies [4425c6d]
  - @shipfox/node-opentelemetry@0.6.3
  - @shipfox/node-module@1.0.3
  - @shipfox/node-temporal@0.4.4

## 9.0.3

### Patch Changes

- Updated dependencies [a831b32]
  - @shipfox/node-error-monitoring@0.3.0
  - @shipfox/node-module@1.0.2
  - @shipfox/node-temporal@0.4.3

## 9.0.2

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.
- Updated dependencies [4b85404]
  - @shipfox/config@1.2.4
  - @shipfox/node-error-monitoring@0.2.2
  - @shipfox/node-module@1.0.1
  - @shipfox/node-opentelemetry@0.6.2
  - @shipfox/node-outbox@0.2.6
  - @shipfox/node-postgres@0.4.4
  - @shipfox/node-temporal@0.4.2

## 9.0.1

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.
- Updated dependencies [475ce59]
- Updated dependencies [154e03f]
  - @shipfox/config@1.2.3
  - @shipfox/node-error-monitoring@0.2.1
  - @shipfox/node-module@1.0.0
  - @shipfox/node-opentelemetry@0.6.1
  - @shipfox/node-outbox@0.2.5
  - @shipfox/node-postgres@0.4.3
  - @shipfox/node-temporal@0.4.1

## 7.1.0

### Patch Changes

- ac42c96: Adds boundary-owned reporting for unexpected API runtime failures while preserving expected client and provider outcomes.
- Updated dependencies [ac42c96]
- Updated dependencies [6ce08c0]
  - @shipfox/node-error-monitoring@0.2.0
  - @shipfox/node-module@0.5.0
  - @shipfox/node-temporal@0.4.0
  - @shipfox/node-opentelemetry@0.6.0

## 6.0.0

### Minor Changes

- a01e917: Passes a per-initialization outbox registry through module startup, workers, and dispatch services instead of process-global state.
- 8ce515b: Adds a supervised in-process outbox dispatcher with configurable polling.

### Patch Changes

- 7b449a1: Removes the Temporal outbox dispatch poll loop.
- 54ce48b: Makes an empty outbox publisher registry fail dispatcher boot and logs registered publishers safely.
- 822b8c5: Document in-process outbox dispatching and its self-hosted configuration.
- 3810996: Adds dispatcher backlog metrics from registered pending outbox rows.
- Updated dependencies [54ce48b]
- Updated dependencies [f4bc2eb]
- Updated dependencies [c0162b0]
- Updated dependencies [7ac43a4]
- Updated dependencies [a01e917]
- Updated dependencies [3810996]
- Updated dependencies [81f9544]
  - @shipfox/node-module@0.4.0
  - @shipfox/node-temporal@0.3.2
  - @shipfox/node-outbox@0.2.4

## 5.0.0

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.
- Updated dependencies [bb037af]
  - @shipfox/node-error-monitoring@0.1.3
  - @shipfox/node-module@0.3.2
  - @shipfox/node-opentelemetry@0.5.2
  - @shipfox/node-outbox@0.2.3
  - @shipfox/node-postgres@0.4.2
  - @shipfox/node-temporal@0.3.1

## 4.0.0

### Patch Changes

- @shipfox/node-module@0.3.1
- @shipfox/node-outbox@0.2.2

## 3.0.0

### Patch Changes

- 7a71e7d: Aligns published dependency ranges with the workspace catalog policy.
- 08fc93b: Adds prebuilt production Temporal workflow bundles to API packages and removes runtime workflow compilation.
- Updated dependencies [3976f8c]
- Updated dependencies [c5ee18f]
- Updated dependencies [7a71e7d]
- Updated dependencies [08fc93b]
  - @shipfox/node-module@0.3.0
  - @shipfox/node-temporal@0.3.0
  - @shipfox/node-opentelemetry@0.5.1

## 2.0.0

### Minor Changes

- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.

### Patch Changes

- Updated dependencies [0cd6dd4]
- Updated dependencies [a68458a]
- Updated dependencies [6eba800]
- Updated dependencies [1b0d344]
- Updated dependencies [521e006]
  - @shipfox/node-module@0.2.0
  - @shipfox/node-temporal@0.2.0
  - @shipfox/node-error-monitoring@0.1.2
  - @shipfox/node-opentelemetry@0.5.0
  - @shipfox/node-outbox@0.2.1
  - @shipfox/node-postgres@0.4.1

## 0.0.3

### Patch Changes

- Updated dependencies [705dd43]
  - @shipfox/node-outbox@0.2.0
  - @shipfox/node-module@0.1.2

## 0.0.2

### Patch Changes

- Updated dependencies [6a1fb54]
  - @shipfox/node-postgres@0.4.0
  - @shipfox/node-module@0.1.1
  - @shipfox/node-outbox@0.1.1

## 0.0.1

### Patch Changes

- ae7a63c: Adds daily dispatched outbox row retention with bounded cleanup batches and retention indexes on module outbox tables.
- 2933c33: Adds drain-boundary Zod validation for current outbox publisher event payloads.
- Updated dependencies [e47f8da]
- Updated dependencies [7b175f5]
- Updated dependencies [ae7a63c]
- Updated dependencies [5729548]
- Updated dependencies [75520ff]
- Updated dependencies [d6d4862]
- Updated dependencies [3bea87f]
- Updated dependencies [9c149d1]
  - @shipfox/node-error-monitoring@0.1.1
  - @shipfox/node-opentelemetry@0.4.2
  - @shipfox/node-postgres@0.3.2
  - @shipfox/node-temporal@0.1.1
  - @shipfox/node-module@0.1.0
  - @shipfox/node-outbox@0.1.0
