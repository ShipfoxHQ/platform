# @shipfox/client-workspace-settings

## 17.0.0

### Patch Changes

- Updated dependencies [4b0731e]
  - @shipfox/react-ui@1.2.0
  - @shipfox/client-ui@17.0.0
  - @shipfox/client-auth@17.0.0
  - @shipfox/client-shell@17.0.0

## 16.0.0

### Patch Changes

- Updated dependencies [80cde6b]
  - @shipfox/react-ui@1.1.0
  - @shipfox/client-ui@16.0.0
  - @shipfox/client-auth@16.0.0
  - @shipfox/client-shell@16.0.0

## 14.0.1

### Patch Changes

- 88bf8e8: Migrates the shell, auth, secrets, logs, workspace-settings, config, and invitations
  surfaces to semantic spacing roles and brings them under the `no-raw-spacing` Biome
  plugin. Adds shared menu-surface and edge-specific panel roles for existing spacing
  contracts.
- Updated dependencies [88bf8e8]
- Updated dependencies [6aa6c7a]
- Updated dependencies [5c56ba6]
  - @shipfox/react-ui@1.0.0
  - @shipfox/client-shell@14.0.1
  - @shipfox/client-auth@14.0.1
  - @shipfox/client-ui@14.0.1

## 14.0.0

### Patch Changes

- Updated dependencies [baa7594]
- Updated dependencies [f8a98cb]
- Updated dependencies [1267eb3]
- Updated dependencies [b2d4550]
  - @shipfox/react-ui@0.5.0
  - @shipfox/client-ui@14.0.0
  - @shipfox/client-auth@14.0.0
  - @shipfox/client-shell@14.0.0

## 13.0.0

### Major Changes

- e405e92: Move client routes to slug-based `/w/$workspaceSlug` and `/p/$projectSlug` URLs, enforce the new composition contract, and support bounded project-slug resolution.

### Minor Changes

- 3c73365: Add project settings, shared slug rename warnings, and live slug availability checks.

### Patch Changes

- f78740d: Remove Unicode dash punctuation from package prose and source comments.
- Updated dependencies [e405e92]
- Updated dependencies [f78740d]
- Updated dependencies [94aba88]
- Updated dependencies [9969937]
- Updated dependencies [3c73365]
- Updated dependencies [9ebc5b4]
- Updated dependencies [54c820e]
- Updated dependencies [6adc228]
- Updated dependencies [e1efaee]
  - @shipfox/client-auth@13.0.0
  - @shipfox/client-shell@13.0.0
  - @shipfox/client-ui@13.0.0
  - @shipfox/react-ui@0.4.0
  - @shipfox/api-workspaces-dto@12.0.0

## 12.0.2

### Patch Changes

- Updated dependencies [25158c8]
  - @shipfox/api-workspaces-dto@11.0.0
  - @shipfox/client-auth@12.0.2
  - @shipfox/client-shell@12.0.2

## 12.0.1

### Patch Changes

- Updated dependencies [0087553]
- Updated dependencies [07e7371]
  - @shipfox/client-auth@12.0.1
  - @shipfox/api-workspaces-dto@10.2.0
  - @shipfox/client-shell@12.0.1

## 12.0.0

### Patch Changes

- Updated dependencies [96ae951]
  - @shipfox/client-shell@12.0.0
  - @shipfox/client-auth@12.0.0

## 11.0.0

### Patch Changes

- Updated dependencies [662516d]
- Updated dependencies [e9280fc]
  - @shipfox/client-shell@11.0.0
  - @shipfox/api-workspaces-dto@10.0.0
  - @shipfox/client-auth@11.0.0
  - @shipfox/client-api@6.0.1
  - @shipfox/client-ui@6.0.2
  - @shipfox/react-ui@0.3.7

## 10.0.1

### Patch Changes

- Updated dependencies [7b6a409]
  - @shipfox/api-workspaces-dto@9.3.0
  - @shipfox/client-auth@10.0.1
  - @shipfox/client-shell@10.0.1

## 10.0.0

### Patch Changes

- Updated dependencies [456c884]
  - @shipfox/client-shell@10.0.0
  - @shipfox/api-workspaces-dto@9.2.0
  - @shipfox/client-auth@10.0.0

## 9.0.0

### Patch Changes

- Updated dependencies [56e2c58]
- Updated dependencies [87170f8]
  - @shipfox/client-shell@9.0.0
  - @shipfox/client-auth@9.0.0

## 8.0.0

### Patch Changes

- Updated dependencies [25f5f42]
- Updated dependencies [289d686]
  - @shipfox/client-auth@8.0.0
  - @shipfox/client-shell@8.0.0

