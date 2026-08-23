# ADR 0009: Client URLs and resource identity

- **Status:** Accepted
- **Date:** 2026-08-03
- **Decision owners:** Client composition maintainers and resource-boundary owners
- **Linear issue:** [ENG-1452](https://linear.app/shipfox/issue/ENG-1452/docs-record-the-url-and-identifier-decisions-in-adr-0009)
- **Related:** [ENG-1449](https://linear.app/shipfox/issue/ENG-1449/client-shell-move-client-urls-to) established the initial prefix decision.
- **Amends:** [ADR 0001: Public client composition contract](0001-client-composition-contract.md)

ADR 0001 remains canonical for the anchor path table, root-parented route
protection, and exact composition diagnostics, including the prefix-specific
messages. This amendment records the URL and resource-identity decisions those
anchors implement.

## Context

Workspaces and projects have mutable, URL-safe slugs. Their UUIDs remain the
stable identity used by the API and stored relationships. The client needs a
readable URL, while the API needs an identity that does not change when a slug
is renamed.

The client URL migration also introduces entity prefixes. Without a prefix, a
slug such as `settings` or `new` could collide with a page segment. The route
contract therefore needs a durable owner for the prefix registry and the rules
that keep it safe.

The run number is a second human-facing identifier. It helps a person refer to
a run, but it must not become a second address for a run. The API and client
need one record of which identifiers route, which identify resources, and which
exist only for display.

## Decision

### Identity and URL boundary

The UUID is the identity of every workspace, project, run, and job. A client
URL may carry a workspace slug or project slug as a navigation reference. An
HTTP route keeps using the corresponding UUID when it identifies a resource.
The API may accept a `slug` field when a workspace or project is created or
renamed, but it never treats that field as a replacement for an identity
parameter.

| Identifier | Client URL | API identity | Purpose |
| --- | --- | --- | --- |
| Workspace slug | Yes | `workspaceId` UUID | Navigation and display |
| Project slug | Yes | `projectId` UUID | Navigation and display |
| Run UUID | Yes, under `runs/` | `workflowRunId` UUID | Resource identity |
| Job UUID | Yes, under a run | `jobId` UUID | Resource identity |
| Run number | No | Not resolved | Display and workflow context |

The old UUID-bearing client paths are replaced by short slug paths. This is a
breaking URL change. Old paths return 404 and do not redirect. Slugs are
mutable, and a renamed slug is immediately available for another resource.

### Client anchors and URL scheme

The [anchor path table in ADR 0001](0001-client-composition-contract.md#paths-and-anchors)
is canonical. This ADR records the URL scheme encoded by those anchors: client
workspace and project navigation uses slug segments, while resource requests
continue to use UUIDs after resolution.

Examples below the anchors use the same prefixes:

```text
/w/acme/p/checkout-api/runs
/w/acme/p/checkout-api/runs/$workflowRunId
/w/acme/p/checkout-api/runs/$workflowRunId/jobs/$jobId
/w/acme/p/checkout-api/settings/general
```

The `projectSettings` anchor is a shell anchor rather than a route owned by the
projects feature. It gives project settings the same shell and contribution
point as workspace settings.

### Entity-prefix registry

Single-letter static path segments are reserved for entity-type prefixes. The
registry currently contains:

| Prefix | Entity | Required parameter |
| --- | --- | --- |
| `w` | Workspace | `$workspaceSlug` |
| `p` | Project | `$projectSlug` |

Two invariants enforce the registry:

1. A single-letter static segment must be followed immediately by its registered
   dynamic slug parameter.
2. A slug parameter must be preceded by its registered prefix. A UUID parameter
   must follow a page segment such as `runs`, not an entity prefix.

The workspace prefix must be first. The project prefix must follow the workspace
prefix pair. A registered slug parameter cannot appear twice or outside its
prefix. Composition checks these rules before it builds the generated route
tree. The exact messages for these checks remain in the Diagnostics section of
ADR 0001.

UUID references deliberately have no prefix. Runs keep
`runs/$workflowRunId`, and jobs keep their page segment below the run. An earlier
proposal added `r` for runs and planned more prefixes for nested entities. It
saved three characters on a URL that still contains a 36-character UUID, split
the `runs` list from its detail page, and added a prefix for every future UUID
resource. UUIDs do not need a slug namespace, so the extra prefix has no useful
work to do.

### No reserved-slug list

The URL scheme does not maintain a reserved-word list. A workspace slug is only
compared with workspace slugs after the `w` prefix. A project slug is only
compared with project slugs after the `p` prefix. Values such as `settings` and
`new` therefore cannot occupy a page-name position.

The unprefixed alternative, `/$workspaceSlug/$projectSlug`, would require a list
that grows whenever a page is added. A stale list would create silent route
shadowing. The prefix invariant is the source of truth instead.

### Client resolution and API requests

The workspace anchor resolves `$workspaceSlug` from the authenticated workspace
summaries. The project anchor resolves `$projectSlug` from the workspace's
project list. Resolution happens at the anchor boundary, before feature pages
make requests.

After resolution, client adapters and query keys use UUIDs. The slug remains in
the route for navigation and display. Renaming a slug therefore changes the URL
without changing the cached resource identity or any API request.

Slug resolution never enters the API request path. `requireWorkspaceAccess`
continues to receive a UUID and remains stateless. Session token claims remain
unchanged, and no slug is stored as a foreign reference or token identity.

The authenticated workspace slug-availability endpoint is not a resource
resolver. It accepts a candidate slug and returns only whether the namespace is
available. It never returns a workspace or authorizes access to one.

### Settings section scope

`settingsSections` entries have an optional `scope` discriminator with the
values `workspace` and `project`. Existing entries default to `workspace`. The
project settings anchor renders project-scoped entries, while the workspace
settings anchor renders workspace-scoped entries. A section that belongs in
both surfaces contributes once for each scope.

The discriminator prevents every existing workspace section from appearing in
project settings when the new anchor is assembled. A feature that needs both
surfaces contributes separate entries, one per scope. The project settings
general section owns the project name and slug rename surface. Moving other
workspace resources to project scope is separate work.

### Run number

Each workflow lineage owns a monotonic run counter. The first run starts at one,
and the `(definitionId, number)` pair is unique for the lineage id carried by
`workflow_runs.definition_id`. A lineage is stable per `(projectId, configPath)`;
pathless manual definitions share one project-scoped lineage. Legacy definition
rows are reconciled when read or synchronized; the schema migration only adds
nullable lineage storage and does not rewrite historical rows. Allocation occurs
inside the run-creation transaction after trigger idempotency is resolved. A duplicate
trigger returns the existing run without consuming a number.

Gaps are acceptable because the number is a label and monotonicity matters more
than density. Counter rows are not cleaned up when a definition is removed, and
reruns create another attempt on the same run instead of consuming another
number.

`run.number` is available in workflow expressions after allocation. It is a
display label and a context value, never a route parameter or an API lookup
key. Run URLs continue to use the run UUID.

## Consequences

- Client links are readable and can be renamed without changing API identity.
- A shared client link breaks when its slug changes. The client warns before a
  rename, and no redirect or alias history is maintained.
- The API authorization boundary stays UUID-based. It does not need to decide
  whether an incoming string is a slug or a UUID.
- Route composition rejects a malformed prefix or slug placement before it can
  produce a generated route tree.
- Run numbers repeat across workflow definitions. The workflow name must remain
  next to the number in lists and headers so the label is meaningful.
- The project settings surface has the same shell boundary as workspace settings
  and can filter contributed sections by scope.

## Rejected alternatives

### Use slugs in API resource routes

This would make a rename an API identity concern and move slug resolution into
authorization. It would also require token and request-boundary changes. Keeping
UUIDs in the API leaves `requireWorkspaceAccess` stateless.

### Use unprefixed slug paths

`/$workspaceSlug/$projectSlug` is shorter, but it requires a reserved-slug list.
The list would be easy to miss when adding a page and would fail through route
shadowing. The explicit `w` and `p` namespaces make the invariant structural.

### Prefix every entity reference

Adding `r` and more prefixes for UUID resources makes the URL look symmetric but
does not protect a user-chosen slug. It also makes every future nested UUID route
carry a new registration. Page segments already disambiguate UUID references.

### Route runs by number

Run numbers are scoped to a workflow definition and can repeat in a project. A
number-only route would need a server lookup, a second authorization path, and a
policy for counter resets. The UUID remains the run address.

### Keep a slug alias or redirect history

Aliases would make old URLs look stable while creating extra namespace state and
authorization behavior. The product accepts broken old links and warns before a
rename instead.
