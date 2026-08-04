# @shipfox/client-triggers

## 14.0.1

### Patch Changes

- 6aa6c7a: Migrates the integrations, triggers, runners, and projects client surfaces to semantic spacing roles and enables `no-raw-spacing` for them. Adds the `gap-x-*` and `gap-y-*` axis roles and the `-mx-inline` bleed role so grids with differing column and row rhythm, and rows that cancel their own `px-tight`, stay on the density-aware scale.
- Updated dependencies [88bf8e8]
- Updated dependencies [6aa6c7a]
- Updated dependencies [5c56ba6]
  - @shipfox/react-ui@1.0.0
  - @shipfox/client-shell@14.0.1
  - @shipfox/client-projects@14.0.1
  - @shipfox/client-ui@14.0.1
  - @shipfox/integration-icons@0.3.1

## 14.0.0

### Patch Changes

- Updated dependencies [baa7594]
- Updated dependencies [f8a98cb]
- Updated dependencies [1267eb3]
- Updated dependencies [b2d4550]
  - @shipfox/react-ui@0.5.0
  - @shipfox/client-ui@14.0.0
  - @shipfox/integration-icons@0.3.0
  - @shipfox/client-projects@14.0.0
  - @shipfox/client-shell@14.0.0

## 13.0.0

### Major Changes

- e405e92: Move client routes to slug-based `/w/$workspaceSlug` and `/p/$projectSlug` URLs, enforce the new composition contract, and support bounded project-slug resolution.

### Patch Changes

- Updated dependencies [e405e92]
- Updated dependencies [f78740d]
- Updated dependencies [9969937]
- Updated dependencies [9fdd5e4]
- Updated dependencies [3c73365]
- Updated dependencies [4eb18b8]
- Updated dependencies [54c820e]
- Updated dependencies [6adc228]
- Updated dependencies [e1efaee]
  - @shipfox/client-projects@13.0.0
  - @shipfox/client-shell@13.0.0
  - @shipfox/client-ui@13.0.0
  - @shipfox/react-ui@0.4.0
  - @shipfox/integration-icons@0.2.3

## 12.0.2

### Patch Changes

- @shipfox/client-shell@12.0.2

## 12.0.1

### Patch Changes

- @shipfox/client-shell@12.0.1

## 12.0.0

### Patch Changes

- Updated dependencies [96ae951]
  - @shipfox/client-shell@12.0.0

## 11.0.0

### Patch Changes

- Updated dependencies [662516d]
- Updated dependencies [e9280fc]
  - @shipfox/client-shell@11.0.0
  - @shipfox/client-api@6.0.1
  - @shipfox/client-ui@6.0.2
  - @shipfox/integration-icons@0.2.2
  - @shipfox/react-ui@0.3.7
  - @shipfox/api-triggers-dto@9.0.2

## 10.0.1

### Patch Changes

- @shipfox/client-shell@10.0.1

## 10.0.0

### Patch Changes

- Updated dependencies [456c884]
  - @shipfox/client-shell@10.0.0

## 9.0.0

### Patch Changes

- 87170f8: Move event payload scrolling to the detail rail and bound the desktop rail to the available viewport height.
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
  - @shipfox/api-triggers-dto@9.0.2
  - @shipfox/react-ui@0.3.7
  - @shipfox/client-ui@6.0.2
  - @shipfox/client-shell@6.0.2
  - @shipfox/integration-icons@0.2.2

## 6.0.1

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.
- Updated dependencies [475ce59]
- Updated dependencies [3f8f1cb]
  - @shipfox/api-triggers-dto@9.0.1
  - @shipfox/client-api@6.0.1
  - @shipfox/client-shell@6.0.1
  - @shipfox/client-ui@6.0.1
  - @shipfox/integration-icons@0.2.1
  - @shipfox/react-ui@0.3.6

## 6.0.0

### Minor Changes

- 401b583: Exposes typed feature-owned navigation and settings contributions and enforces coordinator-owned client composition.

### Patch Changes

- f2d50a8: Extracts shared integration provider icons into a leaf package so client features can render them without depending on integration routing code.
- Updated dependencies [401b583]
- Updated dependencies [82eda45]
- Updated dependencies [f2d50a8]
- Updated dependencies [cd90c19]
- Updated dependencies [24be269]
- Updated dependencies [c56c124]
- Updated dependencies [4a6d124]
- Updated dependencies [c02ac42]
  - @shipfox/client-shell@6.0.0
  - @shipfox/integration-icons@0.2.0
  - @shipfox/client-api@6.0.0
  - @shipfox/api-triggers-dto@5.0.0
  - @shipfox/client-ui@6.0.0
  - @shipfox/react-ui@0.3.5

## 5.0.0

### Patch Changes

- f1d6465: Moves workspace-settings and project-workflow route ownership from centralized packages into each feature's own route module, so a feature package declares and ships its own settings pages.
- Updated dependencies [8d8cdef]
- Updated dependencies [ffd727b]
- Updated dependencies [f1d6465]
  - @shipfox/client-integrations@5.0.0
  - @shipfox/client-shell@5.0.0

## 4.0.0

### Patch Changes

- Updated dependencies [2e5b718]
- Updated dependencies [6b4a575]
- Updated dependencies [781a45b]
  - @shipfox/client-ui@4.0.0
  - @shipfox/client-integrations@4.0.0
  - @shipfox/client-api@4.0.0

## 3.0.1

### Patch Changes

- ffc7fc9: Republishes the affected release set after recovering package publication.
- Updated dependencies [ffc7fc9]
  - @shipfox/client-integrations@3.0.1
  - @shipfox/client-ui@3.0.1
  - @shipfox/react-ui@0.3.5

## 3.0.0

