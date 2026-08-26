# @shipfox/react-ui

## 2.3.1

### Patch Changes

- 515b14c: Delay initial tooltip hovers and open adjacent tooltips immediately while the interface is warm.

## 2.3.0

### Minor Changes

- 79e1ed7: Truncate a long `Select` value instead of letting it wrap out of the trigger, and grow the
  trigger to the touch minimum where the pointer is coarse.

  Adds a `pt-panel-compact` spacing utility. A Markdown body that fails to render now falls back
  onto the same code surface a rendered fence uses.

## 2.2.0

### Minor Changes

- a7fb52d: Supports server-declared Markdown in signup denial messages while keeping custom policy messages plain by default.

  Existing environment-backed messages now interpret Markdown syntax. Older clients display the Markdown source as plain text.

### Patch Changes

- ddcc546: Stops closing Modal, Sheet, and popper surfaces from catching clicks while they animate out. Modal and Sheet also release a body pointer-events lock left behind by a missed dismissal.

## 2.1.1

### Patch Changes

- 87d9bd8: Replace the shared UI font with self-hosted IBM Plex Sans while retaining Commit Mono for code and log surfaces.

## 2.1.0

### Minor Changes

- 00c1cb8: Add `PanelGrid`, `PanelCell`, and `PanelCellAction` for a two-column grid of cells divided by hairlines, collapsing to one column at 760px and padding an odd cell count so the last row's dividers span the panel. `PanelGrid` takes an `as` prop for a grid whose cells are not list items. `PanelCellAction` renders a trailing verb and chevron from an `action` prop. Add a `--shadow-focus-inset` token for controls whose parent clips the outset focus ring. `Panel`, `PanelBody`, and `PanelRow` accept `asChild`, so a panel can render as an `aside` and a row list can keep `ul` and `li` semantics.
- 7693eb3: Render empty and load-error states inside bordered panel bodies and keep loading placeholders aligned with their data regions.
- 00c1cb8: Radio choice tiles show a selected indicator dot, keep a visible focus ring when the checked item receives keyboard focus, and rest on an opaque fill that no longer changes shade with the surface behind them. Add a `variant` prop: `cell` renders the group as a hairline-divided grid whose options carry no frame of their own, for a picker inside a panel. Add `RadioGroupItemSkeleton`, a loading placeholder matching either variant, with a `labelClassName` prop to vary the bar width.

### Patch Changes

- 56f4526: Project settings and project creation now use shared panels, with source integrations presented as button-style radio choices.

## 2.0.0

### Major Changes

- 30beb8f: Remove the `Card` component and migrate its consumers to `Panel`.

  Migration mapping: `Card` to `Panel`, `CardHeader` to `PanelHeader variant="plain"`,
  `CardTitle` to `PanelTitle`, `CardContent` to `PanelBody`, `CardAction` to
  `PanelActions`, and `CardDescription` to a `Text` with
  `className="text-foreground-neutral-muted"`. Keep `CardFooter` content in the
  panel layout or a `PanelBody`.

- 6703982: Retire the `background-neutral-background` CSS token and migrate workflow page canvases to `background-subtle-base`.

### Minor Changes

- 163c40a: Adds the Panel surface primitive with header, body, row, and empty-state components.

### Patch Changes

- 0f4abe4: Make tables inherit their wrapping panel surface and keep container borders and radii on `Panel`.
- 71d0c44: Make dark-mode code surfaces near-black and opaque.
- 16733a7: Align light-mode surface tokens with the shared four-role ladder.
- f1d127e: Use dark contrast surfaces with readable semantic foregrounds across code and log views, preserve status on log-row edge accents, and add shared highlight and tooltip tokens for code and keyboard affordances.

## 1.2.0

### Minor Changes

- 4b0731e: Adds workflow troubleshooting details, evaluation traces, failure annotations, runner context, step output metadata, and lazy paginated annotation summaries.

## 1.1.0

### Minor Changes

