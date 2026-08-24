# Architecture decision record 0008: Administration controls

- **Status:** Accepted.
- **Date:** 2026-07-26.
- **Decision owners:** Administration controls and Auth.
- **Related:** [ADR 0001: Public client composition contract](0001-client-composition-contract.md),
  [ADR 0002: Server inter-module architecture](0002-api-inter-module-architecture.md),
  and [ADR 0006: Database ownership boundaries](0006-database-ownership-boundaries.md).
- **Extended by:** [ADR 0014: Admin user impersonation](0014-admin-user-impersonation.md),
  which supersedes the "User impersonation" non-goal in the scoping specification behind
  this record. The role model, idempotency, audit, and suspension semantics here are
  unchanged.

## Context

**Shipfox needs one administration experience for every instance.** Local
operators need to inspect safe instance data. They also need to manage
administrator grants, suspend or reactivate users, revoke sessions, and suspend
or reactivate workspaces.

**Administration crosses existing module boundaries.** Auth owns users and
sessions. Workspaces owns workspace state. Projects owns project data. Each
configuration owner knows which effective values are safe to expose. A central
Administration module would either duplicate those rules or access data that
another module owns.

**Administrator authority must be local, small, and explicit.** Workspace
membership roles answer what a member can do inside one workspace. Instance
administrator roles answer what an operator can do across the local Shipfox
instance. External identity claims and deployment type do not define either
kind of access.

**Sensitive actions need stable retry and audit semantics.** Browser retries
and network loss must not repeat a mutation. Each mutation must publish a
redacted, attributable event without coupling the business action to audit
storage or search.

**Workspace suspension must have one predictable meaning.** It must stop new
work without deleting data or turning into an incomplete emergency-stop
mechanism.

## Decision

**This record defines an architecture contract only.** It introduces no
runtime behavior, shared Administration module, database schema, route, or
client feature.

### Auth owns a fixed instance-administrator role model

**Auth owns local instance-administrator grants, role evaluation, first-owner
bootstrap, and the current authenticated actor.** A grant belongs to one local
Shipfox user. It does not depend on email domains, external identity claims, or
hosted-versus-self-hosted deployment type.

Shipfox defines exactly three instance-administrator roles:

| Role | Purpose | Access |
| --- | --- | --- |
| `admin-observer` | Read-only support and diagnosis. | Administration inspection routes. |
| `admin-operator` | Routine support and moderation. | Observer routes plus user suspension, session revocation, and workspace suspension. |
| `admin-owner` | Instance administration and administrator recovery. | All administration routes, including administrator grant management. |

**The roles are fixed and ordered.** Each administration route declares one
minimum role from this table. Auth provides one server-side check that compares
the actor's current role with the declared minimum. The owning route calls that
check before its use case.

This decision does not add custom roles, per-capability grants, or a
role-to-capability registry. A new administration route chooses one of the
three minimum roles. A change that cannot fit this ordering requires a new
architecture decision instead of a parallel authorization mechanism.

**Instance-administrator roles stay separate from Workspace membership
roles.** An administrator grant does not grant membership in a workspace. A
workspace role does not grant instance-administrator access. The
instance-administrator role is not added to the existing stateless session
token. Auth loads the actor's current grant on the server for each
administration authorization decision.

The client can read the current role to place navigation and hide unavailable
actions. The client role is never an authorization source. A modified client
cannot bypass the server-side role check.

**No operation can remove or suspend the final active owner.** The action
requires a completed replacement-owner operation first.

**First-owner bootstrap requires installer intent.** An authenticated user can
claim the first `admin-owner` grant only when no active owner exists and the
request presents the deployment's `ADMIN_BOOTSTRAP_TOKEN`. Auth compares the
token safely, publishes its administration-action event in the same
transaction, and rejects later bootstrap attempts while an active owner exists.
The token never enters browser storage, API responses, logs, or audit metadata.

**A suspended owner does not count as an active owner.** The grant remains
stored, but a user account with `suspended` status is excluded from the active
owner check. If that leaves no active owner, authenticated bootstrap recovery
is intentionally available again with the deployment token. Reactivating the
owner closes bootstrap while the grant remains valid.

### Domain modules own administration behavior

**Each domain module owns administration behavior for its resources.** The
owner defines:

- Its `/admin/...` HTTP routes and each route's minimum role.
- Its use cases and call to the Auth role check.
- Its database reads and mutations.
- Its safe dashboard read model and client feature.
- Its redacted administration-action outbox events.

The initial path families are:

| Owner | Path family | Minimum role and scope |
| --- | --- | --- |
| Auth | `/admin/auth/users` | `admin-observer` for bounded lookup and safe account status; `admin-operator` for suspension, reactivation, and session revocation. |
| Auth | `/admin/auth/admin-grants` | `admin-observer` for bounded grant listing; `admin-owner` for local administrator role changes. |
| Workspaces | `/admin/workspaces` | `admin-observer` for bounded lookup and safe status; `admin-operator` for suspension and reactivation. |
| Projects | `/admin/projects` | `admin-observer` for bounded lookup and safe status. |
| Each configuration owner | `/admin/<module>/configuration` | `admin-observer` for safe effective-configuration inspection. |

**Authorization and behavior stay at the owning route or use case.** A module
obtains current facts from another module through the producer's declared
inter-module contract. It does not read another module's tables.

**The composition root registers contributions without owning the
behavior.** It composes module routes, the protected dashboard shell, and
module-owned navigation or client features. It does not dispatch requests
through a central Administration gateway.

### Keep the API dashboard-only

