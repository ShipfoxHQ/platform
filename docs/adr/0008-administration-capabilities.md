# Architecture decision record 0008: Administration capabilities

- **Status:** Accepted.
- **Date:** 2026-07-26.
- **Decision owners:** Administration capabilities and Auth.
- **Related:** [ADR 0001: Public client composition contract](0001-client-composition-contract.md),
  [ADR 0002: Server inter-module architecture](0002-api-inter-module-architecture.md),
  and [ADR 0006: Database ownership boundaries](0006-database-ownership-boundaries.md).

## Context

**Shipfox needs one administration experience for Cloud and self-hosted
instances.** Local operators need to inspect safe instance data. They also need
to manage administrator grants, suspend or reactivate users, revoke sessions,
and suspend or reactivate workspaces.

**Administration crosses existing module boundaries.** Auth owns users and
sessions. Workspaces owns workspace state. Projects owns project data. Each
configuration owner knows which effective values are safe to expose. A central
Administration module would either duplicate those rules or access data that
another module owns.

**Administrator authority must be local and explicit.** External identity
claims and deployment type do not define Shipfox administrator access. The
first owner also cannot be whichever user happens to sign in first.

**Sensitive actions need stable retry and audit semantics.** Browser retries
and network loss must not repeat a mutation. Every action must remain
attributable even when a later cross-module audit view is delayed or absent.

**Workspace suspension must have one predictable meaning.** It must stop new
work without deleting data or turning into an incomplete emergency-stop
mechanism.

## Decision

### Auth owns roles and capability evaluation

**Auth owns local administrator grants, role policy, capability evaluation,
first-owner bootstrap, and the current actor's effective capabilities.** A
grant belongs to one local Shipfox user. It does not depend on email domains,
external identity claims, or hosted-versus-self-hosted deployment type.

The initial roles are:

| Role | Purpose | Initial capability policy |
| --- | --- | --- |
| `admin-observer` | Read-only support and diagnosis. | Receives all initial read capabilities. |
| `admin-operator` | Routine support and moderation. | Receives observer capabilities plus user suspension, session revocation, and workspace suspension. |
| `admin-owner` | Instance administration and administrator recovery. | Receives every registered administration capability, including grant management. |

**New capabilities automatically belong only to `admin-owner`.** Observer and
operator receive a new capability through an explicit Auth role-policy change.
No operation can remove, suspend, or revoke the final active owner without a
completed replacement-owner operation.

**First-owner bootstrap requires installer intent.** An authenticated user can
claim the first `admin-owner` grant only when no active owner exists and the
request presents the deployment's `ADMIN_BOOTSTRAP_TOKEN`. Auth compares the
token safely, records the action atomically, and rejects later bootstrap
attempts while an active owner exists. The token never enters browser storage,
API responses, logs, or audit metadata.

### Use one administration capability vocabulary

**Capability names express an action on an owning domain.** The initial
vocabulary is:

| Owner | Capability | Authorized behavior |
| --- | --- | --- |
| Auth | `admin.users.read` | Perform bounded user lookup and read a safe account summary. |
| Workspaces | `admin.workspaces.read` | Perform bounded workspace lookup and read a safe workspace summary. |
| Projects | `admin.projects.read` | Perform bounded project lookup and read a safe project summary. |
| Each configuration owner | `admin.configuration.read` | Read that owner's typed, redacted effective configuration. |
| Auth | `admin.users.suspend` | Suspend or reactivate a user. |
| Auth | `admin.users.sessions.revoke` | Revoke a user's active sessions. |
| Workspaces | `admin.workspaces.suspend` | Suspend or reactivate a workspace. |
| Auth | `admin.grants.write` | Grant or revoke a local administrator role. |

The future Auth implementation owns the executable registry and role mapping.
This record owns the initial names and their architectural meaning. A change to
that meaning requires an architecture decision. Adding a capability requires
an Auth registry change and an explicit observer or operator policy decision.

### Domain modules own administration behavior

**Each domain module owns administration behavior for its resources.** The
owner defines:

- Its `/admin/v1/...` HTTP routes.
- Its use cases and capability checks.
- Its database reads and mutations.
- Its safe dashboard read model and client feature.
- Its local administration action records and audit outbox events.

The initial path families are:

| Owner | Path family | Scope |
| --- | --- | --- |
| Auth | `/admin/v1/auth/users` | User lookup, status, suspension, reactivation, and session revocation. |
| Auth | `/admin/v1/auth/admin-grants` | Local administrator role listing and changes. |
| Workspaces | `/admin/v1/workspaces` | Workspace lookup, status, suspension, and reactivation. |
| Projects | `/admin/v1/projects` | Project lookup and status summary. |
| Each configuration owner | `/admin/v1/<module>/configuration` | Safe effective-configuration inspection. |

**Authorization stays at the owning route or use case.** A module obtains
current facts from another module through the producer's declared inter-module
contract. It does not read another module's tables.

**The composition root registers contributions without owning the
behavior.** It composes module routes, the protected dashboard shell, and
module-owned navigation or client features. It does not dispatch requests
through a central Administration gateway.

### Keep the API dashboard-only

**`/admin/v1` is an internal contract for the Shipfox administration
dashboard.** Requests use the ordinary authenticated browser session and the
normal same-origin protections. Mutations use the same Cross-Site Request
Forgery (CSRF), origin, secure-cookie, and session-rotation protections as
other authenticated browser mutations.

