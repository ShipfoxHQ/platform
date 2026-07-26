# @shipfox/client-projects

## 10.0.1

### Patch Changes

- @shipfox/client-auth@10.0.1
- @shipfox/client-shell@10.0.1
- @shipfox/client-integrations@10.0.1
- @shipfox/client-agent@10.0.1

## 10.0.0

### Patch Changes

- Updated dependencies [456c884]
  - @shipfox/client-shell@10.0.0
  - @shipfox/api-projects-dto@9.2.0
  - @shipfox/client-auth@10.0.0
  - @shipfox/client-agent@10.0.0
  - @shipfox/client-integrations@10.0.0

## 9.0.0

### Patch Changes

- Updated dependencies [56e2c58]
- Updated dependencies [87170f8]
- Updated dependencies [8e1820a]
  - @shipfox/client-shell@9.0.0
  - @shipfox/client-integrations@9.0.0
  - @shipfox/client-agent@9.0.0
  - @shipfox/client-auth@9.0.0

## 8.0.0

### Patch Changes

- Updated dependencies [25f5f42]
- Updated dependencies [289d686]
- Updated dependencies [ac2ac4a]
  - @shipfox/client-auth@8.0.0
  - @shipfox/client-shell@8.0.0
  - @shipfox/client-integrations@8.0.0
  - @shipfox/client-agent@8.0.0

## 7.0.0

### Patch Changes

- Updated dependencies [61309db]
  - @shipfox/client-auth@7.0.0
  - @shipfox/client-integrations@7.0.0

## 6.0.3

### Patch Changes

- Updated dependencies [e6f831e]
  - @shipfox/client-auth@6.0.3
  - @shipfox/client-integrations@6.0.3

## 6.0.2

### Patch Changes

- 102c5f4: Isolates private browser state and React Query data across authenticated principal transitions.
- Updated dependencies [4b85404]
- Updated dependencies [102c5f4]
  - @shipfox/api-definitions-dto@9.0.2
  - @shipfox/api-integration-core-dto@9.0.2
  - @shipfox/api-projects-dto@9.0.2
  - @shipfox/react-ui@0.3.7
  - @shipfox/client-ui@6.0.2
  - @shipfox/client-shell@6.0.2
  - @shipfox/client-auth@6.0.2
  - @shipfox/client-agent@6.0.2
  - @shipfox/client-integrations@6.0.2

## 6.0.1

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.
- 3f8f1cb: Enforces typed route-input and browser-storage boundaries across client features.
- Updated dependencies [475ce59]
- Updated dependencies [3f8f1cb]
  - @shipfox/api-definitions-dto@9.0.1
  - @shipfox/api-integration-core-dto@9.0.1
  - @shipfox/api-projects-dto@9.0.1
  - @shipfox/client-agent@6.0.1
  - @shipfox/client-api@6.0.1
  - @shipfox/client-auth@6.0.1
  - @shipfox/client-integrations@6.0.1
  - @shipfox/client-shell@6.0.1
  - @shipfox/client-ui@6.0.1
  - @shipfox/react-ui@0.3.6

## 6.0.0

### Minor Changes

- 401b583: Exposes typed feature-owned navigation and settings contributions and enforces coordinator-owned client composition.
- 125c90f: Adds checked Projects domain models and resource-owned query cache policy.

### Patch Changes

- 82eda45: Adds validated URL-owned project and workflow run filters for shareable navigation state.
- c02ac42: Converges the integrations client on a package-owned domain model (camelCase, schema-validated) instead of exposing raw snake_case API DTOs, changing the shape of `useSourceConnectionsQuery`, `useIntegrationConnectionsQuery`, `useIntegrationProvidersQuery`, `useRepositoriesInfiniteQuery`, and the `ConnectionPicker`/`ProviderGrid`/`RepositoryPicker` props. Adds `emptyResponseSchema` to `@shipfox/client-api` for schema-validated DELETE requests with no response body.
- Updated dependencies [401b583]
- Updated dependencies [e009149]
- Updated dependencies [d784a07]
- Updated dependencies [891e469]
- Updated dependencies [82eda45]
- Updated dependencies [f2d50a8]
- Updated dependencies [cd90c19]
- Updated dependencies [24be269]
- Updated dependencies [c56c124]
- Updated dependencies [fa07be9]
- Updated dependencies [46aa52f]
- Updated dependencies [9d8f510]
- Updated dependencies [02974d6]
- Updated dependencies [4a6d124]
- Updated dependencies [c02ac42]
- Updated dependencies [c097dff]
  - @shipfox/client-agent@6.0.0
  - @shipfox/client-integrations@6.0.0
  - @shipfox/client-shell@6.0.0
  - @shipfox/client-auth@6.0.0
  - @shipfox/client-api@6.0.0
  - @shipfox/api-integration-core-dto@9.0.0
  - @shipfox/api-definitions-dto@6.0.0
  - @shipfox/api-projects-dto@8.0.0
  - @shipfox/client-ui@6.0.0
  - @shipfox/react-ui@0.3.5

