# @shipfox/vitest

Lightweight wrapper around Vitest with sensible defaults for Shipfox projects. It should be used with other packages from [Shipfox](https://www.shipfox.io/).

## What it does

- **`shipfox-vitest-run`**: Run tests once with Shipfox defaults.
- **`shipfox-vitest-watch`**: Run tests in watch mode.
- **`defineConfig(config)`**: Merge your Vitest config with Shipfox base settings (auto-excludes `node_modules/`, `dist/`, `build/`, `out/`).
- **`defineProject(config)`**: Configure a project in a Vitest workspace.
- **Re-exports** all of `vitest` via `@shipfox/vitest/vi` for convenient imports.

## Installation

```bash
pnpm add -D @shipfox/vitest
```

## Usage

Create a `vitest.config.ts` in your package:

```ts
import { defineConfig } from "@shipfox/vitest";

export default defineConfig({
  // your overrides here
});
```

Run tests via the provided CLI commands:

```bash
# Run once
shipfox-vitest-run

# Watch mode
shipfox-vitest-watch
```

The wrappers default `LOG_LEVEL` to `silent` so package tests do not emit
application logs. Set `LOG_LEVEL=info` (or another pino level) when debugging a
test run.

Import test utilities from the re-export:

```ts
import { describe, it, expect, vi } from "@shipfox/vitest/vi";
```
