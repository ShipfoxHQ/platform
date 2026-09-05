# design-sync notes — @shipfox/react-ui

Storybook-shape sync. Bundle global: `window.ShipfoxReactUi`. 31 components, 89 stories.

## Build / config learnings

- [GENERAL] **dist `.d.ts` are emitted separately from the JS build.** The package `build`
  script is `shipfox-swc --copy-files && build:css` — it emits `.js` + `styles.css` but
  NOT `.d.ts`. Type declarations come from `type:emit` (`shipfox-tsc-emit`). On first sync
  the committed dist had stale `.d.ts` (missing empty-state + load-error-state entirely),
  so the converter's `exportedNames` (ts-morph over `dist/index.d.ts`) dropped EmptyState +
  LoadErrorState as "not public exports". Fix: run `turbo run type:emit --filter=@shipfox/react-ui`
  before the converter so dist `.d.ts` matches the JS. Re-run it whenever components are
  added/removed. (`buildCmd` runs `build` only — type:emit is a manual prerequisite.)
- **titleMap**: story titles `Components/Loader` and `Components/Toast` use component
  vars `ShipfoxLoader` and `Toaster`. Mapped via `cfg.titleMap`. EmptyState/LoadErrorState
  match by name once their `.d.ts` exist (see above).
- **Theme / provider**: `.storybook/preview.tsx` wraps stories in `ThemeProvider`
  (`#components/theme`) which adds a `.light`/`.dark` class to `<html>`. Tokens default to
  light at `:root` in styles.css (there is NO `.light` block — only `.dark` overrides), so
  **previews render correctly in light with NO provider**. `cfg.provider` is intentionally
  left UNSET. The converter prints `! preview decorator bundle failed: Could not resolve
  "tailwindcss"` (the decorator imports `../index.css` which `@import "tailwindcss"`, which
  esbuild can't resolve) — this warning is HARMLESS for previews because the bundle CSS
  ships separately and light needs no wrapper. Document ThemeProvider for dark mode in the
  conventions header, not as a preview provider.
- **cardMode overrides** (presentation-only, grades carry): portal/overlay components
  DropdownMenu/Sheet/Tooltip → `single` (escape); 16 wide components → `column`. See config.
  Select/Command/Popover/Toast render fine in grid cells (closed trigger) — not flagged.

## Environment

- [GENERAL] **Spawned subagents (Agent tool) cannot run Bash in this session** — every
  `node` invocation is denied for them. The §4c parallel fan-out therefore can't be
  delegated; the orchestrator must run the captures (`compare.mjs`) and grading itself,
  serially. Captures over the whole roster in one scoped `compare.mjs --components <all>`
  run are fine (one browser launch). If a future session grants Bash to agents, fan-out
  works as the skill intends.

## Re-sync risks

- The dist `.d.ts` staleness above WILL recur if `type:emit` isn't run before the converter
  and a component was added/removed. Always `type:emit` first.
- `[FONT_REMOTE] "Inter"` — styles.css `@import`s Inter from a remote font host; validate
  assumes it serves at runtime. Verify the font actually renders (not a fallback) during compare.
