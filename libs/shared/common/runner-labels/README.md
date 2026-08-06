# Shipfox Runner Labels

Shared runner label canonicalization, validation, and catalog resolution helpers.

## What it does

- **`RunnerCatalog`** represents a map from a catalog name to a complete list of runner labels.
- **`parseRunnerCatalog(raw)`** validates an already-parsed catalog, canonicalizes names and labels, and rejects invalid or empty entries.
- **`resolveRunnerLabels(requested, catalog)`** expands known catalog names once and passes unknown values through as labels.
- **`canonicalizeLabels(value)`** accepts `undefined`, one string, or an array of strings. It trims, lowercases, drops empty values, deduplicates, and sorts the result.
- **`parseLabelList(value)`** parses comma-delimited configuration values before canonicalizing them.
- **`findInvalidLabels(labels)`** returns labels that do not match the supported pattern or exceed 128 characters.
- **`RUNNER_LABEL_PATTERN`, `MAX_RUNNER_LABEL_LENGTH`, and `MAX_RUNNER_LABELS`** are the shared label limits. A caller that owns a complete label set caps it at `MAX_RUNNER_LABELS`.

## Installation and setup

```sh
pnpm add @shipfox/runner-labels
```

The package does not read files. A consumer loads and parses its configuration before calling `parseRunnerCatalog`.

## Usage

```ts
import {parseRunnerCatalog, resolveRunnerLabels} from '@shipfox/runner-labels';

const catalog = parseRunnerCatalog({
  'shipfox-4cpu': ['os.ubuntu-latest', 'arch.amd64', 'cpu.4'],
});

const labels = resolveRunnerLabels(['shipfox-4cpu', 'internal-network'], catalog);
// ['arch.amd64', 'cpu.4', 'internal-network', 'os.ubuntu-latest']
```

## Behavior notes

Names and labels use `/^[a-z0-9][a-z0-9._-]*$/` and may be at most 128 characters. Names are canonicalized at load time, so catalog lookups are case-insensitive.

Catalog entries contain complete label sets. Resolution runs once, so a label produced by an entry is not resolved as another catalog name.

An unknown catalog name remains a label. With no catalog entries, all requested values pass through unchanged after canonicalization.

`runner: ubuntu,gpu` in YAML is one invalid label. `DEFINITION_DEFAULT_RUNNER_LABEL=ubuntu,gpu` is two configuration labels because `parseLabelList` handles comma-delimited values.

## Development

```sh
turbo check --filter=@shipfox/runner-labels
turbo type --filter=@shipfox/runner-labels
turbo test --filter=@shipfox/runner-labels
```

## License

MIT
