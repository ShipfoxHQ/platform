# Repository documentation policy

## What it does

This private verifier protects the repository engineering-documentation graph.
It checks relative Markdown targets and headings, then confirms that shared
documents are reachable from an approved entrypoint or index.

Product pages under `apps/docs/content/` remain owned by the docs app's link
checker. Changelogs and Changeset files are generated release metadata. Local
`README.md` files are approved roots because package and subsystem documentation
is intentionally discoverable beside the code that owns it. Provider-managed
agent skills remain outside this graph because they own agent-only workflow
behavior and can contain provider-specific references.

## Installation and setup

The package is part of the workspace. Install the pinned workspace dependencies
from the repository root:

```sh
mise exec -- pnpm install
```

## Usage

Run the verifier through its Turbo task:

```sh
mise exec -- turbo verify --filter=@shipfox/repository-documentation-policy
```

The repository-wide `mise exec -- pnpm verify` command includes this package's
`verify` task. A failure names the source file and line for a broken link or
anchor. An orphan failure names the file and points to `docs/README.md` or the
owning local index as the remediation point.

## Development

Read [ADR 0005](../../docs/adr/0005-repository-documentation-architecture.md)
and the [engineering documentation map](../../docs/README.md) before changing
the scope or reachability rules. Keep product-documentation validation in
`apps/docs/scripts/check-links.mjs`.

Run the focused package checks with:

```sh
mise exec -- turbo check type test verify --filter=@shipfox/repository-documentation-policy
```

## License

MIT
