# TODOs

## Projects

- [ ] **Production GitHub/GitLab provider setup design** — Design the production connection picker, repository search/list states, provider permissions, revoked/unavailable access handling, and `.shipfox` config status once real GitHub/GitLab providers and repository list/search APIs exist.

- [ ] **Projects Playwright E2E** — Add browser coverage for Projects hub -> create -> detail once the client/API E2E harness exists.

## Integrations

- [ ] **GitHub lifecycle webhook handling** — Add GitHub App webhook verification and handlers for installation suspend/delete and repository access changes. The backend currently stores `latest_event`, `suspended_at`, and `deleted_at` on `integrations_github_installations`, but the first GitHub provider PR only updates those fields during callback. Webhook ingestion should keep connection lifecycle state accurate when GitHub changes app access after installation.

## Add cursor-based pagination to list endpoints

**What:** Add cursor-based pagination to `listWorkflowRunsByProject`, `listDefinitionsByProject`, and future list queries.

**Why:** All list endpoints currently return unbounded result sets. As runs accumulate, these queries will degrade. Pagination is a prerequisite for production use.

**Pros:** Prevents slow queries and OOM at scale. Standard API ergonomics.

**Cons:** Adds complexity to every list query and route. Needs a shared pagination helper to avoid DRY violations across modules.

**Context:** Both the definitions and workflows modules have list endpoints that return all rows matching a project. The right approach is cursor-based (keyset) pagination using `created_at` + `id` as the cursor, not offset-based. Consider building a shared `paginatedQuery` helper in `@shipfox/node-drizzle` or `@shipfox/node-fastify` to standardize the pattern across modules.

**Depends on:** Nothing. Can be done as a standalone PR.

## Add job execution timeout + stuck runner detection

**What:** Add a timeout to the `condition()` call in `jobOrchestration`, and a periodic Temporal cron that finds stale `runners_running_jobs` rows (last_heartbeat_at > N minutes ago) and fails them.

**Why:** If a runner claims a job and disappears, the `jobOrchestration` workflow parks on its signal forever. The run never completes. Silent failure in production.

**Pros:** Prevents infinite hangs, enables self-healing.

**Cons:** Needs heartbeat protocol design, adds complexity to runner protocol.

**Context:** The `condition()` in `jobOrchestration` accepts an optional timeout parameter. A 30-minute default timeout that fails the job with `runner_timeout` would be a minimal first pass. The stuck job detection cron is a Temporal workflow that queries `runners_running_jobs WHERE last_heartbeat_at < NOW() - interval '10 minutes'`.

**Depends on:** Runner heartbeat protocol (`POST /runners/jobs/:id/heartbeat` endpoint).

## Add runner authentication

**What:** Add authentication to runner protocol endpoints (`POST /runners/jobs/request` and `POST /runners/jobs/:id/complete`).

**Why:** Runner protocol is a public API surface. Without auth, anyone can claim and complete jobs. Required before any non-local deployment.

**Pros:** Security baseline for runner protocol.

**Cons:** Requires runner registration flow, token management.

**Context:** The system design spec describes a `POST /api/runners/register` endpoint that issues `RunnerCredentials` via a registration token. Runner protocol endpoints should validate these credentials. For production, consider runner-scoped tokens with workspace and capability restrictions.

**Depends on:** Nothing. Can be built independently.

## Add per-step status reporting to runner protocol

**What:** Extend the runner completion protocol to report per-step results instead of a single job-level status. Update `CompleteJobBodyDto` to accept an array of `{ stepId, status, output }` alongside the job status. Update `jobOrchestration` to use per-step statuses instead of `bulkSetStepStatuses`.

**Why:** Currently, the runner knows which steps succeeded and which failed (fail-fast execution), but the protocol only sends a single `{status, output}` for the entire job. The backend's `bulkSetStepStatuses` marks ALL steps with the same terminal status. If step 2 of 5 fails, steps 3-5 show as "failed" even though they were never executed. This makes debugging harder and the UI misleading.

**Pros:** Accurate per-step status in the UI. Steps that were never executed show as "cancelled" or "skipped" instead of "failed." Step-level output for debugging.

**Cons:** Protocol change requires coordinated runner + backend update. Adds complexity to the completion flow.

