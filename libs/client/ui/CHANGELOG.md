# @shipfox/client-ui

## 21.0.0

### Patch Changes

- Updated dependencies [0f4abe4]
- Updated dependencies [71d0c44]
- Updated dependencies [30beb8f]
- Updated dependencies [16733a7]
- Updated dependencies [163c40a]
- Updated dependencies [6703982]
- Updated dependencies [f1d127e]
  - @shipfox/react-ui@2.0.0

## 17.0.0

### Minor Changes

- 4b0731e: Adds workflow troubleshooting details, evaluation traces, failure annotations, runner context, step output metadata, and lazy paginated annotation summaries.

### Patch Changes

- Updated dependencies [4b0731e]
  - @shipfox/annotations-dto@12.3.0
  - @shipfox/react-ui@1.2.0

## 16.0.0

### Minor Changes

- 80cde6b: Render run annotations in the run workspace. `AnnotationCard` gains an optional context title, provenance, and action, and bounds a long body behind a disclosure. The run's Annotations section is now the only surface that renders an annotation body, ranked by severity and then emission order, with the job page linking to it through a bounded count chip.

  `Markdown` tables now size to their content instead of stretching to the container, so a two-column table no longer puts a cell the width of the page away from its row header.

### Patch Changes

- Updated dependencies [80cde6b]
  - @shipfox/react-ui@1.1.0

## 14.0.1

### Patch Changes

- Updated dependencies [88bf8e8]
- Updated dependencies [6aa6c7a]
- Updated dependencies [5c56ba6]
  - @shipfox/react-ui@1.0.0

## 14.0.0

### Patch Changes

- f8a98cb: Publish the shared UI component artifacts and release `@shipfox/client-ui` with the updated shared UI dependency so fresh consumers and Storybook resolve component subpaths without configuration overrides.
- Updated dependencies [baa7594]
- Updated dependencies [f8a98cb]
- Updated dependencies [1267eb3]
- Updated dependencies [b2d4550]
  - @shipfox/react-ui@0.5.0

## 13.0.0

### Minor Changes

- 3c73365: Add project settings, shared slug rename warnings, and live slug availability checks.

### Patch Changes

- f78740d: Remove Unicode dash punctuation from package prose and source comments.
- Updated dependencies [f78740d]
- Updated dependencies [9969937]
- Updated dependencies [6adc228]
  - @shipfox/react-ui@0.4.0
  - @shipfox/annotations-dto@12.0.0

## 6.0.2

### Patch Changes

- 102c5f4: Isolates private browser state and React Query data across authenticated principal transitions.
- Updated dependencies [4b85404]
- Updated dependencies [102c5f4]
  - @shipfox/annotations-dto@9.0.2
  - @shipfox/regex@0.2.4
  - @shipfox/react-ui@0.3.7

## 6.0.1

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.
- 3f8f1cb: Enforces typed route-input and browser-storage boundaries across client features.
- Updated dependencies [8436596]
- Updated dependencies [475ce59]
- Updated dependencies [3f8f1cb]
  - @shipfox/regex@0.2.3
  - @shipfox/annotations-dto@9.0.1
  - @shipfox/client-api@6.0.1
  - @shipfox/react-ui@0.3.6

## 6.0.0

### Patch Changes

- Updated dependencies [24be269]
- Updated dependencies [c02ac42]
  - @shipfox/client-api@6.0.0
  - @shipfox/annotations-dto@6.0.0
  - @shipfox/regex@0.2.2
  - @shipfox/react-ui@0.3.5

## 4.0.0

### Minor Changes

- 2e5b718: Adds safe browser persistence and bounded callback deduplication across client flows.

### Patch Changes

- Updated dependencies [6b4a575]
- Updated dependencies [781a45b]
  - @shipfox/client-api@4.0.0

## 3.0.1

### Patch Changes

- ffc7fc9: Republishes the affected release set after recovering package publication.
- Updated dependencies [ffc7fc9]
  - @shipfox/react-ui@0.3.5

## 3.0.0

### Patch Changes

- Updated dependencies [cb58afe]
  - @shipfox/react-ui@0.3.4

## 2.0.0

### Patch Changes

- Updated dependencies [9cb2442]
- Updated dependencies [1820feb]
  - @shipfox/annotations-dto@6.0.0
  - @shipfox/react-ui@0.3.3

## 1.0.0

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.
- Updated dependencies [bb037af]
  - @shipfox/annotations-dto@5.0.0
  - @shipfox/client-api@1.0.0
  - @shipfox/react-ui@0.3.2
  - @shipfox/regex@0.2.2

## 0.2.0

### Minor Changes

- 3d064b8: Publishes the client runtime closure with shell, feature, route, Vite, and testing contracts.

### Patch Changes

- Updated dependencies [3d064b8]
  - @shipfox/client-api@0.2.0

## 0.1.2

### Patch Changes

- Updated dependencies [c18d624]
  - @shipfox/react-ui@0.3.1

## 0.1.1

### Patch Changes

- Updated dependencies [1b0d344]
  - @shipfox/annotations-dto@2.0.0
  - @shipfox/regex@0.2.1
  - @shipfox/client-api@0.0.1
  - @shipfox/react-ui@0.3.0

## 0.1.0

### Minor Changes

- 24f131b: Standardize "failed to load" states across client surfaces. Adds an `EmptyState`
  primitive and a presentational `LoadErrorState` to `@shipfox/react-ui`, and a new
  `@shipfox/client-ui` package with `loadErrorCopy` (friendly, leak-free error copy)
  and a `QueryLoadError` wrapper. Failed data loads now render a calm placeholder
  with a labeled Retry instead of a red alert that leaked the raw request URL, and
  the placeholder is only shown when no data was ever loaded so a failed refetch no
  longer wipes stale content.

### Patch Changes

- 27770eb: Tightens signup, workspace, and project display-name validation with shared trimming, control and format-character rejection, length limits, and contextual client form errors.
- Updated dependencies [43d7996]
- Updated dependencies [14e0bea]
- Updated dependencies [5707d6d]
- Updated dependencies [9018f0b]
- Updated dependencies [7fdfd72]
- Updated dependencies [2a3193f]
- Updated dependencies [7b175f5]
- Updated dependencies [f104ff2]
- Updated dependencies [7341569]
- Updated dependencies [e4c6abf]
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
- Updated dependencies [d42baf4]
- Updated dependencies [8037501]
- Updated dependencies [54bb8a3]
- Updated dependencies [f711e18]
  - @shipfox/react-ui@0.3.0
  - @shipfox/annotations-dto@0.0.1
  - @shipfox/regex@0.2.0
  - @shipfox/client-api@0.0.1