## 7.0.0

### Patch Changes

- Updated dependencies [61309db]
  - @shipfox/client-auth@7.0.0

## 6.0.3

### Patch Changes

- Updated dependencies [e6f831e]
  - @shipfox/client-auth@6.0.3

## 6.0.2

### Patch Changes

- Updated dependencies [4b85404]
- Updated dependencies [102c5f4]
  - @shipfox/api-workspaces-dto@9.0.2
  - @shipfox/react-ui@0.3.7
  - @shipfox/client-ui@6.0.2
  - @shipfox/client-shell@6.0.2
  - @shipfox/client-auth@6.0.2

## 6.0.1

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.
- Updated dependencies [475ce59]
- Updated dependencies [3f8f1cb]
  - @shipfox/api-workspaces-dto@9.0.1
  - @shipfox/client-api@6.0.1
  - @shipfox/client-auth@6.0.1
  - @shipfox/client-shell@6.0.1
  - @shipfox/client-ui@6.0.1
  - @shipfox/react-ui@0.3.6

## 6.0.0

### Minor Changes

- 401b583: Exposes typed feature-owned navigation and settings contributions and enforces coordinator-owned client composition.

### Patch Changes

- 01f1c88: Converges workspace membership settings on checked domain models and membership policies.
- d784a07: Enforces checked client API responses and removes stale transport compatibility helpers.
- Updated dependencies [401b583]
- Updated dependencies [d784a07]
- Updated dependencies [891e469]
- Updated dependencies [82eda45]
- Updated dependencies [9c9d266]
- Updated dependencies [cd90c19]
- Updated dependencies [24be269]
- Updated dependencies [c56c124]
- Updated dependencies [4a6d124]
- Updated dependencies [c02ac42]
  - @shipfox/client-shell@6.0.0
  - @shipfox/client-auth@6.0.0
  - @shipfox/api-workspaces-dto@9.0.0
  - @shipfox/client-api@6.0.0
  - @shipfox/client-ui@6.0.0
  - @shipfox/react-ui@0.3.5

## 5.0.0

### Patch Changes

- ffd727b: Converges auth session and invitation state onto shared camelCase domain types validated at the API boundary, replacing the raw snake_case DTOs previously returned by login, signup, password reset, email verification, workspace creation, and invitation preview. `AuthState.user`, `useRefreshAuth()`, and `usePreviewInvitation()` now resolve to `UserIdentity`/`AuthenticatedSession`/`InvitationPreview` shapes (for example `accessToken` instead of `token`, `workspaceName` instead of `workspace_name`). Also moves the shared `AuthShell` component and session mapping helpers into `@shipfox/client-shell`, breaking the former `client-auth` ↔ `client-invitations` circular dependency.
- f1d6465: Moves workspace-settings and project-workflow route ownership from centralized packages into each feature's own route module, so a feature package declares and ships its own settings pages.
- Updated dependencies [ffd727b]
  - @shipfox/client-shell@5.0.0
  - @shipfox/client-auth@5.0.0

## 4.0.0

### Patch Changes

- 6b4a575: Adds checked client API response boundaries and domain-cached invitation queries.
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
  - @shipfox/client-runners@4.0.0
  - @shipfox/client-secrets@4.0.0
  - @shipfox/client-triggers@4.0.0

## 3.0.1

### Patch Changes

- ffc7fc9: Republishes the affected release set after recovering package publication.
- Updated dependencies [ffc7fc9]
  - @shipfox/client-agent@3.0.1
  - @shipfox/client-auth@3.0.1
  - @shipfox/client-integrations@3.0.1
  - @shipfox/client-runners@3.0.1
  - @shipfox/client-secrets@3.0.1
  - @shipfox/client-shell@3.0.1
  - @shipfox/client-triggers@3.0.1
  - @shipfox/client-ui@3.0.1
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
  - @shipfox/client-runners@3.0.0
  - @shipfox/client-secrets@3.0.0
  - @shipfox/client-triggers@3.0.0
  - @shipfox/client-ui@3.0.0

## 2.0.0

### Patch Changes

- Updated dependencies [ba2e3dc]
- Updated dependencies [1820feb]
- Updated dependencies [7ac43a4]
- Updated dependencies [1b79cda]
- Updated dependencies [c2db8c3]
- Updated dependencies [326f4c0]
- Updated dependencies [1820feb]
- Updated dependencies [4a91956]
  - @shipfox/client-auth@2.0.0
  - @shipfox/react-ui@0.3.3
  - @shipfox/client-shell@2.0.0
  - @shipfox/api-workspaces-dto@6.0.0
  - @shipfox/client-integrations@2.0.0
  - @shipfox/client-runners@2.0.0
  - @shipfox/client-agent@2.0.0
  - @shipfox/client-ui@2.0.0
  - @shipfox/client-secrets@2.0.0
  - @shipfox/client-triggers@2.0.0

