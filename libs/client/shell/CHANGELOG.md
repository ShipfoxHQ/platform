# Changelog

## 12.0.0

### Minor Changes

- 96ae951: Adds feature-owned layout parents, layout-local navigation, and checked child-route composition to the public client shell contract.

### Patch Changes

- Updated dependencies [fb34b6a]
  - @shipfox/api-auth-dto@10.1.0

## 11.0.0

### Minor Changes

- 662516d: Add an optional browser account-menu entry slot for composing applications.
- e9280fc: Add an observer-authorized administrator workspace lookup with bounded safe summaries,
  best-effort job counts, and a neutral unavailable-workspace member experience for
  suspended or deleted workspaces.

### Patch Changes

- Updated dependencies [6054364]
- Updated dependencies [e9280fc]
  - @shipfox/api-auth-dto@10.0.0
  - @shipfox/api-workspaces-dto@10.0.0
  - @shipfox/client-api@6.0.1
  - @shipfox/client-config@6.0.2
  - @shipfox/client-ui@6.0.2
  - @shipfox/react-ui@0.3.7

## 10.0.1

### Patch Changes

- Updated dependencies [10cf63c]
- Updated dependencies [7b6a409]
  - @shipfox/api-auth-dto@9.3.0
  - @shipfox/api-workspaces-dto@9.3.0

## 10.0.0

### Minor Changes

- 456c884: Add Auth-owned local administrator grants and server-side role evaluation.

### Patch Changes

- Updated dependencies [456c884]
  - @shipfox/api-auth-dto@9.2.0
  - @shipfox/api-workspaces-dto@9.2.0

## 9.0.0

### Minor Changes

- 56e2c58: Serve `/email-logo.png` from `@shipfox/client-shell`. Transactional emails link the logo at `CLIENT_BASE_URL + /email-logo.png`, but the asset only existed in this repository's own `apps/client/public/`, so any other client composed with the shell answered that path with its SPA fallback and mail clients rendered a broken image. The manifest plugin now owns the asset alongside the favicons, and it ships in the package. An application that keeps its own `public/email-logo.png` must delete it, since the plugin rejects conflicting copies.

### Patch Changes

- 87170f8: Move event payload scrolling to the detail rail and bound the desktop rail to the available viewport height.

## 8.0.0

### Minor Changes

- 289d686: Expose shell branding assets through the package export map and warn when the Vite composition plugin is used without its manifest plugin.

## 6.0.2

### Patch Changes

- 102c5f4: Isolates private browser state and React Query data across authenticated principal transitions.
- Updated dependencies [4b85404]
- Updated dependencies [102c5f4]
  - @shipfox/api-auth-dto@9.0.2
  - @shipfox/api-workspaces-dto@9.0.2
  - @shipfox/react-ui@0.3.7
  - @shipfox/client-ui@6.0.2
  - @shipfox/client-config@6.0.2

## 6.0.1

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.
- 3f8f1cb: Enforces typed route-input and browser-storage boundaries across client features.
- Updated dependencies [475ce59]
- Updated dependencies [3f8f1cb]
  - @shipfox/api-auth-dto@9.0.1
  - @shipfox/api-workspaces-dto@9.0.1
  - @shipfox/client-api@6.0.1
  - @shipfox/client-config@6.0.1
  - @shipfox/client-ui@6.0.1
  - @shipfox/react-ui@0.3.6

## 6.0.0

### Minor Changes

- 401b583: Exposes typed feature-owned navigation and settings contributions and enforces coordinator-owned client composition.
- cd90c19: Enforces package-owned query policies and explicit cache-operation ownership across client resources.

### Patch Changes

- 82eda45: Adds validated URL-owned project and workflow run filters for shareable navigation state.
- c56c124: Converges auth sessions and invitation responses on checked domain boundaries.
- 4a6d124: Separates Integrations provider SPI contracts from the public DTO surface.
- Updated dependencies [9c9d266]
- Updated dependencies [24be269]
- Updated dependencies [c02ac42]
  - @shipfox/api-workspaces-dto@9.0.0
  - @shipfox/client-api@6.0.0
  - @shipfox/api-auth-dto@7.1.0
  - @shipfox/client-config@3.0.1
  - @shipfox/client-ui@6.0.0
  - @shipfox/react-ui@0.3.5

