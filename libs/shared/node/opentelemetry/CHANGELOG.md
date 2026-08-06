# @shipfox/node-opentelemetry

## 0.6.4

### Patch Changes

- Updated dependencies [e23f70c]
  - @shipfox/node-log@0.3.8

## 0.6.3

### Patch Changes

- 4425c6d: Adds independent stdout and file log thresholds and enables standard OpenTelemetry Pino log export in the API instrumentation preload.
- Updated dependencies [4425c6d]
  - @shipfox/node-log@0.3.7

## 0.6.2

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.
- Updated dependencies [4b85404]
  - @shipfox/config@1.2.4
  - @shipfox/node-log@0.3.6
  - @shipfox/regex@0.2.4

## 0.6.1

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.
- Updated dependencies [8436596]
- Updated dependencies [475ce59]
  - @shipfox/regex@0.2.3
  - @shipfox/config@1.2.3
  - @shipfox/node-log@0.3.5

## 0.6.0

### Minor Changes

- 6ce08c0: Adds provider-neutral OpenTelemetry traces and Prometheus metrics across the API, Fastify, module workers, and Temporal workers.

## 0.5.2

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.
- Updated dependencies [bb037af]
  - @shipfox/config@1.2.2
  - @shipfox/node-log@0.3.4
  - @shipfox/regex@0.2.2

## 0.5.1

### Patch Changes

- 7a71e7d: Aligns published dependency ranges with the workspace catalog policy.

## 0.5.0

### Minor Changes

- 521e006: Adds the @shipfox/api-server package with server lifecycle, default module composition, and an
  instrumentation preload entry, and exposes shutdownServiceMetrics from @shipfox/node-opentelemetry.

### Patch Changes

- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.
- Updated dependencies [1b0d344]
  - @shipfox/config@1.2.1
  - @shipfox/node-log@0.3.3
  - @shipfox/regex@0.2.1

## 0.4.2

### Patch Changes

- e47f8da: Documents every environment-variable config param with a `desc` field so self-hosters can see what each variable does and how to set it.
- 7b175f5: Adds shared identifier regex helpers and migrates public OpenTelemetry UUID route normalization to the canonical matcher.
- Updated dependencies [e47f8da]
- Updated dependencies [7b175f5]
- Updated dependencies [27770eb]
  - @shipfox/node-log@0.3.2
  - @shipfox/regex@0.2.0
  - @shipfox/config@1.2.0

## 0.4.1

### Patch Changes

- bce98f6: Export SpanKind and SpanStatusCode as values

## 0.4.0

### Minor Changes

- df4506a: Use BatchSpanProcessor for trace export and expose Attributes and SpanStatusCode types

## 0.3.0

### Minor Changes

- 4a118e9: Add `InstrumentationOptions` to `startInstanceInstrumentation` for selective instrumentation loading.

  Passing an `InstrumentationOptions` object enables only the specified instrumentations (via boolean flags) instead of loading all ~40 packages from `getNodeAutoInstrumentations()`. Each package is dynamically imported only when its flag is `true`, which significantly reduces startup time for apps using the ESM loader hook.

  Existing callers that omit `instrumentations` are unaffected — auto-instrumentation remains the default.

  `getFastifyInstrumentation()` now returns `FastifyOtelInstrumentation | undefined` instead of throwing when Fastify instrumentation is disabled.

## 0.2.3

### Patch Changes

- bc8636f: Export `Context` and `Span` types to allow consumers to annotate variables without a direct dependency on `@opentelemetry/api`
  - @shipfox/config@1.2.0
  - @shipfox/node-log@0.3.1

## 0.2.2

### Patch Changes

- 6aaecd4: Export `MetricAttributes` type to allow consumers to annotate metric instrument variables without a direct dependency on `@opentelemetry/api`

## 0.2.1

### Patch Changes

- ddd50b9: Normalise UUIDs and numeric IDs in `http.route` and `url.path` span attributes to `:id` to reduce metric cardinality

## 0.2.0

### Minor Changes

- 46ba174: Add context propagation, metadata baggage, and context-aware logger. Introduces `contextWithMetadata`/`getContextMetadata` for carrying business metadata through OTel context and W3C baggage, `injectContextToAttributes`/`extractContextFromAttributes` for serialising context into plain objects (queue payloads, headers), and a `logger()` helper that auto-enriches pino log lines with `traceId`, `spanId`, and business metadata from the active context.

## 0.1.0

### Minor Changes

- 35f3c64: Add CSS bundle

### Patch Changes

- @shipfox/config@1.2.0

## 0.0.2

### Patch Changes

- 674ecbb: Add README for all packages
- Updated dependencies [89dc459]
- Updated dependencies [674ecbb]
  - @shipfox/config@1.2.0

## 0.0.1

### Patch Changes

- 9bd640b: Modify repository structure
- Updated dependencies [9bd640b]
  - @shipfox/config@1.1.1