- 80cde6b: Render run annotations in the run workspace. `AnnotationCard` gains an optional context title, provenance, and action, and bounds a long body behind a disclosure. The run's Annotations section is now the only surface that renders an annotation body, ranked by severity and then emission order, with the job page linking to it through a bounded count chip.

  `Markdown` tables now size to their content instead of stretching to the container, so a two-column table no longer puts a cell the width of the page away from its row header.

## 1.0.0

### Major Changes

- 5c56ba6: Moves `@shipfox/react-ui` to `1.0.0`, clearing versions already occupied on npm by an
  earlier lineage. No source, component, or export changed. Consumers using a version
  range should repin to `^1.0.0`.

### Patch Changes

- 88bf8e8: Migrates the shell, auth, secrets, logs, workspace-settings, config, and invitations
  surfaces to semantic spacing roles and brings them under the `no-raw-spacing` Biome
  plugin. Adds shared menu-surface and edge-specific panel roles for existing spacing
  contracts.
- 6aa6c7a: Migrates the integrations, triggers, runners, and projects client surfaces to semantic spacing roles and enables `no-raw-spacing` for them. Adds the `gap-x-*` and `gap-y-*` axis roles and the `-mx-inline` bleed role so grids with differing column and row rhythm, and rows that cancel their own `px-tight`, stay on the density-aware scale.

## 0.5.0

### Minor Changes

- baa7594: Adds the `my-region`, `mt-page`, `ms-inline`, `-mt-inline`, `-mr-inline`, and `px-tight` utilities to the shared UI stylesheet.
- 1267eb3: Adds Jira connection flows and provider icons to workspace integrations settings.

### Patch Changes

- f8a98cb: Publish the shared UI component artifacts and release `@shipfox/client-ui` with the updated shared UI dependency so fresh consumers and Storybook resolve component subpaths without configuration overrides.
- b2d4550: Add URL-backed run detail tabs for Summary, Jobs, Annotations, and Source.

## 0.4.0

### Minor Changes

- 6adc228: Adds semantic spacing and density tokens to the shared React UI stylesheet.

### Patch Changes

- f78740d: Remove Unicode dash punctuation from package prose and source comments.
- 9969937: Shows one-sided date ranges in DateRangePicker values.

## 0.3.7

### Patch Changes

- 102c5f4: Isolates private browser state and React Query data across authenticated principal transitions.

## 0.3.6

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.
- 3f8f1cb: Enforces typed route-input and browser-storage boundaries across client features.

## 0.3.5

### Patch Changes

- ffc7fc9: Republishes the affected release set after recovering package publication.

## 0.3.4

### Patch Changes

- cb58afe: Adds Shiki-rendered styling for added and removed diff lines in code blocks.

## 0.3.3

### Patch Changes

- 1820feb: Makes the Slack icon inherit the surrounding interface color.

## 0.3.2

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.

## 0.3.1

### Patch Changes

- c18d624: Fixes compiled internal imports so external consumers resolve the package's dist artifacts.

## 0.3.0

### Minor Changes

- 43d7996: Adds the Linear OAuth connect experience to workspace integration settings.
- 9018f0b: Adds a Radix-based Switch component with size variants and Storybook coverage.
- 7fdfd72: Adds a `fieldError` helper to the form-field module that extracts the first error message from a TanStack Form field's validation state.
- f104ff2: Add `@shipfox/client-logs`: the record components for the step-log read stream, composing the `@shipfox/react-ui` log primitives. This covers every process and system record (`output`, `group_start`/`group_end`, `end`, `gap`, `capped`, `runner_lost`); `agent_session` is rendered by the agent-sessions surface.
  - `buildLogTree(records)` is a pure transform that reconstructs the group tree from the flat record list. `group_end` closes the matching `group_id` (so a `group_start` dropped under gap/backlog pressure does not mis-nest), record dispatch is an exhaustive switch, and each group node carries a precomputed `hasError` (a `runner_lost` in its subtree, a genuine failure; `stderr` is a channel, not an error) and subtree line count.
  - `OutputLogRow` renders stdout/stderr (stderr gets a subtle left channel rule, not a background tint), `LogGroup` is a collapsible disclosure with running/duration/incomplete affordances and an inset error bar, the system markers render as timeline rows, and `LogView` is the top-level dispatcher with an empty state. Reviewed in a package-local Storybook captured by Argos (`client-logs`).
  - `@shipfox/api-logs-dto` now measures UTF-8 byte length with `TextEncoder` instead of `node:buffer`, so this shared record contract is browser-safe for the client log viewer. Behavior is identical.
  - `@shipfox/react-ui` gains two shared formatters in `utils`: `formatBytes` (new) and `formatDuration` (an ms-span, sub-second sibling to the existing `humanDuration`), so `client-logs` and future packages share one implementation instead of re-rolling them.

