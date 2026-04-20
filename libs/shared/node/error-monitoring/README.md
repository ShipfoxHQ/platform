# Shipfox Error Monitoring

Sentry integration for Node services that configures itself from environment variables and exposes a minimal error-reporting API. It should be used with other packages from [Shipfox](https://www.shipfox.io/).

## What it does

- **`import '@shipfox/node-error-monitoring/init'`**: Side-effect import that initialises Sentry using env config (DSN, environment, image tag → release).
- **`captureException(error)`**: Report an error to Sentry.
- **`addEventProcessor(processor)`**: Attach a custom Sentry event processor.
- **`closeErrorMonitoring()`**: Flush pending events and shut down the Sentry client.

Environment variables (via `@shipfox/config`):

- `SENTRY_DSN` (optional) — Sentry project DSN; leave unset to disable reporting.
- `SENTRY_ENVIRONMENT` (optional) — e.g. `production`, `staging`.
- `SENTRY_IMAGE` (optional) — Docker image tag in `name:tag` format; the tag prefix is used as the Sentry release.

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
// 1) Initialise Sentry as early as possible (side-effect import)
import "@shipfox/node-error-monitoring/init";

import {
  captureException,
  addEventProcessor,
  closeErrorMonitoring,
} from "@shipfox/node-error-monitoring";

// 2) Report errors
try {
  await riskyOperation();
} catch (err) {
  captureException(err);
}

// 3) Optionally attach a custom event processor
addEventProcessor((event) => {
  event.tags = { ...event.tags, service: "billing-api" };
  return event;
});

// 4) Graceful shutdown
process.on("SIGTERM", async () => {
  await closeErrorMonitoring();
  process.exit(0);
});
```

Configure via environment variables before starting your app:

```bash
export SENTRY_DSN="https://key@sentry.io/123"
export SENTRY_ENVIRONMENT="production"
export SENTRY_IMAGE="billing-api:v1.2.3-abc"
```
