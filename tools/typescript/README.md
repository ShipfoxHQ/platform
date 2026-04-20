# @shipfox/typescript

Thin wrappers around the TypeScript compiler for consistent type-checking and declaration emit across Shipfox packages. It should be used with other packages from [Shipfox](https://www.shipfox.io/).

## What it does

- **`shipfox-tsc-check`**: Type-check only (no emit). Uses `tsconfig.test.json` if present, otherwise `tsconfig.json`.
- **`shipfox-tsc-emit`**: Emit `.d.ts` declaration files to `dist/` and automatically clean up orphaned declarations without matching source files.

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
    "type": "shipfox-tsc-emit",
    "type:check": "shipfox-tsc-check"
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
