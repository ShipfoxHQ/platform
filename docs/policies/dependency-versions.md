# Dependency version policy

This policy defines what one version means in the Shipfox pnpm workspace. It
applies before a dependency is added, updated, or exempted.

**One version means one reviewed version intent. The intent is scoped to one
direct external dependency and policy use.** The committed lockfile records the
exact installed graph. A broad peer range is a consumer contract. It does not
count as installed version drift.

## Workspace boundary

`pnpm-workspace.yaml` defines the policy boundary. The root manifest is in scope.
Every package selected by its `packages` patterns is also in scope.

The external client fixture at
`libs/client/shell/test/external/fixture/package.json` is outside the workspace on
purpose. It models a clean consumer. It owns its dependency versions. Other
manifests outside the workspace patterns also own their versions. This policy can
name an exception.

The baseline at commit `08fc93b9b` contains 133 workspace manifests. It has 165
external dependency names.

## Dependency classes

| Class | Policy |
| --- | --- |
| Direct `dependencies` | Use the approved catalog entry for the package and consumer scope. |
| Direct `devDependencies` | Use the approved catalog entry. Toolchain pins follow the exact-version rules below. |
| Direct `optionalDependencies` | Use the catalog of the package that owns the optional companion. Use its family rule too. |
| `peerDependencies` | Treat the range as a consumer support contract. Do not compare it with the installed catalog version. |
| Local workspace packages | Use `workspace:*`. A different local range needs a public-package support reason. |
| File, link, Git, or URL sources | Keep them outside normal catalogs. Each use needs a narrow review exception. State the reason and removal condition. |
| Manifests outside the workspace | Keep their versions independent. External-consumer fixtures must not inherit workspace catalogs. |
| Transitive lockfile entries | Audit the committed lockfile. Do not rewrite a manifest only to remove a duplicate. Do not add an override for that reason alone. |

The current workspace has no direct external file, link, Git, or URL dependency.

## Checking direct dependencies

Run the direct-dependency check after changing a workspace manifest:

```sh
pnpm check:dependencies
```

The check reads committed manifests and the workspace catalog. It does not read
registry metadata.

Use the fix command to restore eligible direct dependencies to `catalog:`:

```sh
pnpm fix:dependencies
```

The fix does not update dependencies or format manifests. A non-semver source
needs a named exception in the repository policy configuration.

## Contributor workflow

### Add a direct dependency

Choose the dependency class before changing a manifest. Use `dependencies` for
runtime code, `devDependencies` for repository tooling, and
`optionalDependencies` only for an optional runtime companion. Local Shipfox
packages use `workspace:`. Peer dependencies use the peer workflow below.

Use pnpm to add an external direct dependency and create its default catalog
entry in one change. Replace the placeholders with the affected package, npm
package, and the lowest tested compatible version:

```sh
pnpm --filter @shipfox/<package> add <dependency>@^<minimum-tested-version> --save-catalog
```

Use `--save-dev` or `--save-optional` when the dependency belongs in those
sections:

```sh
pnpm --filter @shipfox/<package> add <dependency>@^<minimum-tested-version> --save-catalog --save-dev
pnpm --filter @shipfox/<package> add <dependency>@^<minimum-tested-version> --save-catalog --save-optional
```

The command writes the selected catalog range in `pnpm-workspace.yaml` and
uses `catalog:` in the package manifest. Use the caret range by default. Choose
an exact or tilde range only when the catalog and range rules below allow it.

Run the checks before opening a pull request:

```sh
pnpm check:dependencies
pnpm check:lockfile
pnpm check:published-artifacts
pnpm install --frozen-lockfile
```

### Update a dependency or family

Update the catalog entry in `pnpm-workspace.yaml`, then regenerate the
committed lockfile:

```sh
pnpm install
pnpm check:dependencies
pnpm check:lockfile
pnpm check:published-artifacts
```

