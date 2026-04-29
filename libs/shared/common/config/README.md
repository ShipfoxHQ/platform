# Shipfox Config

Typed config for Shipfox packages. It checks `process.env` at startup and returns a typed object.

## What it does

- **`createConfig(schema, update?)`** checks environment values with `envalid`.
- **Common validators** are re-exported: `str`, `num`, `bool`, `email`, `host`, `port`, and `url`.
- **Fail-fast startup** means bad values throw before the app runs.

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
import {bool, createConfig, num, str} from "@shipfox/config";

const config = createConfig({
  NODE_ENV: str({choices: ["development", "test", "production"]}),
  PORT: num({default: 3000}),
  DEBUG: bool({default: false}),
});

config.PORT; // number
config.DEBUG; // boolean
```

Pass `update` in tests to override `process.env`:

```ts
const testConfig = createConfig({PORT: num()}, {PORT: "4000"});
```

## Development

```sh
turbo check --filter=@shipfox/config
turbo type --filter=@shipfox/config
turbo test --filter=@shipfox/config
```

## License

MIT
