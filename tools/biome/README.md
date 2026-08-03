# @shipfox/biome

Biome commands, bundled binaries, and architecture plugins for Shipfox packages.

## What it does

- **`shipfox-biome-lint`**: Checks the current package with the root `biome.json`.
- **`shipfox-biome-format`**: Formats files with the root `biome.json`.
- **`shipfox-biome-check`**: Runs format, lint, and assist checks. Most package `check` scripts use it.
- **Bundled binaries**: Includes Biome for macOS and Linux on ARM64 and x64.
- **Client-architecture plugins**: Publishes five GritQL rules for external repositories. See the [plugin guide](plugins/client-architecture/README.md).
- **Database-boundaries plugin**: Publishes a GritQL rule that rejects direct Drizzle table-factory imports. See the [plugin guide](plugins/database-boundaries/README.md).

## Installation

Install the package as a development tool.

```bash
pnpm add -D @shipfox/biome
```

## Usage

Add these scripts to `package.json`:

```json
{
  "scripts": {
    "lint": "shipfox-biome-lint",
    "lint:fix": "shipfox-biome-lint --fix",
    "format": "shipfox-biome-format",
    "format:fix": "shipfox-biome-format --write",
    "check": "shipfox-biome-check",
    "check:fix": "shipfox-biome-check --write"
  }
}
```

Then run:

```bash
# Lint
shipfox-biome-lint
shipfox-biome-lint --fix

# Check
shipfox-biome-check
shipfox-biome-check --write

# Check a focused fixture tree with an explicit config
shipfox-biome-check --config-path path/to/biome.fixture.json path/to/fixtures/

# Format
shipfox-biome-format
shipfox-biome-format --write

# Format specific targets
shipfox-biome-format --write src/ test/
```

## Behavior notes

Package checks use the root `biome.json`. Pass `--config-path` only for a
focused config, such as a fixture tree. The normal form reads files. The write
form can change them. Check the result before you send a change for review.

## Client-architecture plugins

The package publishes these semver-governed asset paths:

- `plugins/client-architecture/no-api-dto-in-core.grit`
- `plugins/client-architecture/no-client-framework-in-core.grit`
- `plugins/client-architecture/no-query-cache-ownership.grit`
- `plugins/client-architecture/no-raw-api-request.grit`
- `plugins/client-architecture/no-response-dto-in-presentation.grit`

## Database-boundaries plugin

- `plugins/database-boundaries/no-direct-table-declaration.grit`

The database-boundaries rule rejects direct `pgTable` and `pgTableCreator`
imports from `drizzle-orm/pg-core`. Configure it over database source paths and
exclude the registered owner schema factory. See the [database-boundaries
plugin guide](plugins/database-boundaries/README.md).

Consumers reference the installed files from `biome.json`. Do not copy the
GritQL source into the consumer repository. The [plugin guide](plugins/client-architecture/README.md)
contains the external configuration example and the supported source globs.

## Development

Build and test the package and its fixture harness with:

```sh
turbo build --filter=@shipfox/biome
turbo type --filter=@shipfox/biome
turbo test --filter=@shipfox/biome
```

## License

MIT
