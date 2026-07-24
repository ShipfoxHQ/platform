# @shipfox/architecture-policy

`@shipfox/architecture-policy` evaluates repository architecture facts without
knowing a repository layout. Adapters collect workspace or installed package
facts and provide one repository-owned configuration for local classifications,
realm direction, composition roots, exports, extensions, and exact temporary
exceptions.

## Quick start

```ts
import {
  createDefaultRepositoryConfiguration,
  evaluateArchitecturePolicy,
  type ArchitectureFacts,
} from '@shipfox/architecture-policy';

const facts: ArchitectureFacts = {
  schemaVersion: 1,
  packages: [],
  importEdges: [],
  manifestEdges: [],
  publicExports: [],
  compositionFacts: [],
};

const diagnostics = evaluateArchitecturePolicy(
  facts,
  createDefaultRepositoryConfiguration(),
);
```

The evaluator is pure. It compares package identity, architecture class,
bounded context, and realm relations. Local and installed packages use the same
fact shape; a third-party package opts out with `policyParticipant: false`.
Unknown classes, missing metadata, incomplete class matrices, and invalid realm
relations fail closed.

Published Shipfox packages carry the same identity in `package.json` under
`shipfox.architecture`:

```json
{
  "shipfox": {
    "architecture": {
      "schema": 1,
      "realm": "source-available",
      "kind": "implementation",
      "context": "workspaces"
    }
  }
}
```

Use `packageFactFromInstalledManifest()` to create a normalized fact from an
installed manifest. The package-release tool generates this field from the
repository registry when it stages a package for publication.

The package also exports the serializable rule catalog and versioned JSON
schemas. Diagnostics always include a stable rule ID, the rejected facts, the
expected boundary, and a canonical architecture-validation guidance location.
Each exact exception suppresses at most one matching diagnostic; repeated
findings require repeated exception entries.

## Development

```sh
turbo build --filter=@shipfox/architecture-policy
turbo type --filter=@shipfox/architecture-policy
turbo test --filter=@shipfox/architecture-policy
turbo check --filter=@shipfox/architecture-policy
```

This package owns normalized policy semantics only. Repository discovery,
source parsing, Dependency Cruiser, executable composition, and runtime checks
remain with their specialized adapters and tools.

## License

MIT