## 1.0.0

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.
- 5c63a2a: Validates the published default client composition from a clean external Vite consumer and fixes typed access to the events settings route.
- Updated dependencies [47809a2]
- Updated dependencies [bb037af]
- Updated dependencies [5c63a2a]
- Updated dependencies [d8658ba]
  - @shipfox/client-shell@1.0.0
  - @shipfox/api-workspaces-dto@5.0.0
  - @shipfox/client-agent@1.0.0
  - @shipfox/client-api@1.0.0
  - @shipfox/client-auth@1.0.0
  - @shipfox/client-integrations@1.0.0
  - @shipfox/client-runners@1.0.0
  - @shipfox/client-secrets@1.0.0
  - @shipfox/client-triggers@1.0.0
  - @shipfox/client-ui@1.0.0
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
  - @shipfox/client-runners@0.2.0
  - @shipfox/client-secrets@0.2.0
  - @shipfox/client-shell@0.2.0
  - @shipfox/client-triggers@0.2.0
  - @shipfox/client-ui@0.2.0

## 0.1.2

### Patch Changes

- Updated dependencies [c18d624]
  - @shipfox/react-ui@0.3.1
  - @shipfox/client-integrations@0.1.2
  - @shipfox/client-agent@0.1.2
  - @shipfox/client-auth@0.0.5
  - @shipfox/client-runners@0.0.5
  - @shipfox/client-secrets@0.1.2
  - @shipfox/client-triggers@0.1.2
  - @shipfox/client-ui@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [1b0d344]
  - @shipfox/api-workspaces-dto@2.0.0
  - @shipfox/client-ui@0.1.1
  - @shipfox/client-agent@0.1.1
  - @shipfox/client-auth@0.0.4
  - @shipfox/client-integrations@0.1.1
  - @shipfox/client-runners@0.0.4
  - @shipfox/client-secrets@0.1.1
  - @shipfox/client-triggers@0.1.1
  - @shipfox/client-api@0.0.1
  - @shipfox/react-ui@0.3.0

## 0.1.0

### Minor Changes

- 067a260: Adds workspace model provider settings for configuring, testing, defaulting, and deleting provider credentials.
- e51d464: Add the Secrets & Variables workspace settings UI (S1b).
  - New `@shipfox/client-secrets` package: transport + React Query hooks (a shared
    `createStoreApi` factory), a write-only secret form and a readable variable form
    (TanStack Form + Zod, multiline `Textarea` values, live short-value / sensitive-name
    advisories), and the workspace secrets/variables sections (single-call list, masked
    secret values, copy-name, delete with blast-radius warning).
  - `@shipfox/client-workspace-settings`: new Secrets and Variables settings pages and nav
    entries.
  - `@shipfox/api-secrets-dto`: export `SECRETS_MAX_LIST_LIMIT` and raise the list `limit`
    cap so the settings UI can fetch the whole bounded set in one request; the variable
    list item now carries `value_truncated`.
  - `@shipfox/api-secrets`: the variable list returns a bounded single-line preview of each
    value (the full value is read via `GET /variables/:key` when editing) so a single-call
    list cannot materialize very large responses; startup fails if `SECRETS_MAX_PER_WORKSPACE`
    exceeds the list limit.
  - `@shipfox/client-router`: register the `/workspaces/$wid/settings/secrets` and
    `/variables` routes.

- b8e49ff: Add the client-side Sentry install/connect flow and a workspace settings
  integrations hub.
  - `@shipfox/client-integrations`: shared `IntegrationGallerySection` (capability
    filter, lifecycle pills, "Added" date, external link, connected-first
    ordering, degraded status mode), shared `RedirectInstallPage` powering the
    GitHub and new Sentry install pages, `SentryCallbackPage` with an explicit
    workspace confirm (sessionStorage only pre-selects), two-tier retry, and the
    Sentry hooks (`useCreateSentryInstallMutation`, `connectSentry`,
    `useIntegrationConnectionsQuery`).
  - `@shipfox/client-workspace-settings`: new `/workspaces/$wid/settings/integrations`
    page and an Integrations entry in the settings nav.
  - `@shipfox/client-router`: routes for the Sentry install page, the root-level
    Sentry callback, and the settings integrations page.
  - `@shipfox/react-ui`: `sentry` icon (monochrome, theme-aware).
  - `@shipfox/api-integration-core-dto`: optional `external_url` on the connection
    DTO and an optional `connectionExternalUrl` method on `IntegrationProvider`.
  - `@shipfox/api-integration-core`: `GET /integration-connections` now returns
    connections of every lifecycle status (the active-only filter prevented
    clients from surfacing disabled/error state) and resolves `external_url`
    per connection best-effort.
  - `@shipfox/api-integration-sentry` / `@shipfox/api-integration-github`:
    implement `connectionExternalUrl` (Sentry org URL via a new
    by-connection-id installation lookup; GitHub installation settings URL).

