# @shipfox/api-auth-dto

## 10.1.0

### Minor Changes

- fb34b6a: Expose authenticated administrator bootstrap availability through the Auth API.

## 10.0.0

### Minor Changes

- 6054364: Add bounded administrator user lookup and safe administrator-grant summaries while removing the unbounded grant reader.

### Patch Changes

- @shipfox/api-common-dto@9.2.0
- @shipfox/inter-module@0.2.2

## 9.3.0

### Minor Changes

- 10cf63c: Add first-owner bootstrap and administrator grant management routes.

## 9.2.0

### Minor Changes

- 456c884: Add Auth-owned local administrator grants and server-side role evaluation.

### Patch Changes

- Updated dependencies [36d8338]
  - @shipfox/api-common-dto@9.2.0

## 9.0.2

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.
- Updated dependencies [4b85404]
  - @shipfox/api-common-dto@9.0.2
  - @shipfox/inter-module@0.2.2

## 9.0.1

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.
- Updated dependencies [475ce59]
  - @shipfox/api-common-dto@9.0.1
  - @shipfox/inter-module@0.2.1

## 7.1.0

### Minor Changes

- 769d919: Adds an anonymous login-method catalog with a published bounded DTO contract.

## 6.0.0

### Major Changes

- ba2e3dc: Migrates password email verification from magic links to shared eight-digit email challenges.

### Minor Changes

- e6eba5b: Adds the auth user signed-up event contract for durable signup lifecycle integrations.
- 112c0fa: Adds the Auth inter-module token-minting contract and removes Auth implementation and configuration coupling from its consumers.

### Patch Changes

- 4a91956: Publishes a shared provider-neutral `emailSchema` in `@shipfox/api-common-dto` and adopts it across auth and workspace invitation inputs. Adds a read-only `findUserByEmail`/`EmailOwner` seam to `@shipfox/api-auth` for looking up the current owner of a normalized email without creating a session or mutating that user. Extends the packed external consumer gate to exercise both seams against PostgreSQL through installed tarballs.
- Updated dependencies [4a91956]
- Updated dependencies [81f9544]
  - @shipfox/api-common-dto@6.0.0
  - @shipfox/inter-module@0.2.0

## 5.0.0

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.
- Updated dependencies [bb037af]
  - @shipfox/api-common-dto@5.0.0

## 2.0.0

### Minor Changes

- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.

### Patch Changes

- Updated dependencies [1b0d344]
  - @shipfox/api-common-dto@2.0.0

## 0.1.0

### Minor Changes

- d02c5fd: Queues auth and workspace transactional emails through module-owned outbox events so account verification, password reset, and invitation sends retry outside request transactions.
- c0a883c: Moves the job lease capability token codec and its claims schema from the runners packages into api-auth/api-auth-dto, renaming its config to `AUTH_JOB_LEASE_TOKEN_*`, so all signed-token codecs live with authentication. Adds a shared leased-job auth context for request-scoped lease claims, and a shared `createLeaseTokenAuthMethod` (the `leased-job` auth method) registered on the auth module so any feature module can protect routes with a lease token by name.
- 3afb7e3: Adds job execution success expressions and execution timeouts to workflow documents.
  Renames job execution IDs in auth, runner, workflow, and timeout event contracts to the explicit `jobExecutionId` / `job_execution_id` shape.
- 6181819: Adds runner registration sessions with bounded label contracts, session-token auth, and lease-token heartbeat ownership.

### Patch Changes

- e250c4c: Propagates `projectId` end-to-end into the job lease token. Workflows sources the `{workspaceId, projectId, workflowRunId, workflowRunAttemptId, jobId, jobExecutionId}` identity tuple and threads it through the runner pending/running job tables and lease claims. This is lease-shape groundwork for per-project log-ingest authorization; the stream-stamping consumer lands separately.
- 362b3eb: Scope runner log append authorization to the dispatched step attempt carried by the job lease token.
- 27770eb: Tightens signup, workspace, and project display-name validation with shared trimming, control and format-character rejection, length limits, and contextual client form errors.
- Updated dependencies [27770eb]
  - @shipfox/api-common-dto@0.1.0
