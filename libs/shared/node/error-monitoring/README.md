# Shipfox Error Monitoring

Sentry integration for Shipfox Node services. It reads Sentry settings from environment variables and exports a small error-reporting API.

## What it does

- **`import '@shipfox/node-error-monitoring/init'`** starts Sentry from environment config.
- **`reportError(error, context)`** reports an unexpected failure through an isolated Sentry scope. It does not write a log entry itself.
- **`markErrorReported(error)`** and **`isErrorReported(error)`** prevent duplicate reports when a failure crosses boundaries.
- **`captureException(error)`** remains available for backward compatibility.
- **`addEventProcessor(processor)`** adds a custom Sentry event processor.
- **`flushErrorMonitoring(timeout)`** waits for pending events without shutting down the client.
- **`closeErrorMonitoring()`** flushes pending events and shuts down the Sentry client.

Environment variables (via `@shipfox/config`):

- `SENTRY_DSN` is optional. Leave it unset to disable reporting.
- `SENTRY_ENVIRONMENT` is optional, such as `production` or `staging`.
- `SENTRY_IMAGE` is optional. Use `name:tag` format. The tag prefix becomes the Sentry release.

## Installation

```bash
pnpm add @shipfox/node-error-monitoring
# or
yarn add @shipfox/node-error-monitoring
# or
npm install @shipfox/node-error-monitoring
```

## Usage

```ts
import "@shipfox/node-error-monitoring/init";

import {
  reportError,
} from "@shipfox/node-error-monitoring";
import {logger} from "@shipfox/node-opentelemetry";

try {
  await riskyOperation();
} catch (err) {
  logger().error({err}, "Failed to refresh cache");
  reportError(err, {boundary: "api.runtime", operation: "refresh-cache"});
}
```

Call `flushErrorMonitoring(timeout)` before a bounded runtime such as an AWS
Lambda invocation returns. Use `closeErrorMonitoring(timeout)` only when the
process is shutting down.

## Reporting policy

The earliest boundary that owns an unexpected failure reports it. A catch that
continues must report the failure, return or persist a recognized error, or
document why the failure is intentionally non-actionable.

`reportError` is intentionally Sentry-only. Every call site must also write a
structured error log before reporting so a self-hosted deployment without Sentry
still has the error, its cause chain, and safe diagnostic context. Keep the log
context equivalent to the report context and never add untrusted input merely
for local debugging.

Report unknown HTTP failures, API startup/runtime/shutdown failures, Temporal
activity and workflow-code defects, lifecycle failures, dispatcher and outbox
infrastructure failures, inter-module defects, and best-effort cleanup failures.

Do not report client, validation, authentication, signature, known-domain, typed
provider, rate-limit, expected-timeout, cancellation, idempotency, or already
reported failures. Do not report metrics-recording failures.

Use tags only for bounded classifications such as a boundary, operation, module,
event type, task queue, or outcome. Use extras for safe diagnostic identifiers
such as a request, event, workflow, stream, or installation ID. Never include
request bodies, headers, cookies, tokens, event payloads, activity arguments, or
inter-module input or output in either tags or extras.

Configure via environment variables before starting your app:

```bash
export SENTRY_DSN="https://key@sentry.io/123"
export SENTRY_ENVIRONMENT="production"
export SENTRY_IMAGE="billing-api:v1.2.3-abc"
```

## Development

```sh
turbo check --filter=@shipfox/node-error-monitoring
turbo type --filter=@shipfox/node-error-monitoring
```

## License

MIT
