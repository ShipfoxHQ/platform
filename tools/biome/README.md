# @shipfox/biome

Opinionated wrapper around Biome for formatting and linting across Shipfox repos. Ships platform-specific binaries and a unified CLI. It should be used with other packages from [Shipfox](https://www.shipfox.io/).

## What it does

- **`shipfox-biome-lint`**: Lint the current package using the workspace-level `biome.json`.
- **`shipfox-biome-format`**: Format files using the workspace-level `biome.json`.
- Cross-platform support via bundled Biome binaries (Darwin ARM64/x64, Linux ARM64/x64).

## Installation

```bash
pnpm add -D @shipfox/biome
```

## Usage

Add scripts to your `package.json`:

```json
{
  "scripts": {
    "lint": "shipfox-biome-lint",
    "lint:fix": "shipfox-biome-lint --fix",
    "format": "shipfox-biome-format",
    "format:fix": "shipfox-biome-format --write"
  }
}
```

Then run:

```bash
# Lint
shipfox-biome-lint
shipfox-biome-lint --fix

# Format
shipfox-biome-format
shipfox-biome-format --write

# Format specific targets
shipfox-biome-format --write src/ test/
```
