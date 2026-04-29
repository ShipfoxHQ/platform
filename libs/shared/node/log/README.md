# Shipfox Log

Typed logging for Shipfox Node services. It wraps `pino` with shared defaults, environment config, and small helper exports.

## What it does

- **`log`** is a ready-to-use logger.
- **`createLogger(options)`** creates a new `pino` logger with Shipfox defaults.
- **`settings`** exposes the default `pino` options.
- **Types** include `Level`, `LogFn`, and `Logger`.

Defaults include:

- ISO timestamps.
- Standard serializers for `err`, `error`, `errors`, `req`, and `res`.
- Output control through environment variables.

Environment variables (via `@shipfox/config`):

- `LOG_LEVEL` defaults to `info`. Set it to `silent` to suppress logs.
- `LOG_PRETTY` defaults to `false`. Set it to `true` for pretty stdout logs.
- `LOG_STDOUT` defaults to `true`. Set it to `false` to disable stdout logs.
- `LOG_FILE` is optional. If set, logs are written to that file.

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
import {createLogger, log, settings, type Level} from "@shipfox/node-log";

log.info({ service: "billing" }, "Service started");
log.error({ err: new Error("boom") }, "Failed to process event");

const moduleLogger = createLogger({
  level: (process.env.LOG_LEVEL as Level) ?? settings.level,
  base: { module: "payments" },
});

moduleLogger.debug({ eventId: "evt_123" }, "Processing payment event");
```

You can combine `LOG_PRETTY` and `LOG_LEVEL` during development for readability.

## Development

```sh
turbo check --filter=@shipfox/node-log
turbo type --filter=@shipfox/node-log
```

## License

MIT
