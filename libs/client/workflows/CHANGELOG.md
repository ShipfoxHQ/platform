# @shipfox/client-workflows

## 18.0.0

### Minor Changes

- 5b1838c: Expose actionable status reasons and messages when materialized job outputs cannot be persisted.

### Patch Changes

- cd6fef9: Lets the run job rail use available height and exposes overflow when the job list scrolls.
- Updated dependencies [5b1838c]
  - @shipfox/api-workflows-dto@12.5.0

## 17.0.0

### Minor Changes

- 4b0731e: Adds workflow troubleshooting details, evaluation traces, failure annotations, runner context, step output metadata, and lazy paginated annotation summaries.

### Patch Changes

- 7b2436c: Migrates the workflow client surfaces to semantic spacing roles.
- Updated dependencies [4b0731e]
  - @shipfox/api-workflows-dto@12.3.0
  - @shipfox/annotations-dto@12.3.0
  - @shipfox/client-logs@17.0.0
  - @shipfox/react-ui@1.2.0
  - @shipfox/client-ui@17.0.0
  - @shipfox/client-projects@17.0.0
  - @shipfox/client-shell@17.0.0
  - @shipfox/client-triggers@17.0.0
  - @shipfox/api-definitions-dto@12.3.0

## 16.0.0

### Minor Changes

- 80cde6b: Render run annotations in the run workspace. `AnnotationCard` gains an optional context title, provenance, and action, and bounds a long body behind a disclosure. The run's Annotations section is now the only surface that renders an annotation body, ranked by severity and then emission order, with the job page linking to it through a bounded count chip.

  `Markdown` tables now size to their content instead of stretching to the container, so a two-column table no longer puts a cell the width of the page away from its row header.

### Patch Changes

- Updated dependencies [80cde6b]
- Updated dependencies [ce0984d]
  - @shipfox/react-ui@1.1.0
  - @shipfox/client-ui@16.0.0
  - @shipfox/api-workflows-dto@12.2.0
  - @shipfox/client-projects@16.0.0
  - @shipfox/client-logs@16.0.0
  - @shipfox/client-shell@16.0.0
  - @shipfox/client-triggers@16.0.0
  - @shipfox/api-definitions-dto@12.2.0

## 15.0.0

### Minor Changes

- b591a78: Add dedicated log-first job pages inside a shared run workspace, with persistent run navigation, job metadata, attempt-aware deep links, and a graph-first all-jobs Summary.

### Patch Changes

- b591a78: Report a run that is waiting for a runner as `Queued` rather than as running. The run header
  and the run list now split queue time from run time, name the job a queued run is blocked on,
  and read the same rule from the jobs each surface already carries.
  - @shipfox/client-projects@15.0.0
  - @shipfox/api-definitions-dto@12.0.0
  - @shipfox/api-workflows-dto@12.1.0
  - @shipfox/client-api@6.0.1
  - @shipfox/client-logs@14.0.1
  - @shipfox/client-shell@14.0.1
  - @shipfox/client-triggers@15.0.0
  - @shipfox/client-ui@14.0.1
  - @shipfox/react-ui@1.0.0

## 14.0.1

### Patch Changes

- Updated dependencies [88bf8e8]
- Updated dependencies [6aa6c7a]
- Updated dependencies [5c56ba6]
  - @shipfox/react-ui@1.0.0
  - @shipfox/client-shell@14.0.1
  - @shipfox/client-logs@14.0.1
  - @shipfox/client-triggers@14.0.1
  - @shipfox/client-projects@14.0.1
  - @shipfox/client-ui@14.0.1

## 14.0.0

### Minor Changes

- 312a137: Add typed step errors for invalid checkout paths and occupied checkout destinations.

### Patch Changes

- f8a98cb: Publish the shared UI component artifacts and release `@shipfox/client-ui` with the updated shared UI dependency so fresh consumers and Storybook resolve component subpaths without configuration overrides.
- b2d4550: Add URL-backed run detail tabs for Summary, Jobs, Annotations, and Source.
- Updated dependencies [baa7594]
- Updated dependencies [f8a98cb]
- Updated dependencies [1267eb3]
- Updated dependencies [b2d4550]
- Updated dependencies [312a137]
  - @shipfox/react-ui@0.5.0
  - @shipfox/client-ui@14.0.0
  - @shipfox/api-workflows-dto@12.1.0
  - @shipfox/client-logs@14.0.0
  - @shipfox/client-projects@14.0.0
  - @shipfox/client-shell@14.0.0
  - @shipfox/client-triggers@14.0.0

