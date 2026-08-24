# Architecture decision record 0014: Admin user impersonation

- **Status:** Accepted.
- **Date:** 2026-08-24.
- **Decision owners:** Administration controls, Auth, and client composition.
- **Linear issue:** [ENG-1702](https://linear.app/shipfox/issue/ENG-1702).
- **Amends:** [ADR 0001: Public client composition contract](0001-client-composition-contract.md).
- **Related:** [ADR 0008: Administration controls](0008-administration-controls.md).
- **Supersedes:** the "User impersonation" non-goal in the private instance administration
  dashboard specification (2026-07-27), by reference. ADR 0008 itself is not edited.

## Context

**Support and operations administrators need to see and operate the product exactly as a
specific user does.** They diagnose and reproduce user-reported problems that only appear in
the user's own view: their workspaces, projects, and data. A session that carries the user's
identity must never carry administrator authority.

**The initial administration scope recorded impersonation as a non-goal.** The private
instance administration dashboard specification (2026-07-27), which scoped the ADR 0008
administration controls, listed "User impersonation" among its non-goals. The delivered
administration surface covers lookup, suspension, session revocation, and grant management,
but not acting as a user.

Several design questions need answers:

- Should an impersonated session be read-only or full read-write?
- Which administrator role may impersonate?
- How long may an impersonated session live, and how does it end?
- How does the target user learn about impersonation?
- Where does the capability live: the source-available repository or the private Cloud
  dashboard?

## Decision

**This record introduces the admin user impersonation capability.** It defines an
architecture contract only. Later work implements it in `@shipfox/api-auth` and
`@shipfox/client-shell`, following the ADR 0001 composition contract for the client seams.

### The impersonation capability

An `admin-operator` (or higher) can obtain a short-lived, marked, fully audited session for a
target user. The session behaves like the target's own session for ordinary product use. It has
full read-write capability on product routes, and every request is marked and audited. It never
carries administrator authority.

The minimum role is `admin-operator`, the same bar as user suspension and session revocation.
The fixed three-role model from ADR 0008 is unchanged.

### Placement

`@shipfox/api-auth` owns the capability: the mint command, the session model, the token
contract, and the administration route. `@shipfox/client-shell` owns generic composition seams
only: a session-banner slot and an adopted-session runtime seam. The private Cloud dashboard
owns the entire user-facing surface: the dashboard action and the in-app banner. The
source-available client distribution ships no impersonation UI.

### Access-token-only session model

An impersonated session is a signed user access token and nothing else:

- The token's `sub` is the target user. It carries the target's real membership claims,
  loaded the same way login loads them.
- The token carries an optional `impersonatorId` claim set to the administrator's user ID.
  The claim is declared in the token schema and lives inside the signed payload, so a client
  cannot remove or forge it.
- The token carries no `refreshSessionId`. The command creates no refresh session and no
  cookie, and the administrator's own refresh cookie stays untouched.
- The token time-to-live (TTL) is min(`AUTH_JWT_EXPIRES_IN`, 15 minutes).
- `AUTH_JWT_EXPIRES_IN` must be a valid duration of at least 1 second. A malformed or
  non-positive value is a configuration error. The mint command fails closed before signing
  when its effective TTL is at or below zero.
- The adopted bearer token is the only request credential for product routes. The client never
  falls back to the administrator's refresh cookie or uses that cookie as a request credential.
  The cookie is used only by the explicit refresh path, which restores the administrator's
  session.

This shape makes the safety properties structural rather than procedural:

- The session cannot outlive its window. The refresh path reads the cookie, which still
  belongs to the administrator, so it can only restore the administrator's identity. No
  persisted state can resurrect the impersonated session.
- Exit is instant and client-local. The client drops the token and runs the ordinary refresh
  flow, which restores the administrator's principal and clears cached data.
- Nothing needs revoking. There is no refresh row and no cookie to clear. The residual risk
  is bounded by the ≤15-minute token, consistent with the platform invariant that issued
  access tokens are never revocable before `exp`.

The adopted token lives only in the shell `AuthRuntime` memory for one browser tab. It never
enters a cookie, `localStorage`, `sessionStorage`, IndexedDB, or another persistent store.
Reload and tab close discard it, and the ordinary refresh flow restores the administrator.
Tabs do not share an adopted token or Stop state.

### Renewal

Renewal is a new invocation of the same mint command, explicitly triggered by the
administrator:

1. The client obtains a fresh administrator access token through the ordinary refresh path.
2. The client issues a new impersonate command with a new idempotency key. The reason may be
   reused. Every Extend uses a fresh key, even when a transport retry repeats the request.
3. The renewal re-runs the full authorization and eligibility checks and publishes its own
   audit event.

There is no renewal cap. Each window is short, each extension is a deliberate administrator
action, and each extension is audited. Automatic renew-on-activity is future work.

Every successful mint, replay, and renewal response includes `expires_at` and a `server_time`
timestamp from the issuer. The client derives countdown and Extend availability from that
server-time anchor. If responses race, it keeps the token with the later `expires_at`.

### Authorization and anti-escalation

`AUTH_IMPERSONATION_ENABLED` defaults to `false`. It is an explicit opt-in. Cloud enables it
only after the supported clients provide the banner and adopted-session seam. The mint route
fails closed when a client does not advertise the minimum banner-capable seam version. The flag
cannot create an unmarked session in a mixed-version deployment.

The mint command enforces its checks in order:

1. `AUTH_IMPERSONATION_ENABLED` is true, else the known failure `impersonation-disabled`.
2. The actor holds an active grant of at least `admin-operator`, else `admin-role-required`.
3. The actor's session is not itself impersonated.
4. The actor is not the target, else `cannot-impersonate-self`.
5. The target exists, is `active`, and has a verified email, reusing the ordinary login
   eligibility. A suspended target yields `impersonation-target-not-active`.
6. The target holds no active administrator grant of any role, else
   `cannot-impersonate-administrator`.

Rule 6 is the anti-escalation rule. An operator can never obtain owner authority, and
administrators cannot silently act as one another.

**Impersonated sessions are rejected by every administration authorization path before roles
are consulted.** The shared authorization helper in the administration routes and Cloud's
signup-access `authorizeAdministration` reject a request whose context carries
`impersonatorId`, returning `admin-role-required`. This same rule forbids nested
impersonation, because the impersonate route is an administration route. The eligibility rule
is a belt-and-braces defense, not the primary control.

### An idempotent, audited command

The mint command follows the ADR 0008 idempotent-command recipe with one documented
deviation: the bearer token is never persisted. The stored command result contains only
non-secret data needed to reproduce the result: `{target_user_id, expires_at, jti,
token_claims_snapshot, token_fingerprint}`. `jti` is a stable token identity that is reused on
replay. The snapshot contains the identity and membership claims used for the original token.
`token_fingerprint` is the SHA-256 hash of `jti`, so it remains stable when the signature bytes
change. The result never stores the signed bearer token or refresh material.

- A replay with the same key before `expires_at` is check-free. It does not re-run authorization
  rules 1-6 or read current membership state. It re-signs the stored claim snapshot with the
  same `jti` and original `expires_at`. It cannot extend the window.
- A replay after `expires_at` returns the known failure `impersonation-expired`. The client
  issues a new command with a fresh key.
- Reusing the key for a different command returns `idempotency-key-reused`, unchanged.

Every initial mint, replay, and renewal publishes one
`administration.action.performed` event atomically with the command result on success or failure.
The event carries
the command `auth.user.impersonate`, the target user, the actor and their role, the required role,
the reason, and the idempotency-key fingerprint. The shared event schema remains strict and has
no `expires_at` field. Auditors join the event's idempotency-key fingerprint to the stored
command result, where `expires_at` is canonical and is never reconstructed from current
configuration. v1 audit scope covers issuance, replay, renewal, and failure. Stop is client-local,
so no event records Stop or the last request made with the token.

Authenticated request logging carries `impersonatorId` when the context has it, so any action
taken during impersonation is attributable through the correlation ID. Domain outbox events
produced during an impersonated session do not carry the impersonator in v1; this is an
accepted, documented limitation.

### Transparency

v1 publishes internal audit events only. User-facing notification and consent flows are named
future work. The always-visible in-app banner is the user-visible mark. It shows the target's
identity, a countdown to expiry, an Extend action, and a Stop action. Stop must never call the
logout route, because logout operates on the administrator's refresh cookie.

Stop is terminal for the current browser tab. The client marks the adopted session terminated and
increments its adoption generation before clearing the token. A mint or renewal response may be
adopted only when its generation matches the current active generation. A response that arrives
after Stop is ignored, so an in-flight Extend cannot silently restore the impersonated session.

### Supersession

**This record supersedes the "User impersonation" non-goal in the private instance
administration dashboard specification (2026-07-27), by reference.** ADR 0008 itself is not
edited; it continues to govern the role model, idempotency, audit, and suspension semantics that
this capability builds on.

## Consequences

- An impersonated session cannot outlive its ≤15-minute window and cannot be refreshed. The
  administrator's refresh cookie remains the only durable credential, so exit and expiry
  always restore the administrator's own session.
- No privilege escalation exists: no path impersonates an administrator, and no impersonated
  session can exercise administrator authority.
- Every mint, replay, and renewal is an audited, idempotent, rate-limited command with a
  mandatory reason.
- The capability stays upstream. The source-available distribution gains generic seams only;
  all impersonation UI ships from Cloud packages.
- Suspension semantics compose with the ADR 0008 model: suspending the target blocks renewal
  but does not kill an issued token or a check-free replay within its original window; revoking
  the target's sessions does not affect the impersonated token; revoking the administrator's
  grant blocks the next renewal.
- This record gates the implementation sequence: claim plumbing, administration hardening,
  the mint command and route, the client-shell seams, and the Cloud surface.

## Rejected alternatives

### Read-only or restricted impersonation

**A restricted mode cannot reproduce user-reported problems faithfully.** Per-route or
per-permission scoping adds policy surface without a product need. Full read-write is bounded
by the short window, explicit audited renewal, the operator role bar, and mandatory reasons.

### A refresh session or durable impersonation record

**A refresh session or a durable impersonation-session table would let the session outlive
its window.** It would also require a server-side stop command, an "active impersonations"
view, and revocation surface. The access-token-only model has no persisted state to revoke,
so exit and expiry are always safe by default.

### Impersonating administrators or a hidden staff bypass

**Allowing administrator targets would let an operator obtain owner authority.** A hidden
bypass would violate the "never create a hidden Cloud staff bypass" principle behind ADR 0008.
The capability is explicit, role-gated, reason-carrying, and audited.

### Storing the minted token in the idempotency result

**Storing the token would write session material to the database.** The stable token identity and
claims snapshot keep the signed bearer token out of storage. They preserve retry semantics when
a response is lost in transit.

### Automatic renewal on activity

**Automatic renewal would blur the audit trail and lengthen the effective session without a
deliberate action.** Continuation always requires a live, re-authorized server command.

### User-facing notification or consent in v1

**Notification and consent flows need product decisions about delivery and privacy.**
Internal audit events cover v1 accountability; the flows are named future work.

### Impersonation UI in the source-available client

**Impersonation is an administration capability with a single private surface.** Generic
seams keep the open-source distribution neutral, and the Cloud dashboard owns all
impersonation UI.
