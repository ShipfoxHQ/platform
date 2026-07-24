# Architecture validation

This guide owns tool selection, rule placement, and local verification for
architecture checks. Read it when adding, moving, or debugging an architecture
rule. Architecture documents and decision records own the rule itself.

[ADR 0007](../adr/0007-cross-repository-architecture-validation.md) owns the
decision to use layered checks and a versioned cross-repository policy
contract.

## Principles

**Use the strongest existing model for the invariant.** Match syntax with an
abstract syntax tree. Inspect dependencies with a resolved graph. Validate
feature ownership from composed feature values. Inspect manifests as JSON.
Test runtime behavior by running it.

**Give each rule one enforcement owner.** Do not keep a regular-expression
scan after Biome or Dependency Cruiser owns the same inputs. A higher-level
test can prove behavior without duplicating the lower-level parser.

**Keep architecture meaning separate from repository layout.** Shared rules
use package classes, bounded contexts, and ownership. Each repository maps its
local paths and private packages to those concepts.

**Fail at the narrowest useful location.** A local syntax problem should fail
the package `check` task with a source span. A repository graph problem can
fail a repository verifier. A behavior problem belongs in the focused test
that exercises it.

## Choose the enforcement layer

| Use case | Tool | Use it when | Do not use it for |
| --- | --- | --- | --- |
| A forbidden call, import form, declaration, or framework use in one file | [Biome and GritQL](../../tools/biome/README.md) | The decision needs syntax and file location only. | Cross-file ownership, resolved targets, or runtime flow. |
| A dependency between source modules or packages | [Dependency Cruiser](../../tools/depcruise/README.md) | The decision needs resolved static, dynamic, re-exported, or type-only imports. | Unused manifest edges, composed values, or behavior. |
| A feature, module, route, provider, or registry composition invariant | A focused Vitest contract test | The declarations can be imported or evaluated as structured values. | Reconstructing those values from source text. |
| Package classification, manifest edges, and public export shape | Repository architecture verifier | The decision needs workspace or installed-package metadata. | Local syntax that Biome can report more precisely. |
| Dependency ranges, catalogs, and manifest hygiene | `@shipfox/dependency-policy` | The rule concerns dependency declarations rather than architecture ownership. | Bounded-context or feature ownership. |
| Packed package entry points and production manifests | `@shipfox/package-release` | The rule concerns what an external consumer installs. | Internal source layout. |
| Effects, concurrency, retries, persistence, or user journeys | Unit, integration, or end-to-end tests | The result depends on executing code or observing state. | Static package boundaries. |

## Decide where a new rule belongs

Use these questions in order:

1. **Can one parsed file decide the result?** Add a Biome plugin.
2. **Does the result depend on a resolved import edge?** Add a Dependency
   Cruiser rule.
3. **Can the real declarations be loaded as data?** Add an executable contract
   test at their composition owner.
4. **Does the result compare packages, manifests, classifications, or
   exports?** Add a repository policy rule over normalized facts.
5. **Does the result depend on execution order or state?** Add the lowest test
   level that proves it.

Do not approximate a later answer with an earlier tool. A file-local regular
expression is not a substitute for a package graph or an executable feature
manifest.

## Biome rules

**Biome owns local source shape.** Current client rules cover DTO and framework
imports in `core/`, response DTO use in presentation code, raw API requests,
and query-cache ownership in leaf components.

Add a rule when:

- One file contains all required evidence.
- The rejected syntax has an unambiguous replacement.
- File includes and excludes can define the allowed boundary.
- The diagnostic should point to one syntax node.

Every architecture plugin must:

- Use a stable `<area>/<rule-name>` ID.
- Include one allowed and one rejected fixture.
- Cover aliases, namespace imports, and type-only imports when relevant.
- Exclude generated, test, and story files only when the architecture rule
  excludes them.
- Name the approved replacement boundary in the diagnostic.

Do not suppress an architecture plugin with `biome-ignore`. Change the source,
the rule boundary, or the architecture decision.

Run:

```sh
mise exec -- turbo check --filter=@shipfox/<package>...
mise exec -- turbo test --filter=@shipfox/biome
```

## Dependency Cruiser rules

**Dependency Cruiser owns resolved import topology.** Use it for allowed and
forbidden layer dependencies, deep imports, cross-context implementation
edges, cycles, and type-only dependency rules.

Generate rules from architecture classifications when the same matrix applies
to many packages. Do not repeat one package list in several rule definitions.

A dependency rule must state:

- The source class or package set.
- The target class or package set.
- Whether the edge can be direct, transitive, dynamic, or type-only.
- The allowed composition or test-layer exception.
- A stable rule ID and repair message.

Run the changed package and its dependents:

```sh
mise exec -- turbo depcruise --filter=@shipfox/<package>...
```

Run all affected dependency checks after changing the shared configuration:

```sh
mise exec -- turbo depcruise --affected
```

## Executable contract tests

