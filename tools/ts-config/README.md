# @shipfox/ts-config

Shared TypeScript configuration used across Shipfox packages. Provides strict, opinionated base configs for Node.js and React projects. It should be used with other packages from [Shipfox](https://www.shipfox.io/).

## What it does

- **Base config** (`@shipfox/ts-config`): Strict compiler options, declaration-only emit, composite builds, and declaration maps.
- **Node config** (`@shipfox/ts-config/node`): ES2022 target with NodeNext module resolution.
- **React config** (`@shipfox/ts-config/react`): ES2022 target, ESNext modules, JSX support, and DOM types.

## Installation

```bash
pnpm add -D @shipfox/ts-config
```

## Usage

Extend the appropriate config in your `tsconfig.json`:

```jsonc
// Node.js package
{
  "extends": "@shipfox/ts-config/node",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

```jsonc
// React package
{
  "extends": "@shipfox/ts-config/react",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```