### Patch Changes

- 0f06c02: Redesign the integration gallery into separate Installed and Available sections, rendering one card per connection so multiple connections from the same provider are no longer collapsed and silently hidden.
- e5d2f13: Add the workspace **Events** page in Settings: a filterable, cursor-paginated table of
  trigger events (status dot, source/event, routing summary, delivery id, received time)
  mounted at `/workspaces/$wid/settings/events` and wired into the settings sub-nav. Filters
  (date range, source, event, outcome) live in the URL via `validateSearch`, so a filtered
  view is shareable. Source and event filters are populated by a new
  `GET /trigger-events/facets` endpoint that returns each workspace's distinct source/event
  values with counts (top 50, backed by `(workspace_id, source)` / `(workspace_id, event)`
  indexes); the list still renders if facets fail to load.
- 048fc29: Adds Runner Provisioners settings with provisioner token management and connection status.
- Updated dependencies [067a260]
- Updated dependencies [43d7996]
- Updated dependencies [14e0bea]
- Updated dependencies [d02c5fd]
- Updated dependencies [9018f0b]
- Updated dependencies [7fdfd72]
- Updated dependencies [72ce351]
- Updated dependencies [2a3193f]
- Updated dependencies [1b9d909]
- Updated dependencies [f104ff2]
- Updated dependencies [7341569]
- Updated dependencies [d245be8]
- Updated dependencies [0f06c02]
- Updated dependencies [e4c6abf]
- Updated dependencies [e4c6abf]
- Updated dependencies [2c352bb]
- Updated dependencies [e5d2f13]
- Updated dependencies [5d0676a]
- Updated dependencies [a460020]
- Updated dependencies [a35c2dc]
- Updated dependencies [58f7aef]
- Updated dependencies [5264a22]
- Updated dependencies [9674879]
- Updated dependencies [225c9a5]
- Updated dependencies [42443b4]
- Updated dependencies [24f131b]
- Updated dependencies [7790355]
- Updated dependencies [bb2a7bc]
- Updated dependencies [63bcac8]
- Updated dependencies [5eb06d0]
- Updated dependencies [4e13e5f]
- Updated dependencies [e92150d]
- Updated dependencies [8037501]
- Updated dependencies [0fb6018]
- Updated dependencies [c27a1ed]
- Updated dependencies [e51d464]
- Updated dependencies [b8e49ff]
- Updated dependencies [8037501]
- Updated dependencies [6c0da64]
- Updated dependencies [07f8ff8]
- Updated dependencies [e457582]
- Updated dependencies [8b5c905]
- Updated dependencies [f849131]
- Updated dependencies [a7da648]
- Updated dependencies [94bdcc5]
- Updated dependencies [a34c8ea]
- Updated dependencies [27770eb]
- Updated dependencies [8ac4bf4]
- Updated dependencies [048fc29]
- Updated dependencies [6181819]
- Updated dependencies [3a0be6b]
- Updated dependencies [d42baf4]
- Updated dependencies [8037501]
- Updated dependencies [54bb8a3]
- Updated dependencies [f711e18]
  - @shipfox/client-agent@0.1.0
  - @shipfox/client-integrations@0.1.0
  - @shipfox/react-ui@0.3.0
  - @shipfox/api-workspaces-dto@0.1.0
  - @shipfox/client-triggers@0.1.0
  - @shipfox/client-api@0.0.1
  - @shipfox/client-ui@0.1.0
  - @shipfox/client-auth@0.0.3
  - @shipfox/client-secrets@0.1.0
  - @shipfox/client-runners@0.0.3

## 0.0.2

### Patch Changes

- Updated dependencies [5c1e777]
  - @shipfox/react-ui@0.2.0
  - @shipfox/client-auth@0.0.2
  - @shipfox/client-runners@0.0.2

## 0.0.1

### Patch Changes

- Updated dependencies [2311e15]
  - @shipfox/react-ui@0.1.1
  - @shipfox/client-auth@0.0.1
  - @shipfox/client-runners@0.0.1
  - @shipfox/api-workspaces-dto@0.0.0
  - @shipfox/client-api@0.0.0
