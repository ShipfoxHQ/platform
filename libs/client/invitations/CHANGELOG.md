# @shipfox/client-invitations

## 10.0.1

### Patch Changes

- Updated dependencies [10cf63c]
- Updated dependencies [7b6a409]
  - @shipfox/api-auth-dto@9.3.0
  - @shipfox/api-workspaces-dto@9.3.0
  - @shipfox/client-shell@10.0.1

## 10.0.0

### Patch Changes

- Updated dependencies [456c884]
  - @shipfox/api-auth-dto@9.2.0
  - @shipfox/client-shell@10.0.0
  - @shipfox/api-workspaces-dto@9.2.0

## 9.0.0

### Patch Changes

- Updated dependencies [56e2c58]
- Updated dependencies [87170f8]
  - @shipfox/client-shell@9.0.0

## 8.0.0

### Patch Changes

- Updated dependencies [289d686]
  - @shipfox/client-shell@8.0.0

## 6.0.2

### Patch Changes

- Updated dependencies [4b85404]
- Updated dependencies [102c5f4]
  - @shipfox/api-auth-dto@9.0.2
  - @shipfox/api-workspaces-dto@9.0.2
  - @shipfox/react-ui@0.3.7
  - @shipfox/client-ui@6.0.2
  - @shipfox/client-shell@6.0.2

## 6.0.1

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.
- 3f8f1cb: Enforces typed route-input and browser-storage boundaries across client features.
- Updated dependencies [475ce59]
- Updated dependencies [3f8f1cb]
  - @shipfox/api-auth-dto@9.0.1
  - @shipfox/api-workspaces-dto@9.0.1
  - @shipfox/client-api@6.0.1
  - @shipfox/client-shell@6.0.1
  - @shipfox/client-ui@6.0.1
  - @shipfox/react-ui@0.3.6

## 6.0.0

### Patch Changes

- c56c124: Converges auth sessions and invitation responses on checked domain boundaries.
- Updated dependencies [401b583]
- Updated dependencies [82eda45]
- Updated dependencies [9c9d266]
- Updated dependencies [cd90c19]
- Updated dependencies [24be269]
- Updated dependencies [c56c124]
- Updated dependencies [4a6d124]
- Updated dependencies [c02ac42]
  - @shipfox/client-shell@6.0.0
  - @shipfox/api-workspaces-dto@9.0.0
  - @shipfox/client-api@6.0.0
  - @shipfox/api-auth-dto@7.1.0
  - @shipfox/client-ui@6.0.0
  - @shipfox/react-ui@0.3.5

## 5.0.0

### Major Changes

- ffd727b: Converges auth session and invitation state onto shared camelCase domain types validated at the API boundary, replacing the raw snake_case DTOs previously returned by login, signup, password reset, email verification, workspace creation, and invitation preview. `AuthState.user`, `useRefreshAuth()`, and `usePreviewInvitation()` now resolve to `UserIdentity`/`AuthenticatedSession`/`InvitationPreview` shapes (for example `accessToken` instead of `token`, `workspaceName` instead of `workspace_name`). Also moves the shared `AuthShell` component and session mapping helpers into `@shipfox/client-shell`, breaking the former `client-auth` ↔ `client-invitations` circular dependency.

### Patch Changes

- 79df9d1: Fixes invitation query declarations for packed TypeScript consumers.
- Updated dependencies [ffd727b]
  - @shipfox/client-shell@5.0.0

## 4.0.0

### Patch Changes

- 2e5b718: Adds safe browser persistence and bounded callback deduplication across client flows.
- Updated dependencies [2e5b718]
- Updated dependencies [769d919]
- Updated dependencies [6b4a575]
- Updated dependencies [20e4feb]
- Updated dependencies [11b10f7]
- Updated dependencies [781a45b]
  - @shipfox/client-ui@4.0.0
  - @shipfox/client-shell@4.0.0
  - @shipfox/api-auth-dto@7.1.0
  - @shipfox/client-api@4.0.0
  - @shipfox/client-auth@4.0.0

## 3.0.1

### Patch Changes

- ffc7fc9: Republishes the affected release set after recovering package publication.
- Updated dependencies [ffc7fc9]
  - @shipfox/client-auth@3.0.1
  - @shipfox/client-shell@3.0.1
  - @shipfox/react-ui@0.3.5

## 3.0.0

### Patch Changes

- Updated dependencies [cb58afe]
- Updated dependencies [d735fe3]
- Updated dependencies [5b06cd5]
  - @shipfox/react-ui@0.3.4
  - @shipfox/client-shell@3.0.0
  - @shipfox/client-auth@3.0.0

