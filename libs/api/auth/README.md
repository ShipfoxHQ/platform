# Shipfox API Auth

Shipfox API Auth provides the server-side auth module for Shipfox APIs. It owns user accounts, email verification, login, refresh sessions, password reset, password change, JWT auth, and its PostgreSQL tables.

## Example

Register the module with the API module runner:

```ts
import {authModule} from '@shipfox/api-auth';
import {createApp, listen} from '@shipfox/node-fastify';
import {initializeModules} from '@shipfox/node-module';

const {auth, routes} = await initializeModules({
  modules: [authModule],
});

await createApp({auth, routes});
await listen();
```

This adds:

- auth database migrations from `libs/api/auth/drizzle`
- the JWT auth method used by protected routes
- routes under `/auth`

## Setup

This package is private to the workspace. Add it to another workspace package with:

```json
{
  "dependencies": {
    "@shipfox/api-auth": "workspace:*"
  }
}
```

Required environment:

| Variable | Default | Purpose |
| --- | --- | --- |
| `AUTH_JWT_SECRET` | none | Secret used to sign and verify access tokens. |
| `AUTH_JWT_EXPIRES_IN` | `15m` | Access token lifetime. |
| `AUTH_REFRESH_TOKEN_EXPIRES_IN_DAYS` | `14` | Refresh token and cookie lifetime. |
| `AUTH_REFRESH_COOKIE_NAME` | `shipfox_refresh_token` | HTTP cookie name for refresh sessions. |
| `CLIENT_BASE_URL` | `http://localhost:3000` | Base URL used in email verification and password reset links. |
| `MAILER_TRANSPORT` | `console` | Mail transport. Set to `smtp` to send real mail. |
| `MAILER_FROM` | `noreply@shipfox.local` | Sender used by auth emails. |
| `SMTP_HOST` | none | Required when `MAILER_TRANSPORT=smtp`. |
| `SMTP_PORT` | `587` | SMTP server port. |
| `SMTP_USER` | none | Optional SMTP user. |
| `SMTP_PASSWORD` | none | Optional SMTP password. |

## Routes

All routes are mounted under `/auth`.

| Method | Path | Auth | Result |
| --- | --- | --- | --- |
| `POST` | `/signup` | none | Creates a user and sends an email verification link. |
| `POST` | `/verify-email/confirm` | none | Verifies email, returns an access token, and sets the refresh cookie. |
| `POST` | `/verify-email/resend` | none | Sends a new verification email when the account is eligible. |
| `POST` | `/login` | none | Returns an access token and sets the refresh cookie. |
| `POST` | `/refresh` | refresh cookie | Rotates the refresh token and returns a new access token. |
| `POST` | `/logout` | refresh cookie | Revokes the current refresh token and clears the cookie. |
| `GET` | `/me` | bearer token | Returns the signed-in user. |
| `POST` | `/change-password` | bearer token | Changes the password and revokes other refresh sessions. |
| `POST` | `/password-reset` | none | Sends a password reset email when the account is eligible. |
| `POST` | `/password-reset/confirm` | none | Sets a new password, returns an access token, and sets the refresh cookie. |

Protected routes use the `Authorization: Bearer <token>` header. The refresh flow uses an HTTP-only cookie on the `/auth` path.

> [!IMPORTANT]
> Refresh cookies are set with `secure: true`, `httpOnly: true`, and `sameSite: "lax"`. Local browser tests need HTTPS or a test path that handles secure cookies.

## API

The package exports the module entry point:

```ts
import {authModule} from '@shipfox/api-auth';
```

It also exports lower-level pieces for tests and advanced integration:

- `routes`: the `/auth` route group.
- `db` and `migrationsPath`: the Drizzle database handle and migration path.
- `createJwtAuthMethod()`: the Fastify auth method for user JWTs.
- `getClientContext(request)`: reads the authenticated user context from a Fastify request.
- Entity types: `User`, `UserStatus`, `RefreshToken`, `EmailVerification`, and `PasswordReset`.

## Data Model

The module creates tables with the `auth_` prefix:

- `auth_users`
- `auth_refresh_tokens`
- `auth_email_verifications`
- `auth_password_resets`

Passwords use Argon2id. Email verification tokens, password reset tokens, and refresh tokens are opaque tokens stored as hashes.

## Behavior Notes

- Signup sends a verification email and returns the new user.
- Login only succeeds for active users with verified email addresses.
- Refresh tokens rotate on each refresh.
- Password reset and email verification consume their tokens once.
- Password change revokes other refresh sessions. It keeps the current session when the current refresh cookie is valid.
- Password reset requests and verification resend requests do not reveal whether an account exists.

## Development

Run checks for this package:

```sh
turbo check --filter=@shipfox/api-auth
turbo type --filter=@shipfox/api-auth
turbo test --filter=@shipfox/api-auth
```

Tests use Vitest and a real PostgreSQL database. Start local services before running the test suite:

```sh
docker compose up -d
```

The test environment uses the `api_test` database and sets fake auth secrets in `test/env.ts`.

## License

MIT
