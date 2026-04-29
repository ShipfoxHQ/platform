# @shipfox/ts-config

Shared TypeScript config for Shipfox packages. It provides strict base, Node, and React configs.

## What it does

- **Base config** (`@shipfox/ts-config`) sets strict compiler options.
- **Node config** (`@shipfox/ts-config/node`) targets ES2022 with NodeNext modules.
- **React config** (`@shipfox/ts-config/react`) targets ES2022 with JSX and DOM types.

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

## License

MIT