## 5.0.0

### Major Changes

- 8d8cdef: Extracts workspace onboarding into a dedicated coordinator and shares its feature query policies.

### Patch Changes

- ffd727b: Converges auth session and invitation state onto shared camelCase domain types validated at the API boundary, replacing the raw snake_case DTOs previously returned by login, signup, password reset, email verification, workspace creation, and invitation preview. `AuthState.user`, `useRefreshAuth()`, and `usePreviewInvitation()` now resolve to `UserIdentity`/`AuthenticatedSession`/`InvitationPreview` shapes (for example `accessToken` instead of `token`, `workspaceName` instead of `workspace_name`). Also moves the shared `AuthShell` component and session mapping helpers into `@shipfox/client-shell`, breaking the former `client-auth` ↔ `client-invitations` circular dependency.
- f1d6465: Moves workspace-settings and project-workflow route ownership from centralized packages into each feature's own route module, so a feature package declares and ships its own settings pages.
- Updated dependencies [8d8cdef]
- Updated dependencies [ffd727b]
- Updated dependencies [f1d6465]
- Updated dependencies [7f227c6]
  - @shipfox/client-agent@5.0.0
  - @shipfox/client-integrations@5.0.0
  - @shipfox/client-shell@5.0.0
  - @shipfox/client-auth@5.0.0
  - @shipfox/api-integration-core-dto@8.0.0
  - @shipfox/api-projects-dto@8.0.0

## 4.0.0

### Patch Changes

- 2e5b718: Adds safe browser persistence and bounded callback deduplication across client flows.
- Updated dependencies [2e5b718]
- Updated dependencies [6b4a575]
- Updated dependencies [20e4feb]
- Updated dependencies [11b10f7]
- Updated dependencies [781a45b]
  - @shipfox/client-ui@4.0.0
  - @shipfox/client-agent@4.0.0
  - @shipfox/client-integrations@4.0.0
  - @shipfox/client-shell@4.0.0
  - @shipfox/client-api@4.0.0
  - @shipfox/client-auth@4.0.0
  - @shipfox/client-workflows@4.0.0

## 3.0.1

### Patch Changes

- ffc7fc9: Republishes the affected release set after recovering package publication.
- Updated dependencies [ffc7fc9]
  - @shipfox/client-agent@3.0.1
  - @shipfox/client-auth@3.0.1
  - @shipfox/client-integrations@3.0.1
  - @shipfox/client-shell@3.0.1
  - @shipfox/client-ui@3.0.1
  - @shipfox/client-workflows@3.0.1
  - @shipfox/react-ui@0.3.5

## 3.0.0

### Patch Changes

- Updated dependencies [cb58afe]
- Updated dependencies [d735fe3]
- Updated dependencies [5b06cd5]
  - @shipfox/react-ui@0.3.4
  - @shipfox/client-shell@3.0.0
  - @shipfox/client-agent@3.0.0
  - @shipfox/client-auth@3.0.0
  - @shipfox/client-integrations@3.0.0
  - @shipfox/client-ui@3.0.0
  - @shipfox/client-workflows@3.0.0

## 2.0.0

### Patch Changes

- Updated dependencies [a8f0545]
- Updated dependencies [0bb82a4]
- Updated dependencies [23563de]
- Updated dependencies [ba2e3dc]
- Updated dependencies [1820feb]
- Updated dependencies [7ac43a4]
- Updated dependencies [f262539]
- Updated dependencies [3bb4e26]
- Updated dependencies [23a4dc2]
- Updated dependencies [1820feb]
- Updated dependencies [4604a06]
  - @shipfox/api-definitions-dto@6.0.0
  - @shipfox/api-integration-core-dto@6.0.0
  - @shipfox/api-workflows-dto@6.0.0
  - @shipfox/client-auth@2.0.0
  - @shipfox/react-ui@0.3.3
  - @shipfox/client-shell@2.0.0
  - @shipfox/client-integrations@2.0.0
  - @shipfox/client-agent@2.0.0
  - @shipfox/client-ui@2.0.0
  - @shipfox/client-workflows@2.0.0
  - @shipfox/api-projects-dto@6.0.0