Update each member of an identical-version family to the same numeric version.
The coordinated Renovate families below name those members and their range
shape. Let Renovate make ordinary updates. Change a catalog by hand only for a
reviewed exception, an urgent fix, or a supported-range correction.

### Add or remove an exception

Start by updating this policy with the dependency class, reason, owner,
tracking issue, and removal condition. Add a narrowly named Syncpack group in
`.syncpackrc.json` before the catalog policy group. Limit it to the dependency
name and dependency type that need the exception. Do not exempt a whole scope
or all direct dependencies.

Remove the exception group and the policy entry when its removal condition is
met. Return the direct dependency to `catalog:` and run:

```sh
pnpm fix:dependencies
pnpm install
pnpm check:dependencies
pnpm check:lockfile
pnpm check:published-artifacts
```

### Handle peer dependencies

Peer dependencies are consumer compatibility contracts. Set the supported peer
range directly in `peerDependencies`. Do not point it at a direct catalog
range. Keep the matching local development dependency on `catalog:` so the
workspace tests one installed version.

Check every published package that changes a peer range:

```sh
pnpm check:dependencies
pnpm check:published-artifacts
```

### Investigate a failed check

Run the direct-policy check after a manifest edit. Use its fix command only
when the dependency already belongs to an approved catalog:

```sh
pnpm check:dependencies
pnpm fix:dependencies
pnpm check:dependencies
```

For a lockfile audit failure, print the complete deterministic report. It shows
the exact duplicate and curated-singleton versions from the committed lockfile:

```sh
pnpm check:lockfile -- --verbose
```

Do not add an override only to remove an ordinary duplicate. A new override is
a curated singleton. It must reference a catalog entry and resolve once.

Direct-policy and lockfile CI checks read committed files. Do not add
`pnpm dedupe --check`, a latest-version lookup, or another registry-dependent
check to those pull-request gates.

## Catalog and range rules

The default catalog holds the version intent. It covers eligible direct external
dependencies. Another catalog entry needs a named scope and a different range
shape. Examples include a peer support catalog and a temporary
legacy-major catalog.

Catalog names must describe the scope. Do not create `old`, `new`, or numbered
catalogs with no stated contract. A temporary catalog entry needs a tracking
issue and a removal condition.

### Caret ranges

Use a caret range by default.

- A caret range accepts compatible minor and patch releases. Use it by default.
- Use a tilde range only when the package must stay on one minor line. A reviewed
  prerelease line can also use a tilde.
- Keep the minimum version at the lowest tested version. Do not copy the current
  lockfile resolution into a published range.
- Do not use wildcards or open-ended ranges for direct non-peer dependencies.

The lockfile, not a narrow manifest range, makes application installs
reproducible.

### Exact versions

Exact pins need a clear reason. Use an exact version only in these cases.

- A generated or prebuilt artifact must run with the version that created it.
- A runtime family has one numeric version for all members. Its upstream release
  contract makes partial updates invalid.
- A package ships a platform-specific binary or companion from the same release.
- A formatter, compiler, or other development tool produces repository-owned
  output. That output must change only in an explicit update.

The policy entry and Renovate rule must state which condition applies. Exact pins
are not the default for published packages.

## Rules by consumer

### Applications and private packages

Applications and private packages use caret catalog ranges by default. The
committed lockfile pins deployments and local installs. An exact catalog entry
needs an artifact, protocol, or lockstep invariant. The list above defines those
cases.

### Development tooling

Pin generators, formatters, and compilers when their output is part of the
repository contract. Pin their platform companions too. General test helpers and
type-only utilities use caret ranges. An upstream limit can require a
narrower range.

### Published `libs/*` and `tools/*` packages

Published runtime dependencies use caret ranges by default. An exact runtime pin
needs proof. The Temporal prebuilt-bundle contract is one example.

Peer ranges state the versions that consumers can provide. Keep them broad
enough to match tested support. The workspace can install a newer version than
the peer minimum.

