# @shipfox/client-runners

## 17.0.1

### Patch Changes

- Updated dependencies [9e16946]
- Updated dependencies [4fa8526]
  - @shipfox/api-runners-dto@12.4.0

## 17.0.0

### Patch Changes

- Updated dependencies [4b0731e]
  - @shipfox/react-ui@1.2.0
  - @shipfox/client-ui@17.0.0
  - @shipfox/client-shell@17.0.0

## 16.0.0

### Patch Changes

- Updated dependencies [78b771c]
- Updated dependencies [80cde6b]
  - @shipfox/api-runners-dto@12.2.0
  - @shipfox/react-ui@1.1.0
  - @shipfox/client-ui@16.0.0
  - @shipfox/client-shell@16.0.0

## 14.0.1

### Patch Changes

- 6aa6c7a: Migrates the integrations, triggers, runners, and projects client surfaces to semantic spacing roles and enables `no-raw-spacing` for them. Adds the `gap-x-*` and `gap-y-*` axis roles and the `-mx-inline` bleed role so grids with differing column and row rhythm, and rows that cancel their own `px-tight`, stay on the density-aware scale.
- Updated dependencies [88bf8e8]
- Updated dependencies [6aa6c7a]
- Updated dependencies [5c56ba6]
  - @shipfox/react-ui@1.0.0
  - @shipfox/client-shell@14.0.1
  - @shipfox/client-ui@14.0.1

## 14.0.0

### Patch Changes

- Updated dependencies [baa7594]
- Updated dependencies [f8a98cb]
- Updated dependencies [1267eb3]
- Updated dependencies [b2d4550]
  - @shipfox/react-ui@0.5.0
  - @shipfox/client-ui@14.0.0
  - @shipfox/client-shell@14.0.0

## 13.0.0

### Major Changes

- e405e92: Move client routes to slug-based `/w/$workspaceSlug` and `/p/$projectSlug` URLs, enforce the new composition contract, and support bounded project-slug resolution.

### Patch Changes

- Updated dependencies [e405e92]
- Updated dependencies [f78740d]
- Updated dependencies [9969937]
- Updated dependencies [3c73365]
- Updated dependencies [54c820e]
- Updated dependencies [6adc228]
- Updated dependencies [e1efaee]
  - @shipfox/client-shell@13.0.0
  - @shipfox/client-ui@13.0.0
  - @shipfox/react-ui@0.4.0
  - @shipfox/api-runners-dto@12.0.0

## 12.0.2

### Patch Changes

- @shipfox/client-shell@12.0.2

## 12.0.1

### Patch Changes

- Updated dependencies [c9a188d]
- Updated dependencies [8678943]
- Updated dependencies [6be5a54]
  - @shipfox/api-runners-dto@10.2.0
  - @shipfox/client-shell@12.0.1

## 12.0.0

### Patch Changes

- Updated dependencies [96ae951]
  - @shipfox/client-shell@12.0.0

## 11.0.0

### Patch Changes

- Updated dependencies [662516d]
- Updated dependencies [e9280fc]
- Updated dependencies [837bf5d]
- Updated dependencies [3f5610b]
  - @shipfox/client-shell@11.0.0
  - @shipfox/api-runners-dto@10.0.0
  - @shipfox/client-api@6.0.1
  - @shipfox/client-ui@6.0.2
  - @shipfox/react-ui@0.3.7

## 10.0.1

### Patch Changes

- @shipfox/client-shell@10.0.1

## 10.0.0

### Patch Changes

- Updated dependencies [456c884]
  - @shipfox/client-shell@10.0.0

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
  - @shipfox/api-runners-dto@9.0.2
  - @shipfox/react-ui@0.3.7
  - @shipfox/client-ui@6.0.2
  - @shipfox/client-shell@6.0.2

## 6.0.1

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.
- Updated dependencies [475ce59]
- Updated dependencies [3f8f1cb]
  - @shipfox/api-runners-dto@9.0.1
  - @shipfox/client-api@6.0.1
  - @shipfox/client-shell@6.0.1
  - @shipfox/client-ui@6.0.1
  - @shipfox/react-ui@0.3.6

## 6.0.0

### Major Changes

- 32d4392: Converges manual-registration-token and provisioner-token client state on package-owned camelCase models validated at the transport boundary, replacing raw wire DTOs in the public hooks and mutation signatures.

### Minor Changes

- 401b583: Exposes typed feature-owned navigation and settings contributions and enforces coordinator-owned client composition.

### Patch Changes

- Updated dependencies [401b583]
- Updated dependencies [82eda45]
- Updated dependencies [cd90c19]
- Updated dependencies [24be269]
- Updated dependencies [c56c124]
- Updated dependencies [4a6d124]
- Updated dependencies [c02ac42]
  - @shipfox/client-shell@6.0.0
  - @shipfox/client-api@6.0.0
  - @shipfox/api-runners-dto@7.0.1
  - @shipfox/client-ui@6.0.0
  - @shipfox/react-ui@0.3.5

## 5.0.0

### Patch Changes

- f1d6465: Moves workspace-settings and project-workflow route ownership from centralized packages into each feature's own route module, so a feature package declares and ships its own settings pages.
- Updated dependencies [ffd727b]
  - @shipfox/client-shell@5.0.0

## 4.0.0

### Patch Changes

