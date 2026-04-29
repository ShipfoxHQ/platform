# @shipfox/typescript

Thin wrappers around the TypeScript compiler for Shipfox packages. Use them for type checks and declaration output.

## What it does

- **`shipfox-tsc-check`** checks types without writing files.
- **`shipfox-tsc-check`** uses `tsconfig.test.json` when it exists. It falls back to `tsconfig.json`.
- **`shipfox-tsc-emit`** writes `.d.ts` files to `dist/`.
- **`shipfox-tsc-emit`** removes old declaration files that no longer match source files.

Designed to work with `@shipfox/ts-config`.

## Installation

```bash
pnpm add -D @shipfox/typescript
```

## Usage

Add scripts to your `package.json`:

```json
{
  "scripts": {
    "type": "shipfox-tsc-check",
    "type:emit": "shipfox-tsc-emit"
  }
}
```

Then run:

```bash
# Type-check without emitting
shipfox-tsc-check

# Emit declarations to dist/
shipfox-tsc-emit
```

## License

MIT