## 13.0.0

### Major Changes

- e405e92: Move client routes to slug-based `/w/$workspaceSlug` and `/p/$projectSlug` URLs, enforce the new composition contract, and support bounded project-slug resolution.
- 13fa279: Replaces the exported workflow-run UUID short-id with API-provided workflow names and run numbers in client workflow metadata.
- 452e0f8: Separates workflow run list and detail into route-owned pages, removes the shared
  `WorkflowRunPage` export, and exposes older run pages for filtering.

### Minor Changes

- dea1ffd: Expose normalized repository references on listening execution events.
- 54c820e: Rebuild the run list as a full-width page: 44px rows carrying status, name, trigger, branch, commit, a per-run job status strip, duration, and time, with URL-backed search, status, branch, actor, event, and date filters.

### Patch Changes

- b5bb0c5: Derives one activity-aware workflow status across graph, execution, and job detail surfaces.
- a2d684e: Displays resolved job execution names in workflow run job card titles.
- 5d2c9cf: Carry checkout steps from workflow normalization through step materialization and surface their setup error category.
- f78740d: Remove Unicode dash punctuation from package prose and source comments.
- 9fdd5e4: Persist definition validation warnings from repository syncs and surface them on the workflow page without changing sync success or run creation behavior.
- edb4a18: Present resolved workflow run and job execution names across workflow run surfaces.
- Updated dependencies [ee2ce67]
- Updated dependencies [5d2c9cf]
- Updated dependencies [e405e92]
- Updated dependencies [f7939c7]
- Updated dependencies [89f2c18]
- Updated dependencies [f78740d]
- Updated dependencies [9e1d599]
- Updated dependencies [dea1ffd]
- Updated dependencies [adf07e7]
- Updated dependencies [3f781ee]
- Updated dependencies [9969937]
- Updated dependencies [9fdd5e4]
- Updated dependencies [285fff2]
- Updated dependencies [e44a279]
- Updated dependencies [3c73365]
- Updated dependencies [4eb18b8]
- Updated dependencies [54c820e]
- Updated dependencies [54c820e]
- Updated dependencies [35a42bd]
- Updated dependencies [6adc228]
- Updated dependencies [d77baaa]
- Updated dependencies [032d316]
- Updated dependencies [c2a8e54]
- Updated dependencies [cb0abfa]
- Updated dependencies [e1efaee]
  - @shipfox/api-definitions-dto@12.0.0
  - @shipfox/api-workflows-dto@12.0.0
  - @shipfox/client-projects@13.0.0
  - @shipfox/client-shell@13.0.0
  - @shipfox/client-triggers@13.0.0
  - @shipfox/client-logs@13.0.0
  - @shipfox/client-ui@13.0.0
  - @shipfox/react-ui@0.4.0

## 12.0.2

### Patch Changes

- @shipfox/api-definitions-dto@11.0.0
- @shipfox/client-shell@12.0.2
- @shipfox/client-projects@12.0.2
- @shipfox/client-triggers@12.0.2

## 12.0.1

### Patch Changes

- 78a0033: Show running job executions as running in the workflow graph.
- Updated dependencies [57e69d8]
  - @shipfox/client-logs@12.0.1
  - @shipfox/client-projects@12.0.1
  - @shipfox/client-shell@12.0.1
  - @shipfox/client-triggers@12.0.1

## 12.0.0

### Patch Changes

- Updated dependencies [96ae951]
  - @shipfox/client-shell@12.0.0
  - @shipfox/client-projects@12.0.0
  - @shipfox/client-triggers@12.0.0

## 11.0.0

### Minor Changes

- 22bf8a2: Classifies runner agent harness startup failures separately from user-fixable agent configuration errors.

### Patch Changes

- 86ad6a3: Uses the workflow step's agent configuration in failure guidance.
- Updated dependencies [662516d]
- Updated dependencies [22bf8a2]
- Updated dependencies [38a4635]
- Updated dependencies [e9280fc]
  - @shipfox/client-shell@11.0.0
  - @shipfox/api-workflows-dto@10.0.0
  - @shipfox/client-logs@11.0.0
  - @shipfox/client-projects@11.0.0
  - @shipfox/client-triggers@11.0.0
  - @shipfox/api-definitions-dto@10.0.0
  - @shipfox/client-api@6.0.1
  - @shipfox/client-ui@6.0.2
  - @shipfox/react-ui@0.3.7

## 10.0.1

### Patch Changes

