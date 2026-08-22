# Shipfox API Auth

Shipfox API Auth provides the server-side auth module for Shipfox APIs. This
package owns user accounts, email verification, login, refresh sessions,
password reset, password change, JWT auth, and its PostgreSQL tables.

For repository-wide backend module, configuration, error, and observability
rules, read the [backend architecture guide](../../../docs/architecture/backend-architecture.md).
This README owns the local security model, package API, routes, data model, and
auth-specific operational constraints.

## Example

Register the module with the API module runner:

```ts
import {createAuthModule} from '@shipfox/api-auth';
import {workspacesModule} from '@shipfox/api-workspaces';
import {workspacesInterModuleContract} from '@shipfox/api-workspaces-dto/inter-module';
import {createApp, listen} from '@shipfox/node-fastify';
import {
  initializeModules,
  registerInterModulePresentations,
} from '@shipfox/node-module';
import {createInMemoryInterModuleTransport} from '@shipfox/node-module/inter-module';

const interModuleTransport = createInMemoryInterModuleTransport();
const workspaces = interModuleTransport.createClient(workspacesInterModuleContract);
const modules = [workspacesModule, createAuthModule({workspaces})];
registerInterModulePresentations({transport: interModuleTransport, modules});
interModuleTransport.seal();
const {auth, routes} = await initializeModules({
  modules,
});

await createApp({auth, routes});
await listen();
```

This adds:

- auth database migrations from `libs/api/auth/drizzle`
- the JWT auth method used by protected routes
- routes under `/auth`

## Setup

Install the package from the registry:

```sh
pnpm add @shipfox/api-auth
```

Required environment:

| Variable | Default | Purpose |
| --- | --- | --- |
| `AUTH_ROOT_KEY` | none | Canonical base64 for 32 random bytes used to derive separate authentication and email-challenge keys. Generate it with `openssl rand -base64 32`. |
| `AUTH_JWT_EXPIRES_IN` | `15m` | Access token lifetime. |
| `AUTH_JOB_LEASE_TOKEN_EXPIRES_IN` | `90m` | Job lease token lifetime. |
| `AUTH_RUNNER_SESSION_TOKEN_EXPIRES_IN` | `1h` | Runner session token lifetime. |
| `AUTH_REFRESH_TOKEN_EXPIRES_IN_DAYS` | `14` | Refresh token and cookie lifetime. |
| `AUTH_REFRESH_ROTATION_GRACE_SECONDS` | `30` | Grace window for accepting a recently rotated refresh token during concurrent refreshes. |
| `AUTH_REFRESH_COOKIE_NAME` | `shipfox_refresh_token` | HTTP cookie name for refresh sessions. |
| `AUTH_PASSWORD_ENABLED` | `true` | Enables password and email-verification routes. Set to `false` when another module provides login. Server construction fails if no login method is available. |
| `AUTH_SIGNUP_GATE_ENABLED` | `false` | Restricts new account creation to the configured signup email allowlist. Requires `AUTH_SIGNUP_ALLOWED_EMAIL_DOMAINS` or `AUTH_SIGNUP_ALLOWED_EMAILS` to be set. |
| `AUTH_SIGNUP_ALLOWED_EMAIL_DOMAINS` | none | Comma-separated email domains allowed to create accounts, such as `shipfox.io,acme.com`. |
| `AUTH_SIGNUP_ALLOWED_EMAILS` | none | Comma-separated exact email addresses allowed to create accounts. |
| `AUTH_SIGNUP_NOT_ALLOWED_MESSAGE` | none | Markdown message returned when the signup gate blocks an account. Defaults to "This Shipfox deployment does not accept new accounts right now." |
| `CLIENT_BASE_URL` | `http://localhost:5173` | Base URL used in email verification and password reset links. |
| `ADMIN_BOOTSTRAP_TOKEN` | none | Deployment secret accepted once to create the first administrator owner. Set it before bootstrap and remove or rotate it after successful bootstrap. |

The recommended access-token lifetime is 15 minutes. Because user JWTs are
verified from their claims, a token issued before logout, password changes,
session revocation, or workspace suspension remains usable until its configured
`exp` time. Logout and session revocation block refresh-session renewal, while
password changes revoke other refresh sessions and retain the current session
when its refresh cookie is valid. Workspace suspension is carried into the next
status-aware snapshot, where the stateless workspace gate rejects member access;
none of these actions retroactively invalidate an issued access token. Newly
issued and refreshed tokens carry workspace lifecycle status so the gate can
return the stable suspended or inactive access result.

