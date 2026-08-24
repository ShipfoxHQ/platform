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
architecture contract only. Later work implements it in `@shipfox/api-auth`,
`@shipfox/api-auth-context`, and `@shipfox/client-shell`, following the ADR 0001 composition
contract for the client seams.

### The impersonation capability

An `admin-operator` (or higher) can obtain a short-lived, marked, fully audited session for a
target user. The session behaves like the target's own session for ordinary product use. It has
read-write capability on product routes, and every request is marked and audited. It never
carries administrator authority, and it never leaves behind a credential or a grant that
outlives its window.

The minimum role is `admin-operator`, the same bar as user suspension and session revocation.
The fixed three-role model from ADR 0008 is unchanged.

### Placement

`@shipfox/api-auth` owns the capability: the mint command, the session model, the token
contract, and the administration route.

`@shipfox/api-auth-context` owns the marked-session contract that other modules consume: the
`impersonatorId` field on `UserContext`, and the two guards that read it. The guards live here
rather than in `@shipfox/api-auth` because the routes that need them are spread across
`@shipfox/api-projects`, `@shipfox/api-workspaces`, `@shipfox/api-runners`, and Cloud. The
inter-module authorization contract cannot carry the mark: its `requireAdminRole` input is
`{userId, minimumRole}`, with no request scope. A request-scoped guard at the route, ahead of
the inter-module call, is the only shape that reaches every surface.

`@shipfox/client-shell` owns generic composition seams only: a session-banner slot and an
adopted-session runtime seam. The private Cloud dashboard owns the entire user-facing surface:
the dashboard action and the in-app banner. The source-available client distribution ships no
impersonation UI.

### Access-token-only session model

An impersonated session is a signed user access token and nothing else:

- The token's `sub` is the target user. It carries the target's real membership claims,
  loaded the same way login loads them.
- The token carries an optional `impersonatorId` claim set to the administrator's user ID.
  The claim is declared in the token schema and lives inside the signed payload, so a client
  cannot remove or forge it. It reaches `UserContext`, `/auth/me`, and authenticated request
  logging, so no surface can describe the session untruthfully.
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
  is bounded by the 15-minute token, consistent with the platform invariant that issued
  access tokens are never revocable before `exp`.

That last property holds only because the session cannot create durable artefacts. See
"Durable-artefact hardening" below, which is what makes the window a real bound rather than
a nominal one.

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
server-time anchor rather than the browser clock. A skewed client cannot present a dead window
as live. If responses race, it keeps the token with the later `expires_at`.

### Authorization and anti-escalation

`AUTH_IMPERSONATION_ENABLED` defaults to `false`. It is an explicit opt-in. The default is off
because the source-available client ships no banner. A self-hosted instance that took the
release with the flag defaulted on would have a live mint route and no user-visible mark
anywhere. Cloud enables it only after the supported clients provide the banner and
adopted-session seam.

The mint command enforces its checks in order:

1. `AUTH_IMPERSONATION_ENABLED` is true, else the known failure `impersonation-disabled`.
2. The actor holds an active grant of at least `admin-operator`, else `admin-role-required`.
3. The actor's session is not itself impersonated.
4. The actor is not the target, else `cannot-impersonate-self`.
5. The target exists, is `active`, and has a verified email, reusing the ordinary login
   eligibility. A suspended target yields `impersonation-target-not-active`.
6. The target holds no active administrator grant of any role, else
   `cannot-impersonate-administrator`.

Rule 6 is the anti-escalation eligibility rule. An operator can never obtain owner authority,
and administrators cannot silently act as one another.

The command is rate limited under its own named bucket in the auth module's fixed-window
limiter. It carries a mandatory bounded reason, like every other administration mutation.

### Administrator-authority hardening

**Every route under an `/admin` prefix rejects a request whose context carries
`impersonatorId`, before roles are consulted**, returning `admin-role-required`. This is the
primary control; rule 6 is belt and braces behind it.

The rule is positional rather than a per-module enumeration, so an administration surface
added later inherits it. Upstream that is seven route groups across four packages today, and
Cloud adds its signup-access `authorizeAdministration`. Stating it positionally also covers
the one administration route that performs no role check at all: the bootstrap route that
claims the first administrator owner. A rule phrased as "wherever a role check runs" would skip
exactly that route.

