# Shipfox Error Monitoring

Sentry integration for Shipfox Node services. It reads Sentry settings from environment variables and exports a small error-reporting API.

## What it does

- **`import '@shipfox/node-error-monitoring/init'`** starts Sentry from environment config.
- **`captureException(error)`** reports an error to Sentry.
- **`addEventProcessor(processor)`** adds a custom Sentry event processor.
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
  captureException,
  addEventProcessor,
  closeErrorMonitoring,
} from "@shipfox/node-error-monitoring";

try {
  await riskyOperation();
} catch (err) {
  captureException(err);
}

addEventProcessor((event) => {
  event.tags = {...event.tags, service: "billing-api"};
  return event;
});

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

## Development

```sh
turbo check --filter=@shipfox/node-error-monitoring
turbo type --filter=@shipfox/node-error-monitoring
```

## License

MIT