Email delivery uses the shared `@shipfox/node-mailer` configuration.

The signup gate is off by default. When it is on, provide at least one non-empty
entry in `AUTH_SIGNUP_ALLOWED_EMAIL_DOMAINS` or `AUTH_SIGNUP_ALLOWED_EMAILS`.
Startup fails when both lists are empty. Values are trimmed and lowercased.
The policy matches exact email addresses or exact domains. It does not match
subdomains or wildcards. `createAuthModule` applies these settings by default;
pass a `signupPolicy` to replace the environment-backed policy.

The Shipfox client renders `AUTH_SIGNUP_NOT_ALLOWED_MESSAGE` as sanitized
Markdown. The signup response limits the message to 500 characters. Use an
absolute HTTP or HTTPS URL for a link:

```sh
AUTH_SIGNUP_NOT_ALLOWED_MESSAGE='New accounts require approval. [Request access](https://example.com/access).'
```

When `AUTH_PASSWORD_ENABLED=false`, the module does not register signup, login, password-reset, password-change, or email-verification routes. Refresh, logout, and current-session routes stay available. Another module must contribute a login method before the API server starts.

## Security model

The module issues three kinds of bearer token, all presented as
`Authorization: Bearer <token>`. All are **stateless**: each is signed with
HMAC-SHA256 and verified by checking its signature and expiry alone, with no
database read on the request path. They differ in who they authenticate and what
they grant, and the stateless tradeoff is accepted for a different reason in each
case. Each token class uses a separate key derived from `AUTH_ROOT_KEY` and a
fixed audience, so one token type cannot be used in place of another.

Changing `AUTH_ROOT_KEY` invalidates every user session token, runner session
token, job lease token, email challenge, and rate-limit identifier created with
the previous root. The module does not support rotating one derived key by
itself.

### User session token

- **Design:** a stateless session token. It carries the user's identity and
  workspace membership list, including each workspace's lifecycle status, in
  its claims so protected routes can authorize without a per-request user or
  membership lookup.
- **Audience:** signed-in users on first-party clients (web app, CLI).
- **Grants:** the user's own account routes and, downstream, any route that
  authorizes against the membership claims. Its scope is "this user, with these
  memberships", never a single resource.
- **Lifecycle:**
  - *Emit*: issued on login, signup verification, and password reset.
  - *Exchange*: sent on each request; a longer-lived refresh session mints a
    fresh token when it expires.
  - *Store*: held in client memory only, never persisted to disk or local
    storage. Refresh sessions are stored server-side as hashes, never in raw form.
  - *Discard*: expires at the configured `exp` time. Revoking the refresh
    session blocks renewal but does not invalidate the issued access token.
- **Tradeoff: stale memberships:** because memberships ride in the claims, a
  membership or workspace-status change only takes effect on the next token
  issuance or refresh. Accepted because the recommended lifetime is 15 minutes,
  so the staleness window is bounded and a per-request membership read is avoided.

### Runner session token

A runner session token is the data-plane identity for a running manual runner.
The runner exchanges its long-lived registration token at startup, then uses the
short-lived session token to claim jobs. Heartbeat and step/report/log operations
use the per-job lease token instead.

- **Scope: one workspace's runner data plane.** The token names one runner
  session, one workspace, the fixed `workspace` scope, and the session's immutable
  label set. It can claim jobs for that workspace. It is not a user identity and
  does not authorize dashboard management routes.
- **Labels are self-attested.** A holder of a valid registration token chooses
  the labels it registers with. The labels are immutable after registration and
  signed into the session token, but they are not an authorization boundary in v1.
  Treat the registration token's workspace scope as the trust boundary.
- **Mechanics.** Signed with HMAC-SHA256 using the derived runner-session key
  and the `runner-session` audience. The default lifetime is `1h`, short enough
  to bound the residual claim window when a registration token is revoked.
- **Tradeoff: no per-session revocation in v1.** Claim stays stateless and does
  not check the runner session row on each poll. Revoking the registration token
  blocks new sessions, but an existing session can keep claiming until
  `AUTH_RUNNER_SESSION_TOKEN_EXPIRES_IN` elapses. A job execution claimed before
  session expiry then moves to the narrower job lease token path: heartbeat can
  renew that lease while server state still says the job execution is live, and
  cancellation or terminal job execution state is the revocation boundary for that
  already-claimed work.