The same rule forbids nested impersonation, because the impersonate route is an administration
route.

### Durable-artefact hardening

**A route that issues a credential or creates a durable grant rejects an impersonated
session**, returning `impersonation-not-permitted`.

Without this rule, read-write capability defeats the window that bounds it. A workspace member
can mint a runner registration token whose TTL parameter is optional. Omitting the TTL produces
a credential that never expires, returned in the response body and recorded against no actor. A workspace member can also create an invitation for any address, redeemable for
days. An operator could mint permanent, unattributed workspace access inside a 15-minute
audited window, stop impersonating, and use it later. Nothing in the audit trail would point at
it.

The deny-list covers runner registration tokens, provisioner tokens, and workspace
invitations. Its guard is the administration guard under a second name, exported from the same
package, so a route opts in with one line. Adding a credential-issuing or grant-creating route
later means adding it here.

This narrows read-write capability in an enumerated, documented way. It is not the per-route policy
scoping this record rejects below. The deny-list governs what a session can leave behind, not
what it can see or do.

### An idempotent, audited command

The mint command follows the ADR 0008 idempotent-command recipe with documented deviations,
because it issues a credential rather than mutating domain state.

**The bearer token is never persisted.** The stored command result contains only non-secret
data: `{target_user_id, expires_at, token_fingerprints}`, where each fingerprint is the
SHA-256 of a token issued under that key. Hashing the token itself, rather than an internal
identifier, is what makes the record useful. Hash a token recovered from a log, a proxy capture,
or a support ticket. The match names the command that minted it, its actor, and its reason. The field is a list because a replay issues a token with different signature bytes;
appending keeps every issued token traceable to one command. The result never stores the signed
bearer token, a claims snapshot, or refresh material.

**A replay re-runs the authorization and eligibility ladder.** A replay with the same key
before `expires_at` re-runs rules 1 through 6. It then re-signs a token for the same target,
keeping the original `expires_at`, appends the new fingerprint, and publishes its own audit
event. It cannot extend the window. Re-running the checks is deliberate: a replay hands back a usable
bearer token, so it is an issuance, not a read. A check-free replay would skip a disabled flag, a
revoked operator grant, and a suspended target for the remainder of the window. That would make
`AUTH_IMPERSONATION_ENABLED` a kill switch in name only, at exactly the moment someone reaches
for it. The accepted cost is that a replay can fail where the original
succeeded. The client treats that as any other terminal failure and issues a fresh command.

A replay after `expires_at` returns the known failure `impersonation-expired`. Reusing the key
for a different command returns `idempotency-key-reused`, unchanged.

**Audit commit semantics deviate from the recipe in two ways.** Every initial mint, replay, and
renewal publishes one `administration.action.performed` event. It carries the command
`auth.user.impersonate`, the target user, the actor and their role, the required role, the
reason, and the idempotency-key fingerprint. The shared event schema remains strict and has no
`expires_at` field. Auditors join the event's idempotency-key fingerprint to the stored command
result, where `expires_at` is canonical and never derived from current configuration.

- Success and replay events commit atomically with the command result. The recipe returns a
  stored result before it reaches the audit write, which would make a replay silent. That is
  correct for a command that changes a row and wrong for one that hands out a token.
- Failure events commit in a separate transaction, after the rollback. A denied command rolls
  its transaction back, and the role check runs before the transaction opens, so a failure
  event written inside it would not survive. Without this, probing for eligible targets would
  leave no trace on the route where failed attempts matter most.

Stop is client-local, so no event records Stop or the last request made with the token.

Authenticated request logging carries `impersonatorId` when the context has it, so any action
taken during impersonation is attributable through the correlation ID. Domain outbox events
produced during an impersonated session do not carry the impersonator in v1; this is an
accepted, documented limitation.

### Transparency

v1 publishes internal audit events only. The target user is not notified. User-facing
notification and consent flows are named future work, so the accountability this record
provides is internal, not user-visible.

The in-app banner is the operator's own always-visible mark. It shows the target's identity, a
countdown to expiry, an Extend action, and a Stop action. Stop must never call the logout
route, because logout operates on the administrator's refresh cookie.

Stop is terminal for the current browser tab. The client marks the adopted session terminated
and increments its adoption generation before clearing the token. A mint or renewal response
may be adopted only when its generation matches the current active generation. A response that
arrives after Stop is ignored, so an in-flight Extend cannot silently restore the impersonated
session.

