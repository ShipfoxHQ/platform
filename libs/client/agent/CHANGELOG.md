# @shipfox/client-agent

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

- 102c5f4: Isolates private browser state and React Query data across authenticated principal transitions.
- Updated dependencies [4b85404]
- Updated dependencies [102c5f4]
  - @shipfox/api-agent-dto@9.0.2
  - @shipfox/react-ui@0.3.7
  - @shipfox/client-ui@6.0.2
  - @shipfox/client-shell@6.0.2

## 6.0.1

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.
- 3f8f1cb: Enforces typed route-input and browser-storage boundaries across client features.
- Updated dependencies [475ce59]
- Updated dependencies [3f8f1cb]
  - @shipfox/api-agent-dto@9.0.1
  - @shipfox/client-api@6.0.1
  - @shipfox/client-shell@6.0.1
  - @shipfox/client-ui@6.0.1
  - @shipfox/react-ui@0.3.6

## 6.0.0

### Major Changes

- e009149: Converges Agent model-provider queries and commands on client domain models.
- 24be269: Makes checked API adapters the only public business-response boundary and returns package-owned domain models from Agent, Integrations, and Workflows adapters.

### Minor Changes

- 401b583: Exposes typed feature-owned navigation and settings contributions and enforces coordinator-owned client composition.

### Patch Changes

- d784a07: Enforces checked client API responses and removes stale transport compatibility helpers.
- fa07be9: Enforces client architecture boundaries with Biome plugins and migrates the Agent presentation DTO import.
- 46aa52f: Closes remaining API package-boundary exceptions and moves model-provider policy behind the Agent implementation boundary.
- c097dff: Adds an internal domain-model core (harnesses, providers, onboarding and management-modal state) and a DTO-to-domain mapper for model providers, ahead of converging the package's scattered provider/model shapes onto it.
- Updated dependencies [401b583]
- Updated dependencies [82eda45]
- Updated dependencies [cd90c19]
- Updated dependencies [24be269]
- Updated dependencies [c56c124]
- Updated dependencies [46aa52f]
- Updated dependencies [4a6d124]
- Updated dependencies [c02ac42]
  - @shipfox/client-shell@6.0.0
  - @shipfox/client-api@6.0.0
  - @shipfox/api-agent-dto@9.0.0
  - @shipfox/client-ui@6.0.0
  - @shipfox/react-ui@0.3.5

## 5.0.0

### Minor Changes

- 8d8cdef: Extracts workspace onboarding into a dedicated coordinator and shares its feature query policies.

### Patch Changes

- f1d6465: Moves workspace-settings and project-workflow route ownership from centralized packages into each feature's own route module, so a feature package declares and ships its own settings pages.
- Updated dependencies [de559bb]
- Updated dependencies [ffd727b]
  - @shipfox/api-agent-dto@8.0.0
  - @shipfox/client-shell@5.0.0

## 4.0.0

### Patch Changes

- 2e5b718: Adds safe browser persistence and bounded callback deduplication across client flows.
- Updated dependencies [2e5b718]
- Updated dependencies [6b4a575]
- Updated dependencies [11b10f7]
- Updated dependencies [781a45b]
  - @shipfox/client-ui@4.0.0
  - @shipfox/client-shell@4.0.0
  - @shipfox/client-api@4.0.0

## 3.0.1

### Patch Changes

- ffc7fc9: Republishes the affected release set after recovering package publication.
- Updated dependencies [ffc7fc9]
  - @shipfox/client-shell@3.0.1
  - @shipfox/client-ui@3.0.1
  - @shipfox/react-ui@0.3.5

## 3.0.0

### Patch Changes

- Updated dependencies [cb58afe]
- Updated dependencies [d735fe3]
- Updated dependencies [5b06cd5]
  - @shipfox/react-ui@0.3.4
  - @shipfox/client-shell@3.0.0
  - @shipfox/client-ui@3.0.0

## 2.0.0

### Patch Changes

- Updated dependencies [0bb82a4]
- Updated dependencies [1820feb]
- Updated dependencies [7ac43a4]
  - @shipfox/api-agent-dto@6.0.0
  - @shipfox/react-ui@0.3.3
  - @shipfox/client-shell@2.0.0
  - @shipfox/client-ui@2.0.0

## 1.0.0

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.
- Updated dependencies [47809a2]
- Updated dependencies [bb037af]
- Updated dependencies [5c63a2a]
- Updated dependencies [d8658ba]
  - @shipfox/client-shell@1.0.0
  - @shipfox/api-agent-dto@5.0.0
  - @shipfox/client-api@1.0.0
  - @shipfox/client-ui@1.0.0
  - @shipfox/react-ui@0.3.2

## 0.2.0

### Minor Changes

- 3d064b8: Publishes the client runtime closure with shell, feature, route, Vite, and testing contracts.
- 6bc2e45: Adds the composable upstream client shell, feature catalog, and route manifests for every client feature.

### Patch Changes

- Updated dependencies [3d064b8]
- Updated dependencies [6bc2e45]
  - @shipfox/client-api@0.2.0
  - @shipfox/client-shell@0.2.0
  - @shipfox/client-ui@0.2.0

## 0.1.2

### Patch Changes

- Updated dependencies [c18d624]
  - @shipfox/react-ui@0.3.1
  - @shipfox/client-ui@0.1.2
  - @shipfox/api-agent-dto@3.0.0

## 0.1.1

### Patch Changes

- Updated dependencies [1b0d344]
  - @shipfox/api-agent-dto@2.0.0
  - @shipfox/client-ui@0.1.1
  - @shipfox/client-api@0.0.1
  - @shipfox/react-ui@0.3.0

## 0.1.0

### Minor Changes

- 067a260: Adds workspace model provider settings for configuring, testing, defaulting, and deleting provider credentials.
- 1b9d909: Add a workflow example usage modal for configured model providers, with model selection, ready-to-copy workflow YAML, model id browsing, and automatic opening after first configuration.

### Patch Changes

- Updated dependencies [067a260]
- Updated dependencies [43d7996]
- Updated dependencies [14e0bea]
- Updated dependencies [9018f0b]
- Updated dependencies [7fdfd72]
- Updated dependencies [2a3193f]
- Updated dependencies [de54da2]
- Updated dependencies [7ca4c65]
- Updated dependencies [f104ff2]
- Updated dependencies [7341569]
- Updated dependencies [5bcdbf4]
- Updated dependencies [e4c6abf]
- Updated dependencies [aca162b]
- Updated dependencies [5d0676a]
- Updated dependencies [a35c2dc]
- Updated dependencies [58f7aef]
- Updated dependencies [5264a22]
- Updated dependencies [9674879]
- Updated dependencies [225c9a5]
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
- Updated dependencies [94bdcc5]
- Updated dependencies [a34c8ea]
- Updated dependencies [27770eb]
- Updated dependencies [8ac4bf4]
- Updated dependencies [3a0be6b]
- Updated dependencies [282e66a]
- Updated dependencies [d42baf4]
- Updated dependencies [8037501]
- Updated dependencies [54bb8a3]
- Updated dependencies [f711e18]
  - @shipfox/api-agent-dto@0.1.0
  - @shipfox/react-ui@0.3.0
  - @shipfox/client-api@0.0.1
  - @shipfox/client-ui@0.1.0