### Job lease token

A single-job **capability** token, not a session. It is the means by which a
runner proves it is the legitimate holder of one specific job while it reports
progress and drives that job to completion.

- **Scope: exactly one job execution.** The token authorizes action on the
  single job execution it names, for the runner holding it. It is **not** a runner
  identity, it is **not** workspace-wide, and it is **not** a substitute for the
  long-lived runner credential used to claim work in the first place. The
  surrounding identifiers it carries (job, run, workspace, the claiming runner)
  are context for consumers; they do not widen what the bearer may touch. When a
  step is dispatched, the token may also carry the current step id and attempt so
  log append can verify signed membership in that one step attempt without
  querying workflow state.
- **Trust boundary.** There is exactly one issuer: the scheduling side mints a
  lease when a runner claims a job execution, next-step re-scopes it to the
  dispatched step attempt, and heartbeat re-mints the same narrow capability
  after server state accepts the heartbeat. Everything downstream only *verifies*
  the token with an in-process signature check. It makes no callback to the
  issuer. The runner, and the untrusted agent workload it hosts, never mints
  or modifies a token; it only presents the one it was handed.
- **Mechanics.** Signed with HMAC-SHA256 using the job-lease key derived from
  `AUTH_ROOT_KEY`. Its claims name the job, job execution, and surrounding
  context and nothing more, and it carries a fixed audience so a token minted for
  one purpose cannot be replayed against another. It is short-lived (bounded in
  hours, not days), with heartbeat issuing a fresh short lease for the same live
  execution. The root key is supplied through configuration, never embedded in
  code or committed. The raw token must **never** be written to logs, traces, or
  error payloads. There is no automatic redaction to fall back on.
- **Defense in depth: server state is the final authority.** A valid token is
  never sufficient on its own to advance work. On the lease's own request path the
  gate is server-side step and progression state: a report against a step that has
  already reached a terminal state (finished, failed, or cancelled) is ignored, so
  a still-valid token cannot re-drive work that is already done. Job-level
  finalization is enforced outside the lease path. Cancellation flows the other way
  as well: the server can ask the runner to stop at any point, and that request
  rides on the response to each heartbeat rather than depending on the token.
- **Log append scope.** A step-scoped lease is a signed membership and attempt
  check for append-log authorization. It is not an active-step proof: until the
  runner adopts a later step-scoped token or the lease expires, the bearer can
  append to that step attempt's log stream. This is no broader than the job-scoped
  append authority it replaces, and step completion remains governed by
  server-side report/progression state.
- **Threat model.** A leaked or replayed token has a deliberately small blast
  radius: it grants action on one already-claimed job execution while that
  execution remains live. It cannot claim new work, impersonate a runner, or reach
  other workspaces. If `AUTH_ROOT_KEY` leaks, rotate it. This invalidates every
  live token and email challenge derived from the old root, including every live
  lease, and forces fresh claims.
- **Tradeoff: no per-token revocation.** A single outstanding lease cannot be
  revoked on its own by token ID. The claiming runner's credential is not
  re-checked on each request, so a lease for already-claimed work can continue to
  be renewed by heartbeat until server state cancels, completes, times out, or
  otherwise terminates the job execution. Accepted because access is bounded in
  scope (one execution) and server state is checked on the hot path; a
  per-request credential lookup would sit on the hot progress-reporting path.
- **Guidelines for future changes.** Keep the authority narrow: do not add claims
  that grant access beyond the single job, keep the lifetime bounded, keep a single
  issuer, and keep every other side verify-only. If the no-revocation window ever
  proves too wide, the right fix is to bind the lease to live runner or job state,
  not to broaden what the token itself can authorize.

## Routes

All routes are mounted under `/auth`.