**`/admin` is an internal contract for the Shipfox administration
dashboard.** Requests use the ordinary authenticated browser session and the
normal same-origin protections. Mutations use the same Cross-Site Request
Forgery (CSRF), origin, secure-cookie, and session-rotation protections as
other authenticated browser mutations.

The dashboard shows the actor's current instance-administrator role. It hides
unavailable actions, but client visibility is not authorization. Every server
route enforces its declared minimum role.

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

**The owner publishes a redacted administration-action event atomically.** The
state change, idempotency result, and audit outbox event commit in one owner
transaction. The standard event contains:

- Stable actor user ID and actor role.
- Required role and command name.
- Resource type and stable target ID.
- Request or correlation ID.
- Operator reason.
- Outcome and timestamp.
- The idempotency-key fingerprint, not the raw key.

**Modules do not write an audit table or retain audit history.** Their outbox
rows are delivery infrastructure, not local audit ledgers. The event contract
is the only audit integration boundary defined here. Downstream storage,
retention, search, delivery monitoring, and consumer behavior are outside this
ADR. No downstream consumer reads producer business tables or receives a
producer database handle.

Read access emits structured security logs with the actor, required role,
target type, request ID, and result. Logs, traces, records, and events do not
contain full personally identifiable information payloads, secrets, raw
tokens, bootstrap values, or database errors.

### Define suspension semantics

**User suspension blocks new authentication and revokes refresh sessions.**
New sign-ins become ineligible. Current-state reads such as `/auth/me` expose
the persisted suspended status, while ordinary JWT verification remains
claim-only. An access token already issued remains usable until its configured
`exp` time. Reactivation restores eligibility to sign in but does not restore
revoked refresh sessions or modify the user's data.

**Workspace suspension blocks every new-job admission path.** The workspace
and its data remain in place. Member actions, triggers, schedules, and
webhook-driven admission reject new work with the stable
`workspace-suspended` result. The result is not transient and must not create
a retry loop.

Newly issued or refreshed user JWTs carry the lifecycle status of each workspace
membership. The stateless member-access gate maps a `suspended` claim to the
stable `workspace-suspended` result (409) and a deleted claim to
`workspace-inactive` (403); an absent membership remains an ordinary forbidden
result. Workspace-scoped member, invitation, trigger, log, and workflow routes
use that gate. Resource routes retain a non-leaking 404 for missing resources or
memberships, while annotation reads filter to active claimed workspaces and
return no rows for suspended or deleted claims. Existing access tokens remain
usable until their configured `exp` time because workspace authorization is
claim-based. Refresh-session state is the renewal boundary; it does not
retroactively invalidate an issued access token. The recommended access-token
lifetime is 15 minutes.

The refresh membership snapshot is read before refresh-token rotation and
access-token signing. If workspace suspension races with that read, the
in-flight refresh may still issue a token containing the pre-suspension status;
the next refresh observes the new workspace state. This bounded snapshot race
is accepted alongside the claim-based access-token lifetime.

Jobs queued or running before suspension continue to their normal terminal
state. Suspension does not cancel jobs, revoke runner leases, or stop active
workflow execution. Reactivation makes newly issued or refreshed claims active;
existing access tokens retain their claim snapshot until expiration. It does not
replay work rejected during suspension.

Member-facing routes expose only a safe suspension state. The client replaces
ordinary workspace content with a neutral suspension page. It does not show
the operator reason, administrator identity, or audit data.

**Workspace suspension is not an emergency lockdown.** A future action that
stops active work needs a separate contract for jobs, runners, secrets,
recovery, and user communication.

### Keep the common feature source-available

**The source-available Shipfox repository owns the common feature.** It owns
the fixed role model, Auth and domain-module behavior, API contracts, dashboard
features, the standard administration-action event contract, and this decision.

Deployment configuration, initial operator setup, secret delivery and rotation,
and operational runbooks are outside this ADR. They must not add a hidden grant
path or database bypass.

## Consequences

**Administration remains distributed by domain ownership.** Contributors add
routes, reads, mutations, and redacted event producers to the module that owns
the resource. There is no central Administration database or business module.

**Auth becomes the single instance-administrator authority.** Domain modules
use the Auth-owned fixed-role check instead of reimplementing role policy.

**Authorization stays intentionally coarse.** The three-role ordering is easy
to inspect and recover. It cannot express a one-off permission without
changing a route's minimum role or revisiting this decision.

**The dashboard has one entry point but several feature owners.** Shared
composition provides navigation and current-actor role access. Each module
owns the behavior and presentation for its resources.

**Mutations require transactional event publication.** Each owning module must
store idempotency results and an outbox entry beside its state. Any downstream
handling remains asynchronous, so it cannot block or replace the business
transaction.

**Workspace suspension cannot ship before admission coverage is complete.**
Every current job-creation path needs an identified owner and a checked
suspension gate before the dashboard exposes the command.

## Rejected alternatives

### Add a capability registry or custom roles

**A capability model adds configuration without a current product need.** A
registry, custom roles, or per-capability grants would create more policy
states, recovery cases, and client concepts. Every initial route fits the
fixed observer, operator, and owner ordering.

### Add a central Administration module

**A central module would weaken domain and database ownership.** It would need
to copy policies, reach into other modules' storage, or dispatch opaque
requests. Module-owned routes keep authorization and state changes beside the
business rules they protect.

### Derive administrators from external identity claims

**External claims make authorization deployment-specific.** Local grants give
every Shipfox instance the same model. They also keep changes attributable to a
Shipfox user.

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

### Retain audit history in source-available modules

**A local audit ledger would add storage outside the module's business
responsibility.** The producer already commits a redacted outbox event with the
business action. This ADR defines that portable producer contract, not the
storage, retention, or search behavior of downstream systems.