### Supersession

**This record supersedes the "User impersonation" non-goal in the private instance
administration dashboard specification (2026-07-27), by reference.** ADR 0008 itself is not
edited; it continues to govern the role model, idempotency, audit, and suspension semantics that
this capability builds on.

## Consequences

- An impersonated session cannot outlive its 15-minute window and cannot be refreshed. The
  administrator's refresh cookie remains the only durable credential, so exit and expiry
  always restore the administrator's own session.
- The window is a real bound, because the deny-list stops the session from creating a
  credential or a grant that survives it.
- No privilege escalation exists: no path impersonates an administrator, and no impersonated
  session can exercise administrator authority on any `/admin` route.
- Every mint, replay, and renewal is an audited, idempotent, rate-limited command with a
  mandatory reason, and denied attempts are audited too.
- The capability stays upstream. The source-available distribution gains generic seams only;
  all impersonation UI ships from Cloud packages. It also ships disabled by default.
- Suspension semantics compose with the ADR 0008 model: suspending the target blocks renewal
  and blocks replay, but does not kill an already-issued token; revoking the target's sessions
  does not affect the impersonated token; revoking the administrator's grant blocks both
  renewal and replay.
- Three packages gain a dependency on the marked-session contract in
  `@shipfox/api-auth-context`: projects, workspaces, and runners each adopt the guards in
  their own route files.
- This record gates the implementation sequence: claim plumbing, administration hardening, the
  durable-artefact deny-list, the mint command and route, the client-shell seams, and the Cloud
  surface.

## Rejected alternatives

### Read-only or restricted impersonation

**A restricted mode cannot reproduce user-reported problems faithfully.** Per-route or
per-permission scoping adds policy surface without a product need. Read-write is bounded by
the short window, the durable-artefact deny-list, explicit audited renewal, the operator role
bar, and mandatory reasons.

### A refresh session or durable impersonation record

**A refresh session or a durable impersonation-session table would let the session outlive
its window.** It would also require a server-side stop command, an "active impersonations"
view, and revocation surface. The access-token-only model has no persisted state to revoke,
so exit and expiry are always safe by default.

### Impersonating administrators or a hidden staff bypass

**Allowing administrator targets would let an operator obtain owner authority.** A hidden
bypass would violate the "never create a hidden Cloud staff bypass" principle behind ADR 0008.
The capability is explicit, role-gated, reason-carrying, and audited.

### Enumerating administration modules instead of matching the route prefix

**A per-module list of hardened administration routes goes stale silently.** The first draft of
this list omitted one of the seven upstream `/admin` route groups. It would also have omitted
the bootstrap route, on the grounds that it checks no roles. A positional rule covers both, and
covers whatever administration surface lands next.

### Storing the minted token or a claims snapshot in the idempotency result

**Storing the token would write session material to the database.** Storing a claims snapshot
instead would be worse in a different way. A replay re-signs, so the stored row becomes input
to credential minting. Any database-write primitive would then turn into token forgery without
needing the signing key. Re-deriving the target and memberships on replay avoids both, and it
is what lets a replay re-run the eligibility rules at all.

### A check-free replay

**A replay that skips the authorization ladder is an unauthorized issuance.** It would keep
minting valid sessions after the flag was turned off, after the operator's grant was revoked,
and after the target was suspended. Bounding that by the original expiry is not enough: the
kill switch has to work when someone pulls it.

### Attribution instead of a durable-artefact deny-list

**Attribution alone does not restore the bound.** Stamping actor and impersonation marks on
credentials and grants created during an impersonated session would tell auditors who did it.
The permanent artefact would still exist, so "nothing needs revoking" would still be false. Attribution is worth having and is named future work; refusal is what v1 needs, and the
artefact records carry no creator today.

### A client seam-version gate on the mint route

**A capability advertised by the caller does not gate the caller.** Requiring clients to
declare a banner-capable seam version was considered as a way to prevent unmarked sessions in
a mixed-version deployment. The only caller is the administrator, who can advertise anything.
The flag default, the signed claim, and the audit trail are the controls. Client version skew
is a compatibility concern, not a safety property, and conflating the two would overstate the
guarantee.

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