## 1.0.0

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.
- Updated dependencies [47809a2]
- Updated dependencies [2875241]
- Updated dependencies [bb037af]
- Updated dependencies [5c63a2a]
- Updated dependencies [d8658ba]
- Updated dependencies [fb70438]
  - @shipfox/client-shell@1.0.0
  - @shipfox/api-integration-core-dto@5.0.0
  - @shipfox/api-definitions-dto@5.0.0
  - @shipfox/api-projects-dto@5.0.0
  - @shipfox/api-workflows-dto@5.0.0
  - @shipfox/client-agent@1.0.0
  - @shipfox/client-api@1.0.0
  - @shipfox/client-auth@1.0.0
  - @shipfox/client-integrations@1.0.0
  - @shipfox/client-ui@1.0.0
  - @shipfox/client-workflows@1.0.0
  - @shipfox/react-ui@0.3.2

## 0.2.0

### Minor Changes

- 3d064b8: Publishes the client runtime closure with shell, feature, route, Vite, and testing contracts.
- 6bc2e45: Adds the composable upstream client shell, feature catalog, and route manifests for every client feature.

### Patch Changes

- Updated dependencies [3d064b8]
- Updated dependencies [6bc2e45]
  - @shipfox/client-agent@0.2.0
  - @shipfox/client-api@0.2.0
  - @shipfox/client-auth@0.2.0
  - @shipfox/client-integrations@0.2.0
  - @shipfox/client-shell@0.2.0
  - @shipfox/client-ui@0.2.0
  - @shipfox/client-workflows@0.2.0

## 0.0.5

### Patch Changes

- Updated dependencies [6b23868]
- Updated dependencies [c18d624]
  - @shipfox/api-integration-core-dto@3.0.0
  - @shipfox/react-ui@0.3.1
  - @shipfox/client-integrations@0.1.2
  - @shipfox/client-agent@0.1.2
  - @shipfox/client-auth@0.0.5
  - @shipfox/client-ui@0.1.2
  - @shipfox/client-workflows@0.1.2

## 0.0.4

### Patch Changes

- Updated dependencies [1b0d344]
  - @shipfox/api-definitions-dto@2.0.0
  - @shipfox/api-integration-core-dto@2.0.0
  - @shipfox/api-projects-dto@2.0.0
  - @shipfox/api-workflows-dto@2.0.0
  - @shipfox/client-ui@0.1.1
  - @shipfox/client-agent@0.1.1
  - @shipfox/client-auth@0.0.4
  - @shipfox/client-integrations@0.1.1
  - @shipfox/client-workflows@0.1.1
  - @shipfox/client-api@0.0.1
  - @shipfox/react-ui@0.3.0

## 0.0.3

### Patch Changes

- 974b501: Moves manual workflow-run firing and optimistic run-list cache updates into `@shipfox/client-workflows` so project workflow pages consume the run cache owner directly.
- 8037501: Drop the workflow run page and its related run-list components, now owned by
  `@shipfox/client-workflows`. Removes the duplicated `WorkflowRunPage`,
  `ProjectRunsPage`, runs search params, `WorkflowRunsList`, `RunRow`,
  `RunStatusFilter`, and `StatusDot`, along with the run-list/run-detail query
  hooks they relied on. The package keeps the manual-fire mutation that the
  workflows tab still uses, and prunes the now-unused `zod` and `@shipfox/vite`
  dependencies.
- 42443b4: Redesign the projects hub cards around source health and align them with the
  integration gallery cards. Each card now shows the integration provider logo
  before the name, drops the raw external repository id, and surfaces a status
  pill only when the project's source is not active (Disabled or Error), in the
  same inline location as the gallery. The cards adopt the gallery layout
  (two-column grid, 16px padding, 24px icon) and carry no call to action.

  Extract the connection lifecycle pill into a shared `ConnectionStatusBadge` in
  `@shipfox/client-integrations` so the gallery and the projects hub render the
  same taxonomy from one source of truth.

