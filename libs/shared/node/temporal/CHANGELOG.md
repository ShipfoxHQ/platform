# @shipfox/node-temporal

## 0.4.2

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.
- Updated dependencies [4b85404]
  - @shipfox/config@1.2.4
  - @shipfox/node-error-monitoring@0.2.2
  - @shipfox/node-opentelemetry@0.6.2

## 0.4.1

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.
- Updated dependencies [475ce59]
  - @shipfox/config@1.2.3
  - @shipfox/node-error-monitoring@0.2.1
  - @shipfox/node-opentelemetry@0.6.1

## 0.4.0

### Minor Changes

- 6ce08c0: Adds provider-neutral OpenTelemetry traces and Prometheus metrics across the API, Fastify, module workers, and Temporal workers.

### Patch Changes

- ac42c96: Adds boundary-owned reporting for unexpected API runtime failures while preserving expected client and provider outcomes.
- Updated dependencies [ac42c96]
- Updated dependencies [6ce08c0]
  - @shipfox/node-error-monitoring@0.2.0
  - @shipfox/node-opentelemetry@0.6.0

## 0.3.2

### Patch Changes

- f4bc2eb: Provides the Temporal workflow peer at the package boundary to keep runtime singleton dependencies deduplicated.

## 0.3.1

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.
- Updated dependencies [bb037af]
  - @shipfox/config@1.2.2
  - @shipfox/node-opentelemetry@0.5.2

## 0.3.0

### Minor Changes

- c5ee18f: Makes Temporal workflow bundling and Docker runtime import maps resolve compiled production files.
- 08fc93b: Adds prebuilt production Temporal workflow bundles to API packages and removes runtime workflow compilation.

### Patch Changes

- Updated dependencies [7a71e7d]
  - @shipfox/node-opentelemetry@0.5.1

## 0.2.0

### Minor Changes

- a68458a: Adds caller-owned Temporal worker connections for shared worker lifecycle management.
- 6eba800: Adds Temporal Cloud API key authentication with TLS for workflow clients and workers.

### Patch Changes

- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.
- Updated dependencies [1b0d344]
- Updated dependencies [521e006]
  - @shipfox/config@1.2.1
  - @shipfox/node-opentelemetry@0.5.0

## 0.1.1

### Patch Changes

- e47f8da: Documents every environment-variable config param with a `desc` field so self-hosters can see what each variable does and how to set it.
- Updated dependencies [e47f8da]
- Updated dependencies [7b175f5]
  - @shipfox/node-opentelemetry@0.4.2
  - @shipfox/config@1.2.0
