# design-sync notes — @shipfox/react-ui

Repo-specific gotchas for syncing `libs/shared/react/ui` to claude.ai/design.

## Build / config

- **Shape: storybook.** Reference storybook built into `.design-sync/sb-reference` from `libs/shared/react/ui/.storybook` (run `storybook build` from the package dir — its node_modules has the storybook bin and react). 89 story entries → 31 components.
- **`--node-modules` is the package's own** `libs/shared/react/ui/node_modules` (pnpm isolated — react is NOT hoisted to repo root). `--entry libs/shared/react/ui/dist/index.js`.
- **buildCmd** `turbo run build --filter=@shipfox/react-ui...` (trailing `...` builds workspace deps too).
- `[GENERAL]` **Decorator bundle fails** (`Could not resolve "tailwindcss"`): `.storybook/preview.tsx` imports `../index.css` which `@import "tailwindcss"` (Tailwind v4) — esbuild can't resolve it. CSS itself ships fine via the dist `styles.css` scrape, so the only thing lost is the `ThemeProvider` wrapper the `withTheme` decorator supplied. Fixed with `cfg.provider` = `ThemeProvider` (`defaultTheme: "system"`, `storageKey: "shipfox-theme-system"`), mirroring the decorator default. `ThemeProvider` is a bundle export.
- `[GENERAL]` **titleMap**: two storybook titles don't match export names — `Loader` → `ShipfoxLoader` (story `component: ShipfoxLoader`), `Toast` → `Toaster` (story `component: Toaster`).
- `[GENERAL]` **GRID_OVERFLOW (19 components)**: applied cardMode overrides — `column` for wide grids (Button, Alert, Badge, Card, Combobox, EmptyState, FormField, Input, IconButton, LoadErrorState, Modal, RadioGroup, ShipfoxLoader, Skeleton, Table, Tabs) and `single` (+ `primaryStory: Default`) for portal/fixed overlays (DropdownMenu, Sheet, Tooltip). Presentation-only — grades carry, targeted rebuild only.

## Fonts

- `[GENERAL]` **Remote fonts, served at runtime.** `index.css` `@import`s Inter from Google Fonts and declares `@font-face` for **Commit Mono** from a storyblok CDN URL. `[FONT_REMOTE]` for Inter is expected — both fonts load at runtime in the capture browser (verified: Text renders in Inter, Code renders in Commit Mono on both panels). Capture/grade requires network egress to fonts.googleapis.com and a.storyblok.com; a network-sandboxed shell would silently fall back on both panels.

## Preview fidelity — general (from fan-out)

- `[GENERAL]` **`@storybook/addon-pseudo-states` is not reproducible in previews.** Any story that forces `:hover`/`:focus`/`:focus-visible` via `parameters.pseudo` (mapping `.hover`→`:hover`, `.focus`→`:focus-visible`) shows those state visuals ONLY in storybook. The compiled preview renders the same inert classNames, so Hover/Focus columns look like Default. Not fixable by an owned `.tsx` (faking the state misrepresents the component). Grade `close` with a note. Known affected stories: **RadioGroup "States"**, **IconButton "Variants"**.
- `[GENERAL]` **Capture viewport is fixed** (~900x700) while storybook captures full-page. Tall matrix stories (e.g. IconButton/Button "Variants" spanning sizes 2xs..xl) get framed to the top region in the preview — a framing artifact, not missing content. A `cfg.overrides.<Name>.viewport` bump would show more but re-grades.
- **Animation freeze artifacts**: a few stories show a different frozen frame of an infinite-loop animation between panels (Icon spinner cell, ShipfoxLoader lit pixels, Combobox "Loading" spinner). Content/composition identical — graded `match` (or `close` for Combobox Loading where the spinner glyph appears on only one panel). Not a contract difference.

## Accepted `close` (non-actionable, with rationale)

- **RadioGroup "States"** — pseudo-states addon (see above); component renders identically otherwise.
- **IconButton "Variants"** — pseudo-states addon (see above); real component (Default/Disabled, all sizes/variants) matches.
- **Combobox "Loading"** — capture freeze-clock settles the CSS spin animation differently per panel; same component + state.

## Render warns triaged (known, not new)

- `tokens: ... (1 missing, below threshold)` — one undefined CSS custom property, below the validator threshold. Benign.
- `[FONT_REMOTE] "Inter"` — see Fonts above; expected, no action.

## Avatar

- Avatar stories guard remote DiceBear images behind `navigator.webdriver` (`isTest ? 'letters' : 'image'`) — under the capture browser (webdriver=true) avatars render letters/logo, not remote images, on both panels. So Avatar is NOT the `[ASSETS_BLOCKED]` canary; the font egress above is the real remote-asset dependency.

## Re-sync risks

- **Provider distillation**: `cfg.provider` replaces the storybook decorators as the preview wrapper. If `ThemeProvider`'s API or the theme mechanism changes, re-verify a themed component after rebuild.
- **Remote font egress**: grades assume fonts.googleapis.com + a.storyblok.com are reachable at capture time. If a future sync runs sandboxed, Text/Code (and any text rendering) would compare as "matching fallback" while shipping wrong fonts — never accept that as a pass.
- **Avatar webdriver guard**: the `image` content path (remote DiceBear) is never exercised by the compare oracle. Only the letters/logo path is verified.