- a35c2dc: Adds composable combobox primitives and multi-select chips with optional compact overflow.
- 58f7aef: Adds a shared hook for detecting when text is visually truncated.
- 5264a22: Adds a shared time ticker provider and hook for live elapsed-time displays that pause while hidden and slow down under reduced motion.
- 225c9a5: Adds log viewer UI primitives (LogRows, LogRow, LogHeader, LogContent) for composing CI and agent log records.
- 24f131b: Standardize "failed to load" states across client surfaces. Adds an `EmptyState`
  primitive and a presentational `LoadErrorState` to `@shipfox/react-ui`, and a new
  `@shipfox/client-ui` package with `loadErrorCopy` (friendly, leak-free error copy)
  and a `QueryLoadError` wrapper. Failed data loads now render a calm placeholder
  with a labeled Retry instead of a red alert that leaked the raw request URL, and
  the placeholder is only shown when no data was ever loaded so a failed refetch no
  longer wipes stale content.
- 5eb06d0: Adds the CodeBlock, CodeTabs, and ShinyText components with Shiki syntax-highlighting and clipboard hooks for rendering copyable, optionally diffed code snippets.
- 4e13e5f: Add the `Collapsible` component (`Collapsible`, `CollapsibleTrigger`, `CollapsibleContent`) built on `@radix-ui/react-collapsible`. It is a thin design-system wrapper carrying `data-slot` attributes, and its content animates its height open and closed with the shared `collapsible-down`/`collapsible-up` keyframes. Use it for "show more" rows, optional or advanced settings, and any section that should fold away until needed.
- e92150d: Add date selection components: `Calendar` (a styled `react-day-picker` wrapper), `DatePicker` (single date), and `DateRangePicker` (start/end range). Pickers render a read-only field with a calendar popover, support `base`/`small` sizes, `base`/`component` variants, `default`/`error`/`disabled` states, custom `dateFormat`, clearing, and optional bounds (`maxDisabledOffsetDays` for `DatePicker`, `maxRangeDays` for `DateRangePicker`). Picking a date (or completing a range) closes the popover by default; pass `closeOnSelect={false}` to keep it open.
- 8037501: Add the `Dot` component: a small filled status/presence dot. A `variant` prop
  (`neutral` | `info` | `feature` | `success` | `warning` | `error`, mirroring the
  `Badge` variant set) sets the color, defaulting to a muted neutral; colors map to
  the `--tag-*-text` family so a dot matches the badge/status pill it stands in for. Set `ripple` to radiate fading concentric rings
  for live or loading states; the animation honors `prefers-reduced-motion`. Color
  flows through `currentColor`, so the dot and its rings always stay in sync.
- 0fb6018: Add the `LogDisclosure` log primitive (`LogDisclosure`, `LogDisclosureTrigger`,
  `LogDisclosureContent`), one collapsible built on `Collapsible` for both folding log groups
  (GitHub `::group::`, with `rail={false}` around nested rows) and folding disclosures (agent
  thinking, tool-result output, compaction summaries, with the default left rail). The header,
  rail, and rows share a new `LogRowFrame` primitive (also exported, with `LogRowFrameProps`)
  so they stay gutter-aligned.

  `LogRow`'s `indent` is now a **depth level** rather than raw pixels: `LogRows` gains an
  `indentStep` prop (default 16px per level) that resolves the level to padding, so callers write
  `indent={depth + 1}` instead of `indent={(depth + 1) * 16}`. `Collapsible`'s open/close
  animation is now gated behind `motion-safe:`, so it respects `prefers-reduced-motion`.