- Updated dependencies [6017e56]
  - @shipfox/api-workflows-dto@9.3.0
  - @shipfox/client-shell@10.0.1
  - @shipfox/client-projects@10.0.1
  - @shipfox/client-triggers@10.0.1

## 10.0.0

### Patch Changes

- Updated dependencies [456c884]
  - @shipfox/client-shell@10.0.0
  - @shipfox/client-projects@10.0.0
  - @shipfox/client-triggers@10.0.0

## 9.0.0

### Patch Changes

- Updated dependencies [56e2c58]
- Updated dependencies [87170f8]
  - @shipfox/client-shell@9.0.0
  - @shipfox/client-triggers@9.0.0
  - @shipfox/client-projects@9.0.0

## 8.0.0

### Patch Changes

- Updated dependencies [289d686]
  - @shipfox/client-shell@8.0.0
  - @shipfox/client-projects@8.0.0
  - @shipfox/client-triggers@8.0.0

## 7.0.0

### Patch Changes

- @shipfox/client-projects@7.0.0

## 6.0.3

### Patch Changes

- @shipfox/client-projects@6.0.3

## 6.0.2

### Patch Changes

- Updated dependencies [4b85404]
- Updated dependencies [102c5f4]
  - @shipfox/api-definitions-dto@9.0.2
  - @shipfox/api-workflows-dto@9.0.2
  - @shipfox/react-ui@0.3.7
  - @shipfox/client-ui@6.0.2
  - @shipfox/client-shell@6.0.2
  - @shipfox/client-projects@6.0.2
  - @shipfox/client-logs@6.0.2
  - @shipfox/client-triggers@6.0.2

## 6.0.1

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.
- 3f8f1cb: Enforces typed route-input and browser-storage boundaries across client features.
- Updated dependencies [475ce59]
- Updated dependencies [3f8f1cb]
  - @shipfox/api-definitions-dto@9.0.1
  - @shipfox/api-workflows-dto@9.0.1
  - @shipfox/client-api@6.0.1
  - @shipfox/client-logs@6.0.1
  - @shipfox/client-projects@6.0.1
  - @shipfox/client-shell@6.0.1
  - @shipfox/client-triggers@6.0.1
  - @shipfox/client-ui@6.0.1
  - @shipfox/react-ui@0.3.6

## 6.0.0

### Major Changes

- 24be269: Makes checked API adapters the only public business-response boundary and returns package-owned domain models from Agent, Integrations, and Workflows adapters.

### Minor Changes

- 401b583: Exposes typed feature-owned navigation and settings contributions and enforces coordinator-owned client composition.

### Patch Changes

- d784a07: Enforces checked client API responses and removes stale transport compatibility helpers.
- 82eda45: Adds validated URL-owned project and workflow run filters for shareable navigation state.
- 125c90f: Adds checked Projects domain models and resource-owned query cache policy.
- bb29e41: Converges workflow query caches on transport-independent domain models.
- Updated dependencies [401b583]
- Updated dependencies [82eda45]
- Updated dependencies [125c90f]
- Updated dependencies [f2d50a8]
- Updated dependencies [cd90c19]
- Updated dependencies [24be269]
- Updated dependencies [c56c124]
- Updated dependencies [4a6d124]
- Updated dependencies [c02ac42]
  - @shipfox/client-projects@6.0.0
  - @shipfox/client-shell@6.0.0
  - @shipfox/client-triggers@6.0.0
  - @shipfox/client-api@6.0.0
  - @shipfox/api-definitions-dto@6.0.0
  - @shipfox/api-workflows-dto@9.0.0
  - @shipfox/client-logs@6.0.0
  - @shipfox/client-ui@6.0.0
  - @shipfox/react-ui@0.3.5

## 5.0.0

### Patch Changes

- f1d6465: Moves workspace-settings and project-workflow route ownership from centralized packages into each feature's own route module, so a feature package declares and ships its own settings pages.
- Updated dependencies [8d8cdef]
- Updated dependencies [ee9d641]
- Updated dependencies [ffd727b]
- Updated dependencies [f1d6465]
  - @shipfox/client-projects@5.0.0
  - @shipfox/client-logs@5.0.0
  - @shipfox/client-shell@5.0.0
  - @shipfox/client-triggers@5.0.0
  - @shipfox/api-workflows-dto@8.0.0

## 4.0.0

### Patch Changes