### Patch Changes

- Updated dependencies [cb58afe]
  - @shipfox/react-ui@0.3.4
  - @shipfox/client-integrations@3.0.0
  - @shipfox/client-ui@3.0.0

## 2.0.0

### Patch Changes

- Updated dependencies [1820feb]
- Updated dependencies [1820feb]
  - @shipfox/react-ui@0.3.3
  - @shipfox/client-integrations@2.0.0
  - @shipfox/client-ui@2.0.0

## 1.0.0

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.
- Updated dependencies [bb037af]
  - @shipfox/api-triggers-dto@5.0.0
  - @shipfox/client-api@1.0.0
  - @shipfox/client-integrations@1.0.0
  - @shipfox/client-ui@1.0.0
  - @shipfox/react-ui@0.3.2

## 0.2.0

### Minor Changes

- 3d064b8: Publishes the client runtime closure with shell, feature, route, Vite, and testing contracts.

### Patch Changes

- Updated dependencies [3d064b8]
- Updated dependencies [6bc2e45]
  - @shipfox/client-api@0.2.0
  - @shipfox/client-integrations@0.2.0
  - @shipfox/client-ui@0.2.0

## 0.1.2

### Patch Changes

- Updated dependencies [c18d624]
  - @shipfox/react-ui@0.3.1
  - @shipfox/client-integrations@0.1.2
  - @shipfox/client-ui@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [1b0d344]
  - @shipfox/api-triggers-dto@2.0.0
  - @shipfox/client-ui@0.1.1
  - @shipfox/client-integrations@0.1.1
  - @shipfox/client-api@0.0.1
  - @shipfox/react-ui@0.3.0

## 0.1.0

### Minor Changes

- e4c6abf: Add reusable, source-keyed icon building blocks so any surface can render an integration or trigger icon without re-implementing the catalog lookup and fallback.

  `@shipfox/client-integrations` exposes `getIntegrationIcon(source)` and `<IntegrationIcon source />`, resolving an integration source (a connection `provider`, a run `trigger_source`, or a trigger event `source`) against the central `PROVIDER_CATALOG` with a neutral `componentLine` fallback. The catalog stays the single place each integration declares its icon; the integration gallery now renders `<IntegrationIcon>` instead of an inline lookup (no behavior change).

  New `@shipfox/client-triggers` package adds `getTriggerSourceIcon(source)` and `<TriggerSourceIcon source />`, built on the integration resolver. It recognizes the system trigger sources `manual` (a person fired the run) and `cron` (a schedule), and delegates every other source to the integration catalog. This is the building block for showing an icon on run rows and trigger events; adopting it on those surfaces lands separately.

- 2c352bb: Add the trigger events data layer to `@shipfox/client-triggers`: transport
  functions, colocated query keys, and React Query hooks for the workspace Events
  view. `useTriggerEventsInfiniteQuery(workspaceId, filters)` paginates the event
  history newest-first with cursor-based infinite scroll, and `useTriggerEventQuery(id)`
  loads a single event with its routing decisions. Filters (`source`, `event`,
  `outcome`, `from`, `to`) are normalized into a stable cache key so an out-of-order
  or duplicated `outcome` selection reuses the same cache entry. Consumes the
  `@shipfox/api-triggers-dto` contracts; no UI yet.
- e5d2f13: Add the workspace **Events** page in Settings: a filterable, cursor-paginated table of
  trigger events (status dot, source/event, routing summary, delivery id, received time)
  mounted at `/workspaces/$wid/settings/events` and wired into the settings sub-nav. Filters
  (date range, source, event, outcome) live in the URL via `validateSearch`, so a filtered
  view is shareable. Source and event filters are populated by a new
  `GET /trigger-events/facets` endpoint that returns each workspace's distinct source/event
  values with counts (top 50, backed by `(workspace_id, source)` / `(workspace_id, event)`
  indexes); the list still renders if facets fail to load.
- a460020: Add trigger event detail decisions with stored subscription names, run links, and payload inspection.

### Patch Changes

- Updated dependencies [43d7996]
- Updated dependencies [14e0bea]
- Updated dependencies [9018f0b]
- Updated dependencies [7fdfd72]
- Updated dependencies [2a3193f]
- Updated dependencies [f104ff2]
- Updated dependencies [7341569]
- Updated dependencies [d245be8]
- Updated dependencies [0f06c02]
- Updated dependencies [e4c6abf]
- Updated dependencies [e4c6abf]
- Updated dependencies [e5d2f13]
- Updated dependencies [a982f20]
- Updated dependencies [5d0676a]
- Updated dependencies [a460020]
- Updated dependencies [a35c2dc]
- Updated dependencies [58f7aef]
- Updated dependencies [5264a22]
- Updated dependencies [9674879]
- Updated dependencies [225c9a5]
- Updated dependencies [42443b4]
- Updated dependencies [24f131b]
- Updated dependencies [bb2a7bc]
- Updated dependencies [63bcac8]
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
- Updated dependencies [e192d86]
- Updated dependencies [5ec8367]
- Updated dependencies [f849131]
- Updated dependencies [a7da648]
- Updated dependencies [94bdcc5]
- Updated dependencies [a34c8ea]
- Updated dependencies [27770eb]
- Updated dependencies [8ac4bf4]
- Updated dependencies [3a0be6b]
- Updated dependencies [d42baf4]
- Updated dependencies [8037501]
- Updated dependencies [54bb8a3]
- Updated dependencies [f711e18]
  - @shipfox/client-integrations@0.1.0
  - @shipfox/react-ui@0.3.0
  - @shipfox/api-triggers-dto@0.1.0
  - @shipfox/client-api@0.0.1
  - @shipfox/client-ui@0.1.0
