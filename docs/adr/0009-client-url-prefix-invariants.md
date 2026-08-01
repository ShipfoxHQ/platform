# ADR 0009: Client URL prefix invariants

- **Status:** Accepted
- **Date:** 2026-08-01
- **Decision owners:** E1 platform composition seams
- **Linear issue:** [ENG-1449](https://linear.app/shipfox/issue/ENG-1449/client-shell-move-client-urls-to)
- **Amends:** [ADR 0001: Public client composition contract](0001-client-composition-contract.md)

## Context

The client URL migration replaces UUID-bearing workspace and project paths with readable slugs:

- `/workspaces/$wid` becomes `/w/$workspaceSlug`;
- `/workspaces/$wid/projects/$pid` becomes `/w/$workspaceSlug/p/$projectSlug`.

The old path shape is not a compatibility surface. Keeping it in a feature manifest or navigation
target allows a route tree to describe URLs that the shell cannot safely scope to its workspace and
project guards.

## Decision

The prefixes `w` and `p` are registered entity prefixes. Their required dynamic parameters are
`workspaceSlug` and `projectSlug`, respectively. Composition validates every supplied layout and
route path before building the generated route tree.

The following rules are part of the public composition contract:

- workspace-scoped paths begin with `/w/$workspaceSlug`;
- project-scoped paths begin with `/w/$workspaceSlug/p/$projectSlug`;
- `/w` and `/p` must be followed immediately by their registered slug parameter;
- a registered slug parameter may not appear outside its prefix or more than once;
- a project prefix must appear at index 2, after the workspace prefix pair;
- a workspace prefix, when present, must be the first path segment;
- other dynamic parameters must follow a page segment, not an entity prefix;
- legacy `/workspaces/$wid/...` paths fail composition-time validation.

The prefix registry is the source of truth for these checks. Feature authors should use the shell
anchor paths and the current route examples in implementation documentation rather than reproducing
the old UUID path shape.

## Diagnostics

These route-path diagnostics are stable contract messages:

| Failure | Exact message template |
| --- | --- |
| Legacy workspace path | `Route "<path>" must use the slug-based workspace prefix "w" instead of the legacy "/workspaces" path.` |
| Prefix without slug parameter | `Route "<path>" uses prefix "<prefix>" without a dynamic parameter immediately after it.` |
| Slug outside prefix | `Route "<path>" places slug parameter "<param>" outside prefix "<prefix>".` |
| Repeated slug parameter | `Route "<path>" repeats slug parameter "<param>".` |
| Workspace prefix not first | `Route "<path>" must place workspace prefix "w" at the start of the path.` |
| Inverted entity prefixes | `Route "<path>" must place workspace prefix "w" before project prefix "p".` |
| UUID parameter after entity prefix | `Route "<path>" must place UUID parameter "<param>" after a page segment.` |

## Consequences

Route migrations are intentionally breaking at the URL level. Deep links, feature manifests,
navigation targets, Storybook memory routers, E2E fixtures, and external composition examples must
use the slug-based paths. The shell rejects malformed or legacy paths while composing, so invalid
feature contributions fail before a generated route tree is emitted.