## 2.0.0

### Patch Changes

- Updated dependencies [e6eba5b]
- Updated dependencies [ba2e3dc]
- Updated dependencies [1820feb]
- Updated dependencies [7ac43a4]
- Updated dependencies [1b79cda]
- Updated dependencies [c2db8c3]
- Updated dependencies [112c0fa]
- Updated dependencies [326f4c0]
- Updated dependencies [4a91956]
  - @shipfox/api-auth-dto@6.0.0
  - @shipfox/client-auth@2.0.0
  - @shipfox/react-ui@0.3.3
  - @shipfox/client-shell@2.0.0
  - @shipfox/api-workspaces-dto@6.0.0

## 1.0.0

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.
- Updated dependencies [47809a2]
- Updated dependencies [bb037af]
- Updated dependencies [5c63a2a]
- Updated dependencies [d8658ba]
  - @shipfox/client-shell@1.0.0
  - @shipfox/api-auth-dto@5.0.0
  - @shipfox/api-workspaces-dto@5.0.0
  - @shipfox/client-api@1.0.0
  - @shipfox/client-auth@1.0.0
  - @shipfox/react-ui@0.3.2

## 0.2.0

### Minor Changes

- 3d064b8: Publishes the client runtime closure with shell, feature, route, Vite, and testing contracts.
- 6bc2e45: Adds the composable upstream client shell, feature catalog, and route manifests for every client feature.

### Patch Changes

- Updated dependencies [3d064b8]
- Updated dependencies [6bc2e45]
  - @shipfox/client-api@0.2.0
  - @shipfox/client-auth@0.2.0
  - @shipfox/client-shell@0.2.0

## 0.0.5

### Patch Changes

- Updated dependencies [c18d624]
  - @shipfox/react-ui@0.3.1
  - @shipfox/client-auth@0.0.5

## 0.0.4

### Patch Changes

- Updated dependencies [1b0d344]
  - @shipfox/api-auth-dto@2.0.0
  - @shipfox/api-workspaces-dto@2.0.0
  - @shipfox/client-auth@0.0.4
  - @shipfox/client-api@0.0.1
  - @shipfox/react-ui@0.3.0

## 0.0.3

### Patch Changes

- Updated dependencies [43d7996]
- Updated dependencies [14e0bea]
- Updated dependencies [d02c5fd]
- Updated dependencies [9018f0b]
- Updated dependencies [7fdfd72]
- Updated dependencies [c0a883c]
- Updated dependencies [72ce351]
- Updated dependencies [2a3193f]
- Updated dependencies [f104ff2]
- Updated dependencies [7341569]
- Updated dependencies [e250c4c]
- Updated dependencies [e4c6abf]
- Updated dependencies [5d0676a]
- Updated dependencies [3afb7e3]
- Updated dependencies [a35c2dc]
- Updated dependencies [58f7aef]
- Updated dependencies [5264a22]
- Updated dependencies [9674879]
- Updated dependencies [225c9a5]
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
- Updated dependencies [362b3eb]
- Updated dependencies [b8e49ff]
- Updated dependencies [8037501]
- Updated dependencies [6c0da64]
- Updated dependencies [07f8ff8]
- Updated dependencies [e457582]
- Updated dependencies [8b5c905]
- Updated dependencies [f849131]
- Updated dependencies [94bdcc5]
- Updated dependencies [a34c8ea]
- Updated dependencies [27770eb]
- Updated dependencies [8ac4bf4]
- Updated dependencies [6181819]
- Updated dependencies [3a0be6b]
- Updated dependencies [d42baf4]
- Updated dependencies [8037501]
- Updated dependencies [54bb8a3]
- Updated dependencies [f711e18]
  - @shipfox/react-ui@0.3.0
  - @shipfox/api-auth-dto@0.1.0
  - @shipfox/api-workspaces-dto@0.1.0
  - @shipfox/client-api@0.0.1
  - @shipfox/client-auth@0.0.3

## 0.0.2

### Patch Changes

- Updated dependencies [5c1e777]
  - @shipfox/react-ui@0.2.0
  - @shipfox/client-auth@0.0.2

## 0.0.1

### Patch Changes

- Updated dependencies [2311e15]
  - @shipfox/react-ui@0.1.1
  - @shipfox/client-auth@0.0.1
  - @shipfox/api-auth-dto@0.0.0
  - @shipfox/api-workspaces-dto@0.0.0
  - @shipfox/client-api@0.0.0
