# @shipfox/node-opentelemetry

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
