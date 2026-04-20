# Shipfox config

This is a utility library handling configuration used by other packages for [Shipfox](https://www.shipfox.io/) projects.

## What it does

Typed, validated environment configuration built on top of `envalid`.

- **createConfig(schema)**: Validates `process.env` against your schema and returns a strongly-typed config object.
- **Re-exports common validators**: `str`, `num`, `bool`, `email`, `host`, `port`, `url` (from `envalid`).
- **Fail-fast**: Throws at startup if required variables are missing/invalid.

## Installation

```bash
pnpm add @shipfox/config
# or
yarn add @shipfox/config
# or
npm install @shipfox/config
```

## Usage

```ts
import { createConfig, str, num, bool } from "@shipfox/config";

const config = createConfig({
  NODE_ENV: str({ choices: ["development", "test", "production"] }),
  PORT: num({ default: 3000 }),
  DEBUG: bool({ default: false }),
});

// Typed access
config.PORT; // number
config.DEBUG; // boolean
```