**Context:** The runner's executor already tracks per-step results internally. The change is mostly about widening the protocol to carry that data through. The `output` field in `CompleteJobBodyDto` is `z.unknown()` so a structured object could be sent today, but the backend ignores step-level detail. Both the DTO schema and the `jobOrchestration` signal handler need updates.

**Depends on:** Runner POC (needs a working runner to iterate on the protocol).

## Workspaces

- [ ] **Rate limiting on auth endpoints** — `POST /auth/login`, `POST /auth/password-reset`, `POST /auth/verify-email/resend` are abuse surfaces. Login is CPU-expensive (argon2id verify, ~50–200ms each) and unbounded credential-stuffing pegs a CPU. Verify-email/resend and password-reset can be used for free email bombardment of a known address. Build a shared per-IP-and-per-email rate-limit primitive (Redis token bucket or postgres counter) and wire it as Fastify hooks on the affected routes. Tracked here because it must precede any non-trivial public exposure.

- [ ] **Graceful JWT secret rotation** — Current model is "rotate = forced re-login": operator changes `WORKSPACE_JWT_SECRET`, restarts, all in-flight tokens fail verification. For zero-downtime rotation, support two simultaneous secrets in `createJwtAuthMethod` — sign with the new key, accept either for verify, retire the old after token TTL window. Schema: `WORKSPACE_JWT_SECRET` (active) + `WORKSPACE_JWT_SECRET_PREVIOUS` (verify-only). No DB schema change needed.

- [ ] **Client-side refresh single-flight** — The backend refresh-token model uses strict single-use rotation: once `/auth/refresh` succeeds, the old refresh cookie is invalid. Browser clients must coordinate refresh calls so multiple tabs/components do not send the same cookie concurrently and accidentally log the user out. Build a shared client auth primitive that keeps one in-flight refresh request per browser session and lets all callers await that same promise. This is intentionally deferred because this repo currently has no frontend client surface.

- [ ] **Project-scope authorization model** — Existing routes under `/api/projects/:projectId/...` (definitions, workflows, runners) are project-scoped, not workspace-scoped. `libs/api/workflows/src/presentation/routes/create-run.ts:31` falls back to using `projectId` as `workspaceId`, which is incorrect. Decide whether projects belong to a workspace (1:N) or whether projects have their own membership model, then make those routes JWT-authable for human users. Out of scope for the auth plan; this needs its own design pass.

- [ ] **OR-semantics for `createAuthHook`** — Today `createAuthHook(['api-key', 'jwt'])` runs both methods sequentially as AND. To let a single route accept either kind of caller (CLI with api-key, browser with JWT) we need a `tryEither` mode that succeeds on the first auth that passes. Lives in `libs/shared/node/fastify/src/auth.ts`. Defer until there's a real consumer (project-scope auth above is the likely first one).

- [ ] **Closed-source: roles on memberships** — OSS distribution of workspaces has no roles (every member has full access). Closed-source adds `role enum('owner','admin','member')` to `workspaces_memberships` via additive migration, plus role-gated routes (only owners can transfer ownership, only admins+owners can remove members, etc.). Schema and route changes are additive, no OSS breakage.

- [ ] **Full cross-site browser auth cookies** — The first client auth foundation supports cross-origin, same-site browser auth with `SameSite=Lax` refresh cookies. If the frontend and API ever live on unrelated sites, add explicit cookie policy config for `SameSite=None; Secure`, verify browser behavior in Playwright, and document the deployment constraints. This is intentionally deferred until that hosting shape is required.

- [ ] **Create client DESIGN.md** — The first client auth foundation uses `/Users/noe.charmet/code/platform/libs/shared/react/ui` as the temporary design source of truth. Once the client grows beyond auth, create a repo-local `DESIGN.md` that records typography, color tokens, spacing, component vocabulary, responsive rules, and accessibility expectations so future screens do not drift from the repatriated UI system.

## Outbox / Dispatcher

- [ ] **Outbox row retention** — Add periodic cleanup of dispatched outbox rows older than 7 days. Dispatched rows accumulate in each module's `{module}_outbox` table. At scale this bloats the table. Simple fix: periodic `DELETE FROM {module}_outbox WHERE dispatched_at < now() - interval '7 days'` in the dispatcher workflow or a separate Temporal cron. Consider archiving to a separate table first if audit trail is needed. Blocked on: outbox + dispatcher implementation.