- c27a1ed: Replace the root barrel with per-component subpath exports. Import from a subpath
  (`@shipfox/react-ui/button`, `@shipfox/react-ui/card`, ...), or from
  `@shipfox/react-ui/hooks` / `@shipfox/react-ui/utils`, so importing one component
  no longer evaluates the whole component tree (and its Radix and icon dependencies)
  in the dev server or bundlers. The package is now `sideEffects`-free except for CSS
  so bundlers can tree-shake it.

  BREAKING: the root entry point `@shipfox/react-ui` no longer resolves. Replace
  `import {Button} from '@shipfox/react-ui'` with `import {Button} from '@shipfox/react-ui/button'`.

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

- 8037501: Add shared formatting helpers and the `RelativeTime` component. Exposes `formatTimestamp`, `formatDate`, `humanDuration`, and `formatRelative` utilities plus the `RelativeTime`/`RelativeTimeProvider` components, moving them out of `@shipfox/client-projects` into `@shipfox/react-ui` so every client package shares one implementation. `formatDate` also replaces a separate copy in `@shipfox/client-integrations`.
- 6c0da64: Adds a shared Textarea component with Storybook coverage and FormField wiring.
- e457582: Adds the Callout static notice primitive and sanitized Markdown renderer, replacing the old inline-tips subpath with callout.
- 8b5c905: Adds a fixed clock option to relative time rendering for deterministic visual captures.
- 8ac4bf4: Adds a Radix-backed Accordion primitive with single and multiple expansion modes.
- 3a0be6b: Adds shared search components for inline search fields and modal command-search surfaces.
- d42baf4: Adds a Gitea brand logo to the icon set so integration surfaces can render the Gitea provider.

### Patch Changes

- 14e0bea: Fixes syntax-highlighted code block line highlights so the row background remains visible above Shiki's transparent reset.
- 2a3193f: Fixes custom icon prop forwarding so class names, sizing, and accessibility attributes consistently reach the rendered SVG.
- 7341569: `CodeBlockContent` gains an opt-in `scrollHighlightedIntoView` prop for centered highlighted-line scrolling.
- e4c6abf: Forward props on the `componentLine` and `componentFill` custom icons so `className`, `aria-*`, and sizing reach the rendered `<svg>` like every other icon. Previously these two glyphs dropped all props, so `<Icon name="componentLine">` (the neutral fallback `IntegrationIcon` and `TriggerSourceIcon` use for uncataloged sources) rendered at its intrinsic size with no accessible name regardless of what the caller passed.
- 9674879: Ships Commit Mono as WOFF2 assets to reduce the bundled self-hosted font size.
- bb2a7bc: Uses date-fns for compact relative time formatting while preserving reduced-motion behavior.
- 07f8ff8: Stabilizes Badge story visual snapshots by using a deterministic user avatar fixture.
- f849131: Self-hosts Inter and Commit Mono fonts and adds document.fonts.ready gates before Argos screenshots to eliminate fallback-font flakiness on cold CI.
- 94bdcc5: Stabilizes CodeBlock and CodeTabs visual snapshots by waiting for Shiki highlighting before Argos capture.
- a34c8ea: Keeps desktop modal bodies scrollable when their content exceeds the viewport.
- 8037501: Fixes `CircleDottedLineIcon` to forward `className` and the rest of its props (instead of ignoring them), so it now scales with `size-12` and similar overrides, including the width/height `<Icon size>` resolves, rather than rendering at a fixed size.
- 54bb8a3: Aligns React UI Storybook stories around playground-first coverage and grouped visual states.
- f711e18: Add line-range highlighting support to CodeBlock content.

## 0.2.0

### Minor Changes

- 5c1e777: Adds "use client" directives to interactive components, hooks, and theme state so the library renders correctly in Next.js App Router and other React Server Components consumers.

## 0.1.1

### Patch Changes

- 2311e15: Moves @shipfox/react-ui development to a dedicated repository — future versions will be published from there.
