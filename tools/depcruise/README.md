# @shipfox/depcruise

Workspace wrapper around Dependency Cruiser for Shipfox packages. It runs the project-local `depcruise` binary with the workspace dependency rules.

## What it does

- **`shipfox-depcruise`**: Runs Dependency Cruiser against the current package.
- Uses the workspace `.dependency-cruiser.cjs` config.
- Uses the current package `tsconfig.json`.
- Resolves binaries and workspace files through `@shipfox/tool-utils`.

## Installation

```bash
pnpm add -D @shipfox/depcruise
```

## Usage

Add a script to `package.json`:

```json
{
  "scripts": {
    "depcruise": "shipfox-depcruise"
  }
}
```

Then run:

```bash
shipfox-depcruise
```

The command checks imports for the package in the current working directory.

## License

MIT