The dashboard shows the actor's role and effective capabilities. It hides
unavailable actions, but client visibility is not authorization. Every server
route requires the exact capability.

The first release does not add administrator bearer tokens, personal access
tokens, service accounts, or a documented third-party automation API. External
automation requires a separate authentication and token-lifecycle decision.

**Reads are bounded and redacted.** Lookup routes use checked filters, bounded
pagination, and deterministic ordering. Read models expose only the personally
identifiable information needed for support. They never expose passwords,
session material, access or refresh tokens, secrets, raw provider responses,
or encrypted values.

Configuration owners return typed effective values and their source. They do
not return process environment dumps. Secret values, secret paths, tokens,
private keys, connection strings, and provider credentials stay redacted.
Configuration writes are outside this decision.

### Make mutations idempotent and auditable

**Every mutation accepts an `Idempotency-Key`.** The owning module stores the
key's fingerprint and command result at the same database boundary as the
state change. Retrying the same command with the same key returns the prior
result. Reusing a key for a different command fails.

Suspend and reactivate commands express a desired state. Repeating a successful
command succeeds without changing the final state. Mutation requests include
an operator reason. The dashboard confirms the action, target, and effect
before it sends a suspension or grant-management command.

**The owner records the action and its audit event atomically.** The state
change, idempotency result, immutable local action record, and audit outbox
event commit in one owner transaction. The local record and standard event
contain:

- Stable actor user ID and actor role.
- Capability and command name.
- Resource type and stable target ID.
- Request or correlation ID.
- Operator reason.
- Outcome and timestamp.
- The idempotency-key fingerprint, not the raw key.

A later cross-module projection can consume these events for search. It does
not own the business action and is not an Administration module. A delayed
projection cannot erase or replace the durable module-owned record.

Read access emits structured security logs with the actor, capability, target
type, request ID, and result. Logs, traces, records, and events do not contain
full personally identifiable information payloads, secrets, raw tokens,
bootstrap values, or database errors.

### Define suspension semantics

**User suspension blocks authentication and revokes active sessions.** New
sign-ins become ineligible. Authenticated requests check the current user
suspension state as well as the session. Reactivation restores eligibility to
sign in but does not restore revoked sessions or modify the user's data.

**Workspace suspension blocks every new-job admission path.** The workspace
and its data remain in place. Member actions, triggers, schedules, and
webhook-driven admission reject new work with the stable
`workspace-suspended` result. The result is not transient and must not create
a retry loop.

Jobs queued or running before suspension continue to their normal terminal
state. Suspension does not cancel jobs, revoke runner leases, or stop active
workflow execution. Reactivation restores normal access and admission rules.
It does not replay work rejected during suspension.

Member-facing routes expose only a safe suspension state. The client replaces
ordinary workspace content with a neutral suspension page. It does not show
the operator reason, administrator identity, or audit data.

**Workspace suspension is not an emergency lockdown.** A future action that
stops active work needs a separate capability and contract for jobs, runners,
secrets, recovery, and user communication.

### Keep the common feature source-available

**The source-available Shipfox repository owns the common feature.** It owns
the role and capability model, Auth and domain-module behavior, API contracts,
dashboard features, and this decision.

Cloud owns deployment configuration, initial operator setup, secret delivery
and rotation, and Cloud-specific runbooks. Cloud consumes released Shipfox
packages. It does not add a staff identity adapter, hidden grant path, or
database bypass.

## Consequences

**Administration remains distributed by domain ownership.** Contributors add
routes, reads, mutations, and audit records to the module that owns the
resource. There is no central Administration database or business module.

**Auth becomes the single authorization authority.** Domain modules depend on
Auth-owned capability facts rather than reimplementing role policy.

**The dashboard has one entry point but several feature owners.** Shared
composition provides navigation and current-actor capability access. Each
module owns the behavior and presentation for its resources.

**Mutations require more local persistence work.** Each owning module must
store idempotency results and durable action records beside its state. This
cost preserves retry safety and audit evidence without cross-owner
transactions.

**Workspace suspension cannot ship before admission coverage is complete.**
Every current job-creation path needs an identified owner and a checked
suspension gate before the dashboard exposes the command.

## Rejected alternatives

### Add a central Administration module

**A central module would weaken domain and database ownership.** It would need
to copy policies, reach into other modules' storage, or dispatch opaque
requests. Module-owned routes keep authorization and state changes beside the
business rules they protect.

### Derive administrators from external identity claims

**External claims make authorization deployment-specific.** Local grants give
Cloud and self-hosted instances the same model. They also keep changes
attributable to a Shipfox user.

### Make the first authenticated user an owner

**Automatic ownership creates a registration race.** A deployment token
records installer intent and prevents a public user from claiming the
instance.

### Expose a general administrator API

**A general API needs a separate credential model.** Reusing browser sessions
or adding long-lived tokens without lifecycle rules would expand the attack
surface. The first contract serves only the same-origin dashboard.

### Stop active work during workspace suspension

**Stopping active work has different safety and recovery requirements.** It
can strand jobs, runners, and external side effects. Suspension blocks new
admission and lets existing work finish predictably.

### Store only a cross-module audit projection

**A projection can be delayed or unavailable.** The module-owned record
commits with the action and remains the durable evidence. A projection can add
search without becoming the owner.