- Updated dependencies [2e5b718]
- Updated dependencies [6b4a575]
- Updated dependencies [781a45b]
  - @shipfox/client-ui@4.0.0
  - @shipfox/client-api@4.0.0

## 3.0.1

### Patch Changes

- ffc7fc9: Republishes the affected release set after recovering package publication.
- Updated dependencies [ffc7fc9]
  - @shipfox/api-runners-dto@7.0.1
  - @shipfox/client-ui@3.0.1
  - @shipfox/react-ui@0.3.5

## 3.0.0

### Patch Changes

- Updated dependencies [cb58afe]
- Updated dependencies [bc7cfdc]
  - @shipfox/react-ui@0.3.4
  - @shipfox/api-runners-dto@7.0.0
  - @shipfox/client-ui@3.0.0

## 2.0.0

### Patch Changes

- Updated dependencies [e52513c]
- Updated dependencies [b70f920]
- Updated dependencies [9006b75]
- Updated dependencies [3cda0c6]
- Updated dependencies [1820feb]
- Updated dependencies [8bdc149]
- Updated dependencies [795e293]
- Updated dependencies [e10c829]
- Updated dependencies [b00ed29]
- Updated dependencies [6741be8]
  - @shipfox/api-runners-dto@6.0.0
  - @shipfox/react-ui@0.3.3
  - @shipfox/client-ui@2.0.0

## 1.0.0

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.
- Updated dependencies [bb037af]
  - @shipfox/api-runners-dto@5.0.0
  - @shipfox/client-api@1.0.0
  - @shipfox/client-ui@1.0.0
  - @shipfox/react-ui@0.3.2

## 0.2.0

### Minor Changes

- 3d064b8: Publishes the client runtime closure with shell, feature, route, Vite, and testing contracts.

### Patch Changes

- Updated dependencies [3d064b8]
  - @shipfox/client-api@0.2.0
  - @shipfox/client-ui@0.2.0

## 0.0.5

### Patch Changes

- Updated dependencies [c18d624]
  - @shipfox/react-ui@0.3.1
  - @shipfox/client-ui@0.1.2

## 0.0.4

### Patch Changes

- Updated dependencies [1b0d344]
  - @shipfox/api-runners-dto@2.0.0
  - @shipfox/client-ui@0.1.1
  - @shipfox/client-api@0.0.1
  - @shipfox/react-ui@0.3.0

## 0.0.3

### Patch Changes

- 048fc29: Adds Runner Provisioners settings with provisioner token management and connection status.
- 6181819: Adds runner registration sessions with bounded label contracts, session-token auth, and lease-token heartbeat ownership.
- Updated dependencies [43d7996]
- Updated dependencies [14e0bea]
- Updated dependencies [8100b48]
- Updated dependencies [7a9943d]
- Updated dependencies [2325d76]
- Updated dependencies [9018f0b]
- Updated dependencies [7fdfd72]
- Updated dependencies [c0a883c]
- Updated dependencies [2a3193f]
- Updated dependencies [f104ff2]
- Updated dependencies [7341569]
- Updated dependencies [c47be09]
- Updated dependencies [f9f059e]
- Updated dependencies [e4c6abf]
- Updated dependencies [5d0676a]
- Updated dependencies [3afb7e3]
- Updated dependencies [a35c2dc]
- Updated dependencies [58f7aef]
- Updated dependencies [5264a22]
- Updated dependencies [247cbd6]
- Updated dependencies [9674879]
- Updated dependencies [225c9a5]
- Updated dependencies [fb64f13]
- Updated dependencies [62720ea]
- Updated dependencies [24f131b]
- Updated dependencies [bb2a7bc]
- Updated dependencies [5eb06d0]
- Updated dependencies [4e13e5f]
- Updated dependencies [e92150d]
- Updated dependencies [8037501]
- Updated dependencies [0fb6018]
- Updated dependencies [c27a1ed]
- Updated dependencies [b8e49ff]
- Updated dependencies [8037501]
- Updated dependencies [6c0da64]
- Updated dependencies [07f8ff8]
- Updated dependencies [e457582]
- Updated dependencies [8b5c905]
- Updated dependencies [f849131]
- Updated dependencies [88b9793]
- Updated dependencies [94bdcc5]
- Updated dependencies [a34c8ea]
- Updated dependencies [27770eb]
- Updated dependencies [2933c33]
- Updated dependencies [8ac4bf4]
- Updated dependencies [03d9eae]
- Updated dependencies [a5c7562]
- Updated dependencies [6181819]
- Updated dependencies [3a0be6b]
- Updated dependencies [d42baf4]
- Updated dependencies [8037501]
- Updated dependencies [54bb8a3]
- Updated dependencies [f711e18]
- Updated dependencies [8ecc121]
  - @shipfox/react-ui@0.3.0
  - @shipfox/api-runners-dto@0.1.0
  - @shipfox/client-api@0.0.1
  - @shipfox/client-ui@0.1.0

## 0.0.2

### Patch Changes

- Updated dependencies [5c1e777]
  - @shipfox/react-ui@0.2.0

## 0.0.1

### Patch Changes

- Updated dependencies [2311e15]
  - @shipfox/react-ui@0.1.1
  - @shipfox/api-runners-dto@0.0.0
  - @shipfox/client-api@0.0.0
