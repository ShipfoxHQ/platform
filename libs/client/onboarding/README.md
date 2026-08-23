# Shipfox Client Onboarding

Client onboarding for Shipfox workspaces: the pre-project setup gate and the
pure derivations behind the post-activation Get-started checklist.

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

Both derivations are pure functions. They test without React and decide what
the checklist shows, so the component work in this package renders their
output without re-deriving anything.

## Installation and setup

```sh
pnpm add @shipfox/client-onboarding
```

The package is part of the `libs/client` workspace. It depends on the client
feature packages whose queries feed the derivations: `client-integrations`,
`client-agent`, `client-runners`, `client-projects`, and `client-shell`.

## Usage

```ts
import {
  deriveIntegrationReadiness,
  deriveSetupChecklist,
} from '@shipfox/client-onboarding';

const readiness = deriveIntegrationReadiness({providers, connections});

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
```

Feed the derivations with the option factories from the feature packages:

- providers and connections from `@shipfox/client-integrations`
  (`integrationProvidersQueryOptions`, `integrationConnectionsQueryOptions`)
- active provisioners with `installation_runners` from
  `@shipfox/client-runners`
- the model-provider catalog and configs from `@shipfox/client-agent`
- members and invitations from `@shipfox/client-workspace-settings`

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

## Development

```sh
turbo check --filter=@shipfox/client-onboarding
turbo type --filter=@shipfox/client-onboarding
turbo test --filter=@shipfox/client-onboarding
```

The package runs Storybook per the per-package recipe (`pnpm storybook` on
port 6015). Storybook is set up for the checklist components; the package has
no stories until the component work lands.

## License

MIT
