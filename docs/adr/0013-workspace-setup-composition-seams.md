# ADR 0013: Workspace setup composition seams

- **Status:** Accepted.
- **Date:** 2026-08-23.
- **Decision owners:** E1 platform composition seams and client architecture.
- **Linear issue:** [ENG-1648](https://linear.app/shipfox/issue/ENG-1648).
- **Amends:** [ADR 0001: Public client composition contract](0001-client-composition-contract.md).

## Context

Workspace onboarding spans the projects hub, navigation chrome, workspace settings, and future
application-owned analytics. The shell must expose those integration points without importing
onboarding components or sending telemetry in the open-source client.

The checklist dismissal is read by more than one feature boundary. The onboarding and workspace
settings packages are sibling features. Both depend on `@shipfox/client-shell`, and neither depends
on the other.

## Decision

### Workspace setup chrome

`ChromeSlots` exposes two optional workspace-setup components:

- `WorkspaceSetupChecklist` renders before the projects hub's first panel when supplied.
- `WorkspaceSetupIndicator` renders to the right of the project breadcrumb on in-shell pages.

The indicator is absent while `hideProjectNavigation` is true. Both slots are optional, and the
shell renders nothing when a composition does not supply one. The shell does not import onboarding
feature modules.

### Client analytics

`composeClientApp()` accepts an optional `ClientAnalytics` implementation. Features read it through
`useClientAnalytics()`. The default implementation discards events, so the open-source client has
no telemetry endpoint.

Features call `capture()` from event handlers or effects. They do not call it during render because
React StrictMode can repeat development renders and effects can be replayed. The provider catches
exceptions from an injected implementation so optional analytics cannot interrupt feature UI.

### Dismissal ownership

The shell owns the typed, workspace-scoped, persistent dismissal helpers for the workspace setup
checklist. The storage layer is best effort and never grants authority. `isWorkspaceSetupChecklistDismissed()`
reads the current value when called. Consumers that need a fresh value re-read it on mount or in
their own focus or storage-event handling; the helper is not a reactive subscription.

The state remains in the shell because the onboarding and workspace settings features are siblings
that share this contract. Moving the state into either feature would create a feature dependency
or duplicate a public key and its semantics.

## Consequences

- The projects hub and nav bar can host workspace-setup UI without a shell-to-onboarding import.
- Applications opt into telemetry explicitly, while analytics failures remain isolated from UI work.
- Consumers own the lifecycle of mounted checklist and indicator components.
- Dismissal remains device-local and best effort. A consumer must decide when to re-read it.
- The shell package owns a cross-feature browser-state contract and must preserve its key and scope.

## Rejected alternatives

### Import onboarding into the shell

This would reverse the dependency direction and make the open-source shell depend on one feature
composition.

### Let each feature define its own dismissal key

Separate keys would allow the checklist and settings surface to disagree about one user decision.

### Let analytics exceptions reach feature code

Optional telemetry must not break a user action or unmount the composed application.