- Updated dependencies [2e5b718]
- Updated dependencies [6b4a575]
- Updated dependencies [11b10f7]
- Updated dependencies [781a45b]
  - @shipfox/client-ui@4.0.0
  - @shipfox/client-shell@4.0.0
  - @shipfox/client-api@4.0.0
  - @shipfox/client-triggers@4.0.0
  - @shipfox/client-logs@4.0.0

## 3.0.1

### Patch Changes

- ffc7fc9: Republishes the affected release set after recovering package publication.
- Updated dependencies [ffc7fc9]
  - @shipfox/client-logs@3.0.1
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
  - @shipfox/client-logs@3.0.0
  - @shipfox/client-triggers@3.0.0
  - @shipfox/client-ui@3.0.0

## 2.0.0

### Patch Changes

- Updated dependencies [23563de]
- Updated dependencies [1820feb]
- Updated dependencies [7ac43a4]
- Updated dependencies [23a4dc2]
  - @shipfox/api-workflows-dto@6.0.0
  - @shipfox/react-ui@0.3.3
  - @shipfox/client-shell@2.0.0
  - @shipfox/client-ui@2.0.0
  - @shipfox/client-logs@2.0.0
  - @shipfox/client-triggers@2.0.0

## 1.0.0

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.
- Updated dependencies [47809a2]
- Updated dependencies [bb037af]
- Updated dependencies [5c63a2a]
- Updated dependencies [d8658ba]
  - @shipfox/client-shell@1.0.0
  - @shipfox/api-workflows-dto@5.0.0
  - @shipfox/client-api@1.0.0
  - @shipfox/client-logs@1.0.0
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
  - @shipfox/client-api@0.2.0
  - @shipfox/client-logs@0.2.0
  - @shipfox/client-shell@0.2.0
  - @shipfox/client-triggers@0.2.0
  - @shipfox/client-ui@0.2.0

## 0.1.2

### Patch Changes

- Updated dependencies [c18d624]
  - @shipfox/react-ui@0.3.1
  - @shipfox/client-logs@0.1.2
  - @shipfox/client-triggers@0.1.2
  - @shipfox/client-ui@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [1b0d344]
  - @shipfox/api-workflows-dto@2.0.0
  - @shipfox/client-ui@0.1.1
  - @shipfox/client-logs@0.1.1
  - @shipfox/client-triggers@0.1.1
  - @shipfox/client-api@0.0.1
  - @shipfox/react-ui@0.3.0

## 0.1.0

### Minor Changes

- 2bc5595: Adds workflow-run cancellation across the API, orchestration queue cleanup, event contract, and run-page cancel action.
- d69b164: Adds workflow run attempt lineage APIs and a run summary switcher for navigating rerun attempts.
- 2fb3e87: Derives workflow run attempt durations on the client and displays them in the run list and run header.
- e699508: Adds first-class skipped workflow jobs with persisted status reasons across API DTOs, orchestration, events, and client run views.

### Patch Changes

- dc3e434: Show logs inline under the active or selected workflow step attempt, including missing-stream retry for running attempts and stale-log retry states.
- 974b501: Moves manual workflow-run firing and optimistic run-list cache updates into `@shipfox/client-workflows` so project workflow pages consume the run cache owner directly.
- 228385c: Centralizes workflow run DTO mapping behind core client models for workflow UI components.
- a20b345: Compacts workflow job graph nodes and shows only current unresolved dependency counts.
- 8037501: Capture the `@shipfox/client-workflows` Storybook stories as Argos visual
  snapshots. Vitest now runs a browser `storybook` project that screenshots every
  story in light and dark and uploads them to the `client-workflows` Argos build
  in CI.
