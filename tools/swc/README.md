# @shipfox/swc

Opinionated build wrapper around SWC for fast TypeScript transpilation in Shipfox packages. It should be used with other packages from [Shipfox](https://www.shipfox.io/).

## What it does

- **`shipfox-swc`**: Transpiles `src/` to `dist/` using SWC with sensible defaults.
- Uses a project-local `.swcrc` if present, otherwise falls back to the built-in config.
- Automatically cleans up orphaned `.js` and `.js.map` files in `dist/` after each build.
- Supports path alias resolution via `tsc-alias` post-emit.

## Installation

```bash
pnpm add -D @shipfox/swc
```

## Usage

Add a build script to your `package.json`:

```json
{
  "scripts": {
    "build": "shipfox-swc"
  }
}
```

Then run:

```bash
# Build src/ → dist/
shipfox-swc

# Pass extra flags to SWC
shipfox-swc --source-maps
```