**Use actual declarations when architecture is data.** Client feature
manifests, server module lists, route registries, provider registries, and
public composition options already have typed runtime values. Their owner
should validate those values directly.

Examples include:

- Composing all default client features and checking route ownership.
- Rejecting duplicate navigation, settings, route, or provider IDs.
- Building the default server module graph and checking required
  presentations.
- Checking that a route implementation package is declared by the
  composition package.

Keep the invariant in a pure validator when both production composition and
tests need it. Do not add a repository source scanner that tries to recover
the same object literals.

Run the package that owns the composition:

```sh
mise exec -- turbo test --filter=@shipfox/<composition-package>...
```

## Repository architecture policy

**A repository verifier owns facts that cross files and manifests.** Platform
uses `@shipfox/architecture-policy` through the local adapter in
`tools/api-architecture-policy`. The adapter discovers Platform packages,
manifests, classifications, export intent, and local configuration; the shared
evaluator owns the reusable policy decisions.

Use the repository layer for:

- Complete package classification.
- Local and installed package architecture metadata.
- Manifest dependency edges, including unused edges.
- Root and subpath export contracts.
- Exact temporary architecture exceptions.
- Cross-repository realm and context rules.

Do not parse imports with a repository regular expression when Dependency
Cruiser can supply resolved edges. Do not parse object literals when a
composition test can load them.

Current Platform commands are:

```sh
mise exec -- pnpm check:client-architecture
mise exec -- pnpm check:api-context-inventory
mise exec -- pnpm check:dependencies
mise exec -- pnpm check:published-artifacts
```

`check:client-architecture` is the Platform semantic client-policy gate. Do not
copy its implementation into Cloud. The API architecture command keeps
Platform discovery local and evaluates the normalized facts through the shared
package.

## Cross-repository rules

**A shared rule uses normalized package identity.** It must not depend on a
Platform or Cloud checkout path. The rule receives local and installed
package facts with the same shape.

**Rules compare relations instead of repository names.** Each repository
defines its realms and their allowed dependency direction. Cloud can declare
that its local realm may depend on the source-available realm. The shared
evaluator does not contain a Cloud-specific branch.

An allowed realm edge still passes the package-class and bounded-context
rules. A downstream implementation cannot import a foreign upstream
implementation only because the repositories have an allowed dependency
direction.

The shared package owns:

- Architecture classes and fact schemas.
- Rules over package, import, manifest, export, and composition facts.
- Dependency Cruiser rule generation.
- Stable diagnostics and generic fixtures.

Each repository owns:

- Local package classification.
- Composition roots and private package roles.
- Local policy extensions.
- Exact temporary exceptions.
- The pinned policy-package version.

Published `@shipfox/*` package manifests carry their architecture metadata.
Cloud evaluates the installed metadata for the version it resolved. It does
not copy `api-contexts.cjs` or inspect a different Platform checkout.

A Shipfox package that takes part in policy must have valid metadata.
Third-party packages remain under dependency policy unless an architecture
rule classifies them explicitly.

## Add or change a rule

1. **Name the invariant and owner.** Link the architecture document, policy,
   or ADR that defines the expected boundary.
2. **List the required facts.** Include syntax, resolved imports, manifests,
   exports, composition values, or runtime state.
3. **Choose one enforcement owner.** Use the tool-selection questions above.
4. **Assign a stable rule ID.** Keep the ID independent from implementation
   file names.
5. **Add accepted and rejected cases.** Include the variants that previously
   made the rule hard to express.
6. **Write an actionable diagnostic.** Name the replacement package, adapter,
   contract, coordinator, or test layer.
7. **Check the full input surface.** Include production, tests, setup,
   manifests, or packed output when the owning architecture rule covers them.
8. **Run focused validation.** Widen to affected packages and repository
   verification when the shared configuration changes.
9. **Update documentation only when the contract changes.** A parser refactor
   does not change an ADR. A new allowed dependency class or repeated
   exception does.

## Exceptions

**An exception is an exact architecture finding.** Record:

- Rule ID.
- Source package or file.
- Target package, export, or owner.
- Reason and responsible owner.
- Tracking issue.
- Removal condition or expiry.

Do not add a package-wide allowlist, a generic ignored directory, or an
unowned baseline. If several findings need the same exception, review the
architecture decision before widening policy.

## Current migration state

The repository currently uses:

- Root Biome plugins for migrated client source-shape rules.
- `.dependency-cruiser.cjs` for package-local import topology.
- `@shipfox/client-architecture-policy` for remaining client repository
  checks.
- `@shipfox/api-architecture-policy` for Platform discovery and shared-policy
  evaluation over server package metadata and DTO export intent.
- `api-contexts.cjs` and `.dependency-cruiser.cjs` for the local classification
  registry and resolved source-import topology.
- Focused composition tests for client and server runtime declarations.

ADR 0007's normalized evaluator is now adopted by Platform. The remaining
publication of the package and architecture metadata in released manifests are
tracked separately; keep the local adapter thin while those contracts land.