- 6e435dd: Add a resizable workflow source panel to the run page. The run summary exposes a Source control that opens the run's workflow YAML (from `source_snapshot`) in a page-level right panel, leaving the jobs graph and step attempts visible. The panel defaults to 720px and can be dragged between 420px and `min(1280px, 85vw)`.
- 5264a22: Adds a shared time ticker provider and hook for live elapsed-time displays that pause while hidden and slow down under reduced motion.
- 0b75eba: Replace the color-only job/run status dot with `WorkflowStatusIcon`, an icon-in-circle status glyph. Each state now carries a distinct shape plus the saturated `--tag-*-icon` tone, so the state is readable without relying on color alone: a dotted ring (pending), check / X / slash discs (succeeded / failed / cancelled), and a filled disc with an external ripple halo for the live running state (no spinner; honors reduced motion). Applied to the jobs graph nodes and the run-history rows. The run-header keeps its existing status `Badge` (its flat leading icon now matches the new glyph set).
- 417e220: Removes duplicate status icon from the workflow run summary, keeping only the status badge.
- 7a0ac44: Highlights workflow job graph edges on node hover with a neutral emphasis instead of the selected-job accent.
- 8fad235: Adds trigger source icons to workflow run rows so trigger metadata aligns with the status column.
- f880179: Replaces the trigger node rectangle in the workflow jobs graph with a circle containing only the trigger source icon, and shows the source label on hover via tooltip.
- 7341569: Add a per-step source action to the workflow run page with highlighted-line scrolling in the source panel.
- 8037501: Replace the local `StatusDot` in the workflow runs list with the shared `Dot`
  component from `@shipfox/react-ui`, mapping run status to the dot's native color
  variant. Active (running) runs show a blue rippling dot.

  Refine the selected run row: drop the washed-out orange-tinted fill and border in
  favor of a subtle neutral surface plus the existing orange "you are here" rail, so
  selection reads as intentional restraint rather than a faint brand wash.

  Re-align the status filter buttons to native `Button` variants instead of
  hardcoded highlight tokens: the active filter uses `primary`, the rest
  `transparent`.

  Tidy the runs list header: drop the redundant "Runs" title (already shown in the
  section selector above) and align the header inset with the run rows so the search
  box, filters, and run cards share one left edge.

  Match the runs list panel surface to the nav bar chrome: use
  `bg-background-subtle-base` (instead of a solid `bg-background-neutral-base` panel
  fill) so it reads as app chrome rather than a dedicated card, keeping only the
  right-edge separator.

- Updated dependencies [dc3e434]
- Updated dependencies [eb40964]
- Updated dependencies [b83d31a]
- Updated dependencies [5c18360]
- Updated dependencies [43d7996]
- Updated dependencies [14e0bea]
- Updated dependencies [7a9943d]
- Updated dependencies [c17dd6e]
- Updated dependencies [9018f0b]
- Updated dependencies [7fdfd72]
- Updated dependencies [736249b]
- Updated dependencies [2bc5595]
- Updated dependencies [2a3193f]
- Updated dependencies [f104ff2]
- Updated dependencies [7341569]
- Updated dependencies [940696a]
- Updated dependencies [f98c2be]
- Updated dependencies [e9396c9]
- Updated dependencies [b525dcd]
- Updated dependencies [e4c6abf]
- Updated dependencies [e4c6abf]
- Updated dependencies [2c352bb]
- Updated dependencies [e5d2f13]
- Updated dependencies [5d0676a]
- Updated dependencies [a460020]
- Updated dependencies [3afb7e3]
- Updated dependencies [a35c2dc]
- Updated dependencies [58f7aef]
- Updated dependencies [5264a22]
- Updated dependencies [9674879]
- Updated dependencies [c652a68]
- Updated dependencies [225c9a5]
- Updated dependencies [24f131b]
- Updated dependencies [bb2a7bc]
- Updated dependencies [795f440]
- Updated dependencies [3dcd751]
- Updated dependencies [5eb06d0]
- Updated dependencies [4e13e5f]
- Updated dependencies [e92150d]
- Updated dependencies [8037501]
- Updated dependencies [0fb6018]
- Updated dependencies [c27a1ed]
- Updated dependencies [c0a883c]
- Updated dependencies [362b3eb]
- Updated dependencies [b8e49ff]
- Updated dependencies [8037501]
- Updated dependencies [6c0da64]
- Updated dependencies [d69b164]
- Updated dependencies [07f8ff8]
- Updated dependencies [e457582]
- Updated dependencies [8b5c905]
- Updated dependencies [2fb3e87]
- Updated dependencies [ef1e917]
- Updated dependencies [f849131]
- Updated dependencies [0c6373a]
- Updated dependencies [94bdcc5]
- Updated dependencies [a34c8ea]
- Updated dependencies [27770eb]
- Updated dependencies [2933c33]
- Updated dependencies [8ac4bf4]
- Updated dependencies [3a0be6b]
- Updated dependencies [e699508]
- Updated dependencies [d42baf4]
- Updated dependencies [8037501]
- Updated dependencies [54bb8a3]
- Updated dependencies [f711e18]
- Updated dependencies [8ecc121]
  - @shipfox/client-logs@0.1.0
  - @shipfox/api-workflows-dto@0.1.0
  - @shipfox/react-ui@0.3.0
  - @shipfox/client-triggers@0.1.0
  - @shipfox/client-api@0.0.1
  - @shipfox/client-ui@0.1.0