## 5.0.0

### Major Changes

- ffd727b: Converges auth session and invitation state onto shared camelCase domain types validated at the API boundary, replacing the raw snake_case DTOs previously returned by login, signup, password reset, email verification, workspace creation, and invitation preview. `AuthState.user`, `useRefreshAuth()`, and `usePreviewInvitation()` now resolve to `UserIdentity`/`AuthenticatedSession`/`InvitationPreview` shapes (for example `accessToken` instead of `token`, `workspaceName` instead of `workspace_name`). Also moves the shared `AuthShell` component and session mapping helpers into `@shipfox/client-shell`, breaking the former `client-auth` ↔ `client-invitations` circular dependency.

## 4.0.0

### Patch Changes

- 2e5b718: Adds safe browser persistence and bounded callback deduplication across client flows.
- 11b10f7: Prevents private React Query data from persisting across logout and authenticated user changes.
- Updated dependencies [2e5b718]
- Updated dependencies [769d919]
- Updated dependencies [6b4a575]
- Updated dependencies [781a45b]
  - @shipfox/client-ui@4.0.0
  - @shipfox/api-auth-dto@7.1.0
  - @shipfox/client-api@4.0.0
  - @shipfox/client-config@3.0.1

## 3.0.1

### Patch Changes

- ffc7fc9: Republishes the affected release set after recovering package publication.
- Updated dependencies [ffc7fc9]
  - @shipfox/client-config@3.0.1
  - @shipfox/react-ui@0.3.5

## 3.0.0

### Minor Changes

- 5b06cd5: Adds a Vite manifest plugin that ships canonical Shipfox application identity assets and tags.

### Patch Changes

- d735fe3: Moves external package verification into package-owned Turbo tasks and stages production manifests outside the workspace.
- Updated dependencies [cb58afe]
  - @shipfox/react-ui@0.3.4
  - @shipfox/client-config@3.0.0

## 2.0.0

### Patch Changes

- 7ac43a4: Consolidates packed-consumer validation around stable publication and composition contracts instead of package-state snapshots.
- Updated dependencies [e6eba5b]
- Updated dependencies [ba2e3dc]
- Updated dependencies [1820feb]
- Updated dependencies [1b79cda]
- Updated dependencies [c2db8c3]
- Updated dependencies [112c0fa]
- Updated dependencies [326f4c0]
- Updated dependencies [4a91956]
  - @shipfox/api-auth-dto@6.0.0
  - @shipfox/react-ui@0.3.3
  - @shipfox/api-workspaces-dto@6.0.0
  - @shipfox/client-config@2.0.0

## 1.0.0

### Patch Changes

- 47809a2: Hardens packed client composition validation against release artifacts, undeclared route packages, and optional Storybook testing peers.
- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.
- 5c63a2a: Validates the published default client composition from a clean external Vite consumer and fixes typed access to the events settings route.
- d8658ba: Prevents composition builds from reading resolver IDs that include Vite version queries.
- Updated dependencies [bb037af]
  - @shipfox/api-auth-dto@5.0.0
  - @shipfox/api-workspaces-dto@5.0.0
  - @shipfox/client-api@1.0.0
  - @shipfox/client-config@1.0.0
  - @shipfox/react-ui@0.3.2

## 0.2.0

### Minor Changes

- 3d064b8: Publishes the client runtime closure with shell, feature, route, Vite, and testing contracts.
- 6bc2e45: Adds the composable upstream client shell, feature catalog, and route manifests for every client feature.

### Patch Changes

- Updated dependencies [3d064b8]
  - @shipfox/client-api@0.2.0
  - @shipfox/client-config@0.2.0

## 0.0.2

### Patch Changes

- Updated dependencies [c18d624]
  - @shipfox/react-ui@0.3.1
  - @shipfox/client-config@0.0.2

## 0.0.1

- Add the private candidate client composition shell.
