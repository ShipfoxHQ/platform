# Contributing

This project and everyone participating in it are governed by the Code of
Conduct which can be found in the file [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
By participating, you are expected to uphold this code.

## Prerequisites

- [mise](https://mise.jdx.dev/): manages tool versions (Node.js, pnpm, [Turbo](https://turbo.build/))
- [Docker](https://docs.docker.com/get-docker/): runs local service dependencies (PostgreSQL, etc.)

## Getting Started

### Install tooling

[mise](https://mise.jdx.dev/) reads `mise.toml` and installs the correct versions of Node.js, pnpm, and Turbo.

```sh
mise install
```

### Start local services

```sh
docker compose up -d
```

### Install dependencies and build

```sh
pnpm install
turbo build
```

Build a specific package and its dependencies:

```sh
turbo build --filter=@shipfox/api...
```

## Directory Structure

```
apps/           Application packages (deployable services)
libs/           Library packages (shared code, published or internal)
tools/          Internal build tooling (SWC, TypeScript, Biome, Vitest wrappers)
```

Each package follows the same layout:

```
package/
  src/          Source code
  test/         Test factories and helpers
  dist/         Build output (git-ignored)
```

## Common Scripts

Available in most packages via `pnpm <script>`:

| Script       | Description                                     |
| ------------ | ----------------------------------------------- |
| `build`      | Transpile source with [SWC](https://swc.rs/)    |
| `dev`        | Start in watch mode with hot-reload (apps only) |
| `type`       | Type-check and emit declarations                |
| `lint`       | Check for lint errors                           |
| `lint:fix`   | Auto-fix lint errors                            |
| `format`     | Check formatting                                |
| `format:fix` | Auto-fix formatting                             |
| `test`       | Run tests once                                  |
| `test:watch` | Run tests in watch mode                         |

## Turbo Tasks

[Turbo](https://turbo.build/) orchestrates tasks across the monorepo with caching and dependency ordering. Tasks are defined in `turbo.jsonc`:

| Task | Description |
| --- | --- |
| `turbo build` | Build all packages in dependency order |
| `turbo lint` / `turbo format` | Run checks across all packages |
| `turbo type` | Type-check all packages in dependency order |
| `turbo test` | Run tests across all packages |

`--filter` scopes a task to a specific package:

```sh
turbo build --filter=@shipfox/api...
turbo lint --filter=@shipfox/api-hello
```

## Import Aliases

Packages use Node.js [subpath imports](https://nodejs.org/api/packages.html#subpath-imports) (`imports` field in `package.json`) instead of TypeScript `paths`:

| Pattern | Maps to | Example |
| --- | --- | --- |
| `#*` | `./src/*` | `import {foo} from '#core/foo.js'` |
| `#test/*` | `./test/*` | `import {bar} from '#test/factories/bar.js'` |

Node, TypeScript, and [Vitest](https://vitest.dev/) resolve these natively; no build-time rewriting needed.

## Development Workflow

Libraries (`libs/`) expose **conditional exports**:

| Condition | Resolves to | Used by |
| --- | --- | --- |
| `development` | TypeScript source (`src/`) | `pnpm dev`, editor |
| `default` | Built output (`dist/`) | `turbo build`, CI |

`pnpm dev` picks up library source changes immediately, no lib rebuild needed.
