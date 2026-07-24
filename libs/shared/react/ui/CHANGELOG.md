# @shipfox/react-ui

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