| Method | Path | Auth | Result |
| --- | --- | --- | --- |
| `POST` | `/signup` | none | Creates a user and sends an eight-digit email verification code. A denied new signup returns `403` with error code `signup-not-allowed` and the policy message. |
| `POST` | `/verify-email/confirm` | none | Confirms a verification code, returns an access token, and sets the refresh cookie. |
| `POST` | `/verify-email/resend` | none | Sends a new verification code when the account is eligible. |
| `POST` | `/login` | none | Returns an access token and sets the refresh cookie. |
| `POST` | `/refresh` | refresh cookie | Rotates the refresh token when needed and returns a new access token. |
| `POST` | `/logout` | refresh cookie | Revokes the current refresh token and clears the cookie. |
| `GET` | `/me` | bearer token | Returns the signed-in user. |
| `POST` | `/change-password` | bearer token | Changes the password and revokes other refresh sessions. |
| `POST` | `/password-reset` | none | Sends a password reset email when the account is eligible. |
| `POST` | `/password-reset/confirm` | none | Sets a new password, returns an access token, and sets the refresh cookie. |

Protected routes use the `Authorization: Bearer <token>` header. The refresh flow uses an HTTP-only cookie on the `/auth` path.

When password login is disabled, the password and email-verification rows in this table return `404`. Refresh, logout, and `me` remain registered.

> [!IMPORTANT]
> Refresh cookies are set with `secure: true`, `httpOnly: true`, and `sameSite: "lax"`. Local browser tests need HTTPS or a test path that handles secure cookies.

### Administrator grants

`GET /admin/auth/bootstrap-state` requires an authenticated bearer token and returns exactly `{state: 'available' | 'closed'}`. It reports `available` only while no active `admin-owner` exists and never reports deployment-token configuration.

Bootstrap and grant-management routes are mounted under `/admin/auth/admin-grants` and require an authenticated bearer token. Administrator role checks are enforced in the core layer, not by route-level middleware.

| Method | Path | Required role | Result |
| --- | --- | --- | --- |
| `POST` | `/bootstrap` | none (deployment token) | Claims the `admin-owner` role for the calling user using `ADMIN_BOOTSTRAP_TOKEN`. Fails with `409 bootstrap-closed` once an active owner exists. |
| `GET` | `/` | `admin-observer` | Lists bounded local administrator grant summaries with embedded safe user identities. |
| `POST` | `/` | `admin-owner` | Grants a role to an active user. |
| `DELETE` | `/:grantId` | `admin-owner` | Revokes a grant. Fails with `409 last-owner` when it would remove the final active owner. |

`POST` and `DELETE` routes require an `Idempotency-Key` header; a repeated key replays the same result, and reusing a key with a different command returns `409 idempotency-key-reused`. Every mutation writes a redacted `administration.action.performed` outbox event.

Bootstrap remains closed only while an active `admin-owner` exists. An owner is active when its grant is not revoked and its user account has `active` status. A suspended owner does not count as active, so suspending the sole owner intentionally reopens deployment-token bootstrap for recovery. The suspended grant remains stored; reactivating that user closes bootstrap again.

### Rate limiting

The public auth endpoints include an application-layer abuse baseline for open source installs:

| Route | IP bucket | Email bucket |
| --- | --- | --- |
| `POST /auth/login` | 60 attempts per 5 minutes | 10 attempts per 15 minutes |
| `POST /auth/password-reset` | 30 email-send attempts per hour | 3 email-send attempts per hour |
| `POST /auth/verify-email/resend` | Shared with password reset | Shared with password reset |
| `POST /admin/auth/admin-grants/bootstrap` | 5 attempts per 15 minutes | n/a |
| `GET /admin/auth/users` | 60 attempts per 5 minutes | n/a |

Counters are stored in PostgreSQL as fixed windows in `auth_rate_limits`. IP addresses and email addresses are HMAC-SHA256 values before storage; raw identifiers are not persisted. The identifier key is derived from `AUTH_ROOT_KEY` separately from every token key.

The limiter uses `request.ip`, so production deployments behind a reverse proxy must configure the API app's `API_TRUST_PROXY` setting. Keep the default `false` when clients connect directly. Use a positive hop count such as `1`, or a trusted proxy IP/CIDR such as `10.0.0.0/8`, when proxy headers are controlled by infrastructure you operate.

This app-layer limiter protects semantic auth work such as Argon2 verification and email sending. It is not a volumetric DDoS control. Public production deployments should still use load balancer, CDN, WAF, or firewall rate limits at the network edge.

### Administrator user reads

`GET /admin/auth/users` requires `admin-observer` and accepts exactly one checked query filter: `id`, `user_id`, or normalized `email`. The response is a bounded `AdministratorUserSummary` containing only the stable user identity, verified-email timestamp, display name, account status, creation timestamp, and current administrator role.