Packed manifests must contain ordinary npm semver specifications. They must not
contain `catalog:`. They must not contain an unresolved `workspace:` protocol.
An external npm consumer must be able to install them.

## Current direct mismatch dispositions

This table records every external dependency name with more than one direct
specification. The baseline commit is `08fc93b9b`. The audit checks
`dependencies`, `devDependencies`, `optionalDependencies`, and
`peerDependencies`. It reads all 133 workspace manifests.

| Dependency | Current specifications | Classification | Policy result |
| --- | --- | --- | --- |
| `@types/node` | `^24.1.0`, `25.9.3` | Unintended drift to align. | Align all declarations with the repository's Node 24 toolchain. Do not keep Node 25 types while `mise.toml` runs Node 24. |
| `tsx` | `^4.21.0`, `^4.22.4` | Unintended drift to align. | Use one caret range with `4.22.4` as the reviewed minimum. |
| `react` | direct `^19.1.1`, peer `^19.0.0` | Intentional peer compatibility. | Keep the peer minimum separate. Direct runtime entries follow the React family version. |
| `react-dom` | direct `^19.1.1`, peer `^19.0.0` | Intentional peer compatibility. | Keep the peer minimum separate. Direct runtime entries follow the React family version. |
| `zod` | `4.4.3`, `^4.1.11`, `^4.4.3` | Unintended drift to align. | Use the `^4.4.3` caret entry. The lockfile supplies the exact workspace install. |
| `@opentelemetry/api` | `1.9.1`, `^1.9.0` | Unintended drift to align. | Use the `^1.9.1` caret entry. No exact runtime contract exists here. |
| `fishery` | `^2.2.2`, `^2.4.0` | Unintended drift to align. | Use one caret range with `2.4.0` as the reviewed minimum. |
| `@temporalio/client` | `1.18.1`, `^1.16.1` | Temporary compatibility exception. | Move the full Temporal family in one migration. Use exact `1.18.1`. Remove the exception when packed-consumer and workflow-bundle checks pass. |
| `@temporalio/common` | `1.18.1`, `^1.16.1` | Temporary compatibility exception. | Move the full Temporal family in one migration. Use exact `1.18.1`. Remove the exception when packed-consumer and workflow-bundle checks pass. |
| `@temporalio/worker` | `1.18.1`, `^1.16.1` | Temporary compatibility exception. | Move the full Temporal family in one migration. Use exact `1.18.1`. Remove the exception when packed-consumer and workflow-bundle checks pass. |
| `ajv` | `8.20.0`, `^8.20.0` | Unintended drift to align. | Use the `^8.20.0` caret entry. |
| `fastify-plugin` | `^5.1.0`, `^6.0.0` | Deliberate multi-major migration. | Keep the v5 use narrow. The webhook package must pass its route and packed-package checks on v6. Use a separate pull request for the major migration. Remove the legacy entry there. |
| `@testing-library/react` | `^16.3.0`, `^16.3.2` | Unintended drift to align. | Use one caret range with `16.3.2` as the reviewed minimum. |
| `typescript` | default `^7.0.2`, dependency-cruiser compatibility `^6.0.3` | Temporary tool compatibility exception owned by Developer Experience. | Keep TypeScript 6 available only to `@shipfox/depcruise` while dependency-cruiser cannot use the TypeScript 7 public API ([dependency-cruiser#1069](https://github.com/sverweij/dependency-cruiser/issues/1069)). Remove the named catalog, package extension, Syncpack exception, and Renovate rule when dependency-cruiser supports the repository TypeScript version. |

The catalog migration must apply these dispositions without changing unrelated
dependency versions. A later mismatch needs a policy update. An approved
exception is the only other path into the catalog.

## Coordinated Renovate families

Every family in this table updates in one Renovate pull request. `Complete
release` means Renovate waits until every listed member has an update. `Identical
version` means the numeric version must match across members. Peer ranges do not
take part in numeric equality.

| Family | Direct members | Complete release | Identical version | Range rule |
| --- | --- | --- | --- | --- |
| Biome distribution | `@biomejs/biome`, `@biomejs/cli-darwin-arm64`, `@biomejs/cli-darwin-x64`, `@biomejs/cli-linux-arm64`, `@biomejs/cli-linux-x64` | Yes. | Yes. | Exact. |
| Temporal SDK | `@temporalio/activity`, `@temporalio/client`, `@temporalio/common`, `@temporalio/interceptors-opentelemetry`, `@temporalio/testing`, `@temporalio/worker`, `@temporalio/workflow` | Yes. | Yes. | Exact. |
| React runtime | `react`, `react-dom` | Yes. | Yes. | Caret. Peers stay separate. |
| Vitest | `vitest`, `@vitest/browser-playwright` | Yes. | Yes. | Caret. |
| Storybook | `storybook`, `@storybook/addon-docs`, `@storybook/addon-vitest`, `@storybook/react`, `@storybook/react-vite` | Yes. | Yes. | Caret. |
| Tailwind CSS | `tailwindcss`, `@tailwindcss/vite` | Yes. | Yes. | Caret. |
| React type definitions | `@types/react`, `@types/react-dom` | No. | No. | Group only. |
| TanStack Query | `@tanstack/query-core`, `@tanstack/react-query`, `@tanstack/react-query-devtools` | No. | No. | Group only. |
| TanStack Router | `@tanstack/react-router`, `@tanstack/router-core`, `@tanstack/router-plugin` | No. | No. | Group only. |
| Argos CI | `@argos-ci/cli`, `@argos-ci/playwright`, `@argos-ci/storybook` | No. | No. | Group only. |
| Vite | `vite`, `@vitejs/plugin-react` | No. | No. | Group only. |

A complete-release family uses `minimumGroupSize` equal to the number of listed
members. A grouped-only family has no minimum. One available member cannot block
the rest forever.

A security update can bypass a complete-release wait. This is allowed when a
delay is riskier than a partial update. The pull request records the support
review. It also states how the family invariant will return.

A shared vendor scope does not create a family. OpenTelemetry packages use
several upstream release trains. Do not force that whole scope to one numeric
version.

## Transitive duplicate reporting

Transitive duplicates are informational. They are usually controlled by
upstream dependency ranges, so an ordinary duplicate does not fail validation
and does not need an exception entry.

Run `pnpm check:lockfile -- --verbose` to print every package that resolves to
more than one version. The report reads the committed lockfile, removes
peer-context suffixes from snapshot keys, and sorts packages and versions. The
default command prints only the duplicate count so pull-request logs stay
concise.

### Curated singletons

A root override declares a curated singleton. The override must reference the
package's catalog entry, and the lockfile audit requires the package to resolve
to exactly one version. Do not add an override only because a duplicate exists.
The pull request must explain why one version is compatible with every consumer
and run focused checks for those consumers.

`@types/pg` is the first singleton. OpenTelemetry pins an older 8.x type package.
Shipfox database packages use the catalog release. The override affects only
types. Focused OpenTelemetry and PostgreSQL checks cover both uses.

## Deterministic pull-request checks

Pull-request dependency-policy checks read committed repository files only. The
same commit must produce the same result without registry metadata.

These checks must not do any of the following.

- ask a registry which version is latest or newly available.
- run `pnpm dedupe --check` as a pull-request gate.
- accept a change because a package appeared after the pull request started.
- mutate manifests or the lockfile during validation.

Renovate can use registry state to propose an update. The proposed catalog is a
fixed input to the pull request. The same applies to manifests, configuration,
and the committed lockfile. A frozen install can fetch pinned artifacts. It must
not resolve a new version.

## Changing the policy

A policy change must include the reason. It must name the affected package
scopes and include a migration plan. A temporary direct-version exception needs
an owner, a tracking issue, and a removal condition. Remove the exception with
the legacy direct specification.
