# Shipfox Log

Typed logging for Node services built on top of `pino`, with consistent defaults, environment-driven configuration, and convenient helpers. It should be used with other packages from [Shipfox](https://www.shipfox.io/).

## What it does

- **log**: Ready-to-use logger with levels `trace`, `debug`, `info`, `warn`, `error`, `fatal`.
- **createLogger(options)**: Create a new `pino` logger merging your options with Shipfox defaults.
- **settings**: The default `pino` configuration used to build `log` (handy for extending).
- **Types re-exported**: `Level`, `LogFn`, and `Logger` for strong typing.

Defaults include:

- ISO timestamps
- Uppercased level labels (e.g., `INFO`, `ERROR`)
- Standard serializers for `err`, `error`, `errors`, `req`, `res`
- Output formatting controlled via env: pretty printing or file output

Environment variables (via `@shipfox/config`):

- `LOG_LEVEL` (default: `info`; set to `silent` to suppress all logger output)
- `LOG_PRETTY` (default: `false`) — pretty print to stdout via `pino-pretty`
- `LOG_STDOUT` (default: `true`) — write logs to stdout
- `LOG_FILE` (default: `undefined`) — if set, logs to file using `pino/file` (creates directory if needed)

## Installation

```bash
pnpm add @shipfox/node-log
# or
yarn add @shipfox/node-log
# or
npm install @shipfox/node-log
```

## Usage

```ts
import { log, createLogger, settings, type Level } from "@shipfox/node-log";

// 1) Use the shared logger
log.info({ service: "billing" }, "Service started");
log.error({ err: new Error("boom") }, "Failed to process event");

// 2) Create a custom logger inheriting defaults
const moduleLogger = createLogger({
  level: (process.env.LOG_LEVEL as Level) ?? settings.level,
  base: { module: "payments" },
});

moduleLogger.debug({ eventId: "evt_123" }, "Processing payment event");

// 3) Environment-driven outputs
// - LOG_PRETTY=true prints colorized logs to stdout
// - LOG_FILE=/var/log/app.log writes JSON logs to a file
```

You can combine `LOG_PRETTY` and `LOG_LEVEL` during development for readability.
