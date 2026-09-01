# Shipfox Client Onboarding

Client onboarding for Shipfox workspaces: the pre-project setup gate, the
post-activation Get-started checklist, and its panel and top-bar hosts.

## What it does

- **`loadWorkspaceSetupRoute`**: the existing onboarding gate. It recomputes
  "where should this user be" from live queries on every navigation under
  `/w/$workspaceSlug`: suspended check, then project existence, then usable
  source connections, then model-provider handling, then project creation.
- **`deriveIntegrationReadiness`**: the readiness model shared with the
  first-workflow spec. It turns the provider catalog and the workspace's
  connections into per-provider `connected` and `attention` state, an
  `attentionProviders` list ordered by the most recent connection update, and
  the two workspace-level facts `hasSourceControl` and `hasToolIntegration`.
- **`deriveSetupChecklist`**: the setup-checklist derivation. It turns
  integration readiness plus runner, model-provider, and membership facts into
  the ordered `items` list, the tracked `openCount` and `trackedCount`, and
  `complete`. Rows follow the spec order; the runner and model-provider rows
  exist only when the installation does not already provide the capability;
  the first-workflow and teammates rows are pointers that never count.
- **`selectNextSetupStep`**: the one row a compact host asks for. It returns the
  first open tracked row, falling back to the first unfinished pointer once
  every tracked row is done.
- **`WorkspaceSetupChecklist`** and **`WorkspaceSetupIndicator`**: slot-ready
  hosts that load the five checklist query families, render the checklist in a
  panel or a non-modal popover, and persist per-device dismissal. The panel sits
  above a page's own content, so it shows only the next step until a header
  toggle opens the full list, and it remembers that choice per device. The
  popover always carries the whole checklist.

The derivations are pure functions. They test without React and decide what
the checklist shows, while the hosts own query freshness, loading and failure
gating, analytics, completion transitions, and the completion burst.

## Installation and setup

```sh
pnpm add @shipfox/client-onboarding
```

The package is part of the `libs/client` workspace. Its runtime dependencies
are `client-agent`, `client-integrations`, `client-projects`, `client-runners`,
`client-shell`, and `client-workspace-settings`.

## Usage

```ts
import {
  deriveIntegrationReadiness,
  deriveSetupChecklist,
  selectNextSetupStep,
} from '@shipfox/client-onboarding';

const readiness = deriveIntegrationReadiness({
  providers: [
    {provider: 'github', displayName: 'GitHub', capabilities: ['source_control']},
    {provider: 'linear', displayName: 'Linear', capabilities: ['agent_tools']},
  ],
  connections: [],
});

const checklist = deriveSetupChecklist({
  readiness,
  installationRunners: 'none',
  workspaceRunnerCapacity: false,
  modelProvider: {installationProvided: false, configured: false},
  membership: {memberCount: 1, pendingInvitationCount: 0},
});

checklist.items; // 7 rows: source control, project, tools, runner,
// model provider, first workflow, teammates
checklist.trackedCount; // 5
checklist.openCount; // 3
checklist.complete; // false

selectNextSetupStep(checklist)?.id; // 'tools'
```

The rendered hosts can be exported through the package feature entry point for
shell slot composition:

```ts
import {
  WorkspaceSetupChecklist,
  WorkspaceSetupIndicator,
} from '@shipfox/client-onboarding/feature';
```

The caller maps its own query results to the derivation inputs:

- `providers` and `connections` use the plain values from
  `@shipfox/client-integrations`.
- `installationRunners` is `'managed'` or `'none'`.
- `workspaceRunnerCapacity` reports whether the workspace has runner capacity.
- `modelProvider` reports installation-provided inference and workspace
  configuration.
- `membership` reports the member and pending-invitation counts.

## Behavior notes

- A provider is `connected` when at least one connection is `active`; it needs
  `attention` when connections exist but none is active. The two states are
  mutually exclusive.
- `hasToolIntegration` is the tools-row criterion: an active connection whose
  provider lacks the `source_control` capability. GitHub never satisfies it.
- The tools row names one attention provider ("Linear needs attention") or
  counts several ("2 integrations need attention").
- `complete` is true when every tracked row is done. Tracked rows are source
  control, project, and tools, plus runner and model-provider when those rows
  exist. The first-workflow and teammates pointers never count.
- The runner row exists only when `installationRunners` is `'none'`; the
  model-provider row exists only when `modelProvider.installationProvided` is
  false.
- The teammates row renders done at `memberCount >= 2` or
  `pendingInvitationCount >= 1`, but stays a pointer.
- The panel and indicator render nothing for an initially complete checklist;
  the mounted host that observes the final tracked row transition renders the
  completion state and owns its one-shot burst.
- Dismissal is scoped to the workspace and device. A dismissed host does not
  subscribe to checklist queries until the flag is cleared.

## Development

```sh
turbo check --filter=@shipfox/client-onboarding
turbo type --filter=@shipfox/client-onboarding
turbo test --filter=@shipfox/client-onboarding
turbo build --filter=@shipfox/client-onboarding
```

The package runs Storybook per the per-package recipe (`pnpm storybook` on
port 6015) with stories covering both hosts and each checklist state.

## License

MIT