`GET /admin/auth/admin-grants` also requires `admin-observer`. It returns at most 100 newest-first `AdministratorGrantSummary` rows per page, with an opaque cursor and a safe embedded user identity. It does not return credentials, sessions, provider payloads, OAuth tokens, refresh tokens, or raw authentication metadata.

### Administrator user moderation

All routes are mounted under `/admin/auth/users` and require an authenticated bearer token.

| Method | Path | Required role | Result |
| --- | --- | --- | --- |
| `POST` | `/:userId/suspend` | `admin-operator` | Suspends the user, revokes all refresh sessions, and returns the final safe user summary with a correlation ID. Issued access tokens remain valid until `exp`. |
| `POST` | `/:userId/reactivate` | `admin-operator` | Restores sign-in eligibility without restoring revoked sessions. |
| `POST` | `/:userId/revoke-sessions` | `admin-operator` | Revokes all refresh sessions without changing account status and returns the number of affected sessions. Issued access tokens remain valid until `exp`. |

Each command requires an `Idempotency-Key`. Suspension requires a bounded reason; reactivation and session revocation accept an optional bounded reason. Repeating a successful command returns its committed result. Reusing a key for a different command or request returns `409 idempotency-key-reused`.

Suspension preserves the user record and rejects the final active administrator owner. State, the command result, and one redacted `administration.action.performed` outbox event commit atomically. The event stores only the idempotency-key fingerprint, never the raw key or session material.

## API

The package exports a module factory. Pass it the Workspaces inter-module client from the
application composition:

```ts
import {createAuthModule} from '@shipfox/api-auth';

const authModule = createAuthModule({
  workspaces,
});
```

It also exports lower-level pieces for tests and advanced integration:

- `routes`: the `/auth` route group.
- `db` and `migrationsPath`: the Drizzle database handle and migration path.
- `createJwtAuthMethod()`: the Fastify auth method for user JWTs.
- `createRunnerSessionAuthMethod()`: the Fastify auth method for runner session tokens.
- `createLeaseTokenAuthMethod()`: the Fastify auth method for job lease tokens.
- `issueRunnerSessionToken(claims)` / `verifyRunnerSessionToken(token)`: mint and verify runner session tokens.
- `issueJobLeaseToken(claims)` / `verifyJobLeaseToken(token)`: mint and verify job lease tokens.
- `createEnvironmentSignupPolicy()`: creates the environment-backed signup policy used by default. Pass `signupPolicy` to `createAuthModule` to replace it.
- `getClientContext(request)`: reads the authenticated user context from a Fastify request.
- `getAuthenticatedSessionContext(request)`: reads the user ID and required refresh-session ID from verified access-token claims. It does not check whether the refresh session is still active.
- `findUserByEmail({email})`: read-only lookup of the current owner of a normalized email; see below.
- Entity types: `User`, `UserStatus`, `RefreshToken`, `PasswordReset`, and `EmailOwner`.

### External identity callbacks

An external identity route can use these APIs to provision a user. It can then
create a normal Shipfox session and set its refresh cookie:

```ts
import {
  authCookiePlugin,
  createSessionForUser,
  provisionUser,
  setRefreshTokenCookie,
} from '@shipfox/api-auth';
import type {FastifyReply} from 'fastify';

export const callbackRoutePlugins = [authCookiePlugin];

export async function completeProviderCallback(
  reply: FastifyReply,
  profile: {email: string; name?: string},
): Promise<string> {
  const user = await provisionUser(profile);
  const session = await createSessionForUser({userId: user.id});

  setRefreshTokenCookie(reply, session.refreshToken);
  return session.token;
}
```

The provider must prove it owns `profile.email` before calling `provisionUser`.
For OAuth providers, require a verified-email claim such as `email_verified`.
`provisionUser` matches existing emails, and `createSessionForUser` can mint a
session for any active, verified account. An unverified provider email could
otherwise sign in as an existing password account with the same address.

`provisionUser` uses the environment-backed signup policy by default. Pass an
explicit `signupPolicy` only when the integration owns a replacement policy,
such as Cloud's database-backed policy. The function checks for an existing
user before it calls the policy, so existing users keep signing in even when
their address is no longer allowed. For a new user, a denied policy throws
`SignupNotAllowedError`. Call `createSessionForUser` only after provisioning
succeeds.