- 63bcac8: Moves workspace setup gating into route hooks so VCS onboarding and first project creation resolve before protected workspace content renders.
- a7da648: Fixes invisible keyboard focus rings on the user menu, integration tiles, and project cards by using the existing neutral button focus token.
- 27770eb: Tightens signup, workspace, and project display-name validation with shared trimming, control and format-character rejection, length limits, and contextual client form errors.
- 8ecc121: Track queue/run/finish timing for workflow runs and jobs. Adds nullable `started_at`/`finished_at` to workflow runs and `queued_at`/`started_at`/`finished_at` to jobs, exposed on the run and job DTOs. The runners module emits two new authoritative-timestamp events (`runners.job.queued`, `runners.job.started`) in the same transaction as the enqueue/claim; workflows projects them onto the job row with a first-write-wins `coalesce`, so the at-least-once outbox can redeliver out of order safely. Run `started_at`/`finished_at` and job `finished_at` are stamped in-module at the status transitions. All columns are nullable and eventually consistent, so consumers must treat a missing endpoint as "not yet known" and clamp any duration math.
- Updated dependencies [dc3e434]
- Updated dependencies [eb40964]
- Updated dependencies [5c18360]
- Updated dependencies [067a260]
- Updated dependencies [43d7996]
- Updated dependencies [14e0bea]
- Updated dependencies [59ba68b]
- Updated dependencies [7a9943d]
- Updated dependencies [c17dd6e]
- Updated dependencies [9018f0b]
- Updated dependencies [7fdfd72]
- Updated dependencies [115655e]
- Updated dependencies [736249b]
- Updated dependencies [2bc5595]
- Updated dependencies [974b501]
- Updated dependencies [228385c]
- Updated dependencies [2a3193f]
- Updated dependencies [1b9d909]
- Updated dependencies [ce062a9]
- Updated dependencies [f104ff2]
- Updated dependencies [7341569]
- Updated dependencies [a20b345]
- Updated dependencies [940696a]
- Updated dependencies [f3614ae]
- Updated dependencies [f98c2be]
- Updated dependencies [e9396c9]
- Updated dependencies [d245be8]
- Updated dependencies [0f06c02]
- Updated dependencies [8037501]
- Updated dependencies [b525dcd]
- Updated dependencies [f8f339a]
- Updated dependencies [e4c6abf]
- Updated dependencies [e4c6abf]
- Updated dependencies [6e435dd]
- Updated dependencies [7fa8f0b]
- Updated dependencies [5d0676a]
- Updated dependencies [3afb7e3]
- Updated dependencies [a35c2dc]
- Updated dependencies [58f7aef]
- Updated dependencies [5264a22]
- Updated dependencies [0b75eba]
- Updated dependencies [9674879]
- Updated dependencies [c652a68]
- Updated dependencies [225c9a5]
- Updated dependencies [42443b4]
- Updated dependencies [24f131b]
- Updated dependencies [7790355]
- Updated dependencies [bb2a7bc]
- Updated dependencies [417e220]
- Updated dependencies [795f440]
- Updated dependencies [3dcd751]
- Updated dependencies [63bcac8]
- Updated dependencies [5eb06d0]
- Updated dependencies [4e13e5f]
- Updated dependencies [e92150d]
- Updated dependencies [8037501]
- Updated dependencies [0fb6018]
- Updated dependencies [c27a1ed]
- Updated dependencies [c0a883c]
- Updated dependencies [362b3eb]
- Updated dependencies [b8e49ff]
- Updated dependencies [d6d4862]
- Updated dependencies [8037501]
- Updated dependencies [6c0da64]
- Updated dependencies [7a0ac44]
- Updated dependencies [d69b164]
- Updated dependencies [07f8ff8]
- Updated dependencies [e457582]
- Updated dependencies [8b5c905]
- Updated dependencies [2fb3e87]
- Updated dependencies [01be723]
- Updated dependencies [9a5aac4]
- Updated dependencies [ef1e917]
- Updated dependencies [f849131]
- Updated dependencies [61de795]
- Updated dependencies [a7da648]
- Updated dependencies [94bdcc5]
- Updated dependencies [a34c8ea]
- Updated dependencies [27770eb]
- Updated dependencies [2933c33]
- Updated dependencies [8ac4bf4]
- Updated dependencies [43fd0c1]
- Updated dependencies [8fad235]
- Updated dependencies [3a0be6b]
- Updated dependencies [e699508]
- Updated dependencies [d42baf4]
- Updated dependencies [8037501]
- Updated dependencies [b8919da]
- Updated dependencies [f880179]
- Updated dependencies [54bb8a3]
- Updated dependencies [f711e18]
- Updated dependencies [8ecc121]
- Updated dependencies [7341569]
- Updated dependencies [8037501]
  - @shipfox/client-workflows@0.1.0
  - @shipfox/api-workflows-dto@0.1.0
  - @shipfox/client-agent@0.1.0
  - @shipfox/client-integrations@0.1.0
  - @shipfox/react-ui@0.3.0
  - @shipfox/api-definitions-dto@0.0.1
  - @shipfox/api-integration-core-dto@0.1.0
  - @shipfox/client-api@0.0.1
  - @shipfox/client-ui@0.1.0
  - @shipfox/client-auth@0.0.3
  - @shipfox/api-projects-dto@0.1.0

## 0.0.2

### Patch Changes

- Updated dependencies [5c1e777]
  - @shipfox/react-ui@0.2.0
  - @shipfox/client-auth@0.0.2
  - @shipfox/client-integrations@0.0.2

## 0.0.1

### Patch Changes

- Updated dependencies [2311e15]
  - @shipfox/react-ui@0.1.1
  - @shipfox/client-auth@0.0.1
  - @shipfox/client-integrations@0.0.1
  - @shipfox/api-definitions-dto@0.0.0
  - @shipfox/api-integration-core-dto@0.0.0
  - @shipfox/api-projects-dto@0.0.0
  - @shipfox/api-workflows-dto@0.0.0
  - @shipfox/client-api@0.0.0