Add `authCookiePlugin` to the callback route group before calling a cookie
helper. `getRefreshTokenCookie`, `setRefreshTokenCookie`, and
`clearRefreshTokenCookie` use the configured cookie name and the `/auth` path.

`provisionUser({email, name?})` uses the same email schema as the auth routes.
It makes an active, verified user with no password hash. If the email already
exists, it returns that user unchanged. It does not change the name, email,
status, verification state, or password. Repeated and concurrent callbacks are
safe.

This pre-verified user state lets an external login method create a session when password login and email-verification routes are disabled.

### Email ownership lookup

`findUserByEmail({email})` answers "who currently owns this email?" without
creating a session or changing that user:

```ts
import {findUserByEmail} from '@shipfox/api-auth';

const owner = await findUserByEmail({email: rawEmail});
if (owner) {
  // owner: {id, email, status}
}
```

It parses `rawEmail` through the same shared `emailSchema` used by every other
auth entry point, so whitespace and casing differences resolve to the same
owner. It returns an owner for every account status (`active`, `suspended`, or
`deleted`), and `undefined` when no user owns the address. The returned
`EmailOwner` is an explicit projection of `id`, `email`, and `status` only; it
never carries a password hash, profile fields, or verification timestamps.
This seam performs no writes, so it is safe to call before deciding whether to
provision, link, or reject an identity.

`createSessionForUser` accepts either a `userId` or an `email`. It only creates
a session for an active, verified user. It can throw `UserNotFoundError`,
`EmailNotVerifiedError`, `InvalidCredentialsError`, or
`AuthDependencyUnavailableError`. `CreateSessionForUserParams`,
`CreateSessionForUserResult`, and `CreateSessionForUserError` describe that
public contract.

`createJwtAuthMethod`, `createRunnerSessionAuthMethod`, and
`createLeaseTokenAuthMethod` make request-auth methods. They do not add a
user-facing login method.

### Authenticated session context

`getAuthenticatedSessionContext(request)` returns the stable refresh-session
identity behind an authenticated user request:

```ts
import {getAuthenticatedSessionContext} from '@shipfox/api-auth';

const session = await getAuthenticatedSessionContext(request);
// {userId, refreshSessionId}
```

The refresh-session ID remains the same when its refresh token rotates. The
helper does not query the refresh-session table. It returns the standard `401
unauthorized` error when the verified request context is missing, inconsistent,
or has no refresh-session ID. It exposes neither refresh-token material nor
storage details.

## Data model

The module creates tables with the `auth_` prefix:

- `auth_users`
- `auth_refresh_tokens`
- `auth_password_resets`
- `auth_rate_limits`
- `auth_admin_grants`
- `auth_admin_command_results`

Passwords use Argon2id. Password reset tokens and refresh tokens are opaque tokens stored as hashes. Email verification uses the shared email-challenges module.

## Behavior notes

- Signup sends an eight-digit verification code and returns the new user with its challenge ID.
- Signup gating blocks account creation only. Existing users keep signing in, even when their address is not on the current allowlist.
- A denied password signup returns `403` with error code `signup-not-allowed`. The policy message is capped at 500 characters.
- Invitation signup validates the invitation and bypasses the signup policy. Invitations remain a separate authorization path.
- Login only succeeds for active users with verified email addresses and a password hash.
- Login and refresh reject suspended or deleted users. Current-state reads such
  as `/auth/me` still return the persisted suspended-user status. Ordinary JWT
  verification does not query user or refresh-session rows.
- Revoking a refresh session blocks renewal. An already-issued access token
  remains valid until its configured `exp` time.
- Refresh tokens rotate on each refresh.
- Password reset tokens and email challenge proofs are consumed once.
- Password change revokes other refresh sessions. It keeps the current session when the current refresh cookie is valid.
- Password reset requests and verification resend requests do not reveal whether an account exists.
- Login, password reset, and verification resend requests are rate-limited by IP address and email address.

## Development

Run checks for this package:

```sh
turbo check --filter=@shipfox/api-auth
turbo type --filter=@shipfox/api-auth
turbo test --filter=@shipfox/api-auth
```

For repository test conventions, read the [testing guide](../../../docs/guides/testing.md).
This package uses the `api_test` database and sets fake auth secrets in `test/env.ts`.

## License

MIT
