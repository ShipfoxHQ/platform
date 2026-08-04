---
name: Shipfox
description: The instrument panel for an AI software factory. Calm chrome, loud data, monospace as structure.
colors:
  brand: "#ff4b00"
  brand-deep: "#e63e00"
  brand-tint: "#fff4f0"
  ink: "#0f0f10"
  canvas: "#ffffff"
  on-contrast: "rgba(255,255,255,0.88)"
  surface: "#fafafa"
  panel-inverted: "#1a1a1b"
  primary-fill: "#27272a"
  primary-fill-hover: "#3f3f46"
  border: "#d4d4d8"
  subtle: "#52525b"
  muted: "#71717a"
  running: "#3b82f6"
  succeeded: "#10b981"
  failed: "#f43f5e"
  danger: "#e11d48"
  warning: "#f97316"
  meta: "#8b5cf6"
typography:
  display:
    fontFamily: "Inter, sans-serif"
    fontSize: "56px"
    fontWeight: 500
    lineHeight: "64px"
  headline:
    fontFamily: "Inter, sans-serif"
    fontSize: "28px"
    fontWeight: 500
    lineHeight: "44px"
  title:
    fontFamily: "Inter, sans-serif"
    fontSize: "18px"
    fontWeight: 500
    lineHeight: "28px"
  body:
    fontFamily: "Inter, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "24px"
  label:
    fontFamily: "Inter, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: "20px"
  code:
    fontFamily: "Commit Mono, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "20px"
rounded:
  input: "4px"
  button: "6px"
  card: "8px"
  modal: "10px"
  full: "9999px"
spacing:
  "2": "2px"
  "4": "4px"
  "6": "6px"
  "8": "8px"
  "10": "10px"
  "12": "12px"
  "16": "16px"
  "20": "20px"
  "24": "24px"
  "32": "32px"
  "40": "40px"
  "48": "48px"
  "64": "64px"
components:
  button-primary:
    backgroundColor: "{colors.primary-fill}"
    textColor: "{colors.on-contrast}"
    typography: "{typography.body}"
    rounded: "{rounded.button}"
    padding: "0 10px"
    height: "32px"
  button-primary-hover:
    backgroundColor: "{colors.primary-fill-hover}"
  button-secondary:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.button}"
    padding: "0 10px"
    height: "32px"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.canvas}"
    typography: "{typography.body}"
    rounded: "{rounded.button}"
    padding: "0 10px"
    height: "32px"
  input:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.input}"
    padding: "0 8px"
    height: "32px"
  badge-status:
    typography: "{typography.label}"
    rounded: "{rounded.input}"
    padding: "2px 6px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.card}"
    padding: "24px"
---

# Design System: Shipfox

Shipfox is an AI software factory: engineers author workflows in YAML, events
start them, and shell and agent steps run on compute the team controls. The
center of gravity is the dashboard where those runs are watched, so this system
is built to instrument autonomous work, not to decorate it. The product this
system serves is recorded in [PRODUCT.md](PRODUCT.md).

**The code is canonical.** [The shared CSS](libs/shared/react/ui/index.css) and
the [`@shipfox/react-ui`](libs/shared/react/ui/) package hold the exact token and
component values. This document explains the system and its intent; the
frontmatter above is the machine-readable source of the primitives, recorded as
their light-mode canonical values. The semantic tokens named in each section flip
for dark mode, so tooling that needs theme-correct output resolves the named token
(for example `--background-button-inverted-default`) rather than the raw hex. When
code and prose disagree, the code wins and this file is corrected in the same
change.

## Overview

**Creative North Star: "The Glass Cockpit."**

A glass cockpit is the panel a pilot trusts at 2 AM: every readout is legible at a
glance, nothing moves that does not mean something, and the one warning light that
turns on is the one thing you look at. Shipfox is that panel for engineers flying
fleets of agents. The chrome is quiet and industrial. The data is where all the
life is: logs streaming, a run resolving, an agent thinking out loud, tokens and
cost ticking up. The interface earns trust by getting out of the way until
something needs attention, then pointing at exactly what.

The aesthetic is industrial and utilitarian, in the lineage of Linear, Vercel,
and Resend. Function first, data dense, monospace used as a structural element and
not a garnish. It is not brutalist (there is polish: layered shadows, rounded
corners, tuned contrast), not playful (no bouncy curves, no mascots), and not
editorial (this is an instrument, not a magazine). Both light and dark are
first-class: light leads for most surfaces, dark owns the code-heavy contexts
(logs, YAML, agent transcripts) and is honored whenever the user picks it.

The users live in terminals and read logs when things are on fire. They expect
figures that do not dance, status they can trust without reading the label twice,
keyboard reach, and zero marketing fluff inside the product. Every decision below
serves that reader.

**Key Characteristics:**

- **Instrument-grade density.** Comfortable-compact by default. Take the denser of
  two reasonable options on app surfaces, the more spacious on marketing.
- **Monospace is structure.** Commit Mono carries everything a user types, copies,
  or pattern-matches. It is load-bearing, not decorative.
- **Orange is the warning light.** The brand accent marks focus, "you are here,"
  and the live edge. It is never a fill you reach for to feel branded.
- **Trustworthy status.** State is carried by shape and color together, never color
  alone. The UI must not lie to an operator.
- **Calm chrome, loud data.** Navigation and containers recede; runs, logs, and
  metrics are the loudest thing on screen.

## Colors

The palette is a warm-neutral canvas, one brand accent (Shipfox orange), and a
disciplined functional set for status. Color is organized in three layers, and
components always consume the highest layer that fits.

**Layer 1, primitives.** Raw scales in `index.css`: `--color-neutral-{0..1000}`,
`--color-primary-{50..950}`, `--color-{red,orange,green,blue,purple}-{50..950}`,
Apple-style `--color-accent-*`, and `--color-alpha-{black,white}-*` for
translucent overlays. **Never read a primitive from a component.** If the
semantic token you need does not exist, add it rather than reaching past the layer.

**Layer 2, semantic tokens.** Role tokens that flip between light and dark
automatically, so component code never branches on theme. The families:

- Backgrounds: `bg-background-neutral-base` (canvas), `-neutral-background` (page
  under panels), `-components-base` (cards), `-components-hover` / `-pressed`,
  `-field-base` / `-field-hover` (inputs), `-subtle-base` (zebra whisper),
  `-contrast-base` (inverted panel for code, popovers, tooltips),
  `-highlight-{base,hover,interactive}` (brand-tied selection), `-modal-overlay` /
  `-backdrop-backdrop` (scrims), and `-accent-{neutral,blue,purple,success,warning,error}-{soft,base,strong}`.
- Foregrounds: `text-foreground-neutral-{base,subtle,muted,disabled}`,
  `-on-color` (on a saturated fill), `-on-inverted` (on a contrast surface),
  `-highlight-interactive` (link/CTA orange), `-highlight-error`.
- Borders: `border-border-neutral-{base,strong}`,
  `-highlights-interactive` (focus/active), `-highlights-{error,danger}`.

**Layer 3, component tokens.** Per-family sets that compose base, hover, pressed,
focus, and disabled for one component: `--background-button-*`, `--shadow-button-*`,
`--checkbox-*-*`. Do not clone these onto a new component; extend the layer.

### Primary

- **Shipfox Orange** (`brand` / `brand-deep`, `--color-primary-400` / `-500`): the
  single brand accent. `brand` is the inline-link and foreground accent
  (`--foreground-highlight-interactive`) in both themes, and the brand mark.
  `brand-deep` is the button focus ring at every theme, and the light-mode
  highlight surface (`--background-highlight-interactive`, which flips to `brand`
  in dark). `brand-tint` (`--color-primary-50`) is the faintest interactive wash
  on hover.

### Neutral

- **Ink** (`ink`, `--color-neutral-950`): primary text on light.
- **Subtle / Muted** (`subtle` `--color-neutral-600`, `muted` `--color-neutral-500`):
  secondary text and metadata.
- **Canvas / Surface** (`canvas` `--color-neutral-0`, `surface` `--color-neutral-50`):
  page and component backgrounds on light.
- **Panel Inverted** (`panel-inverted`, `--color-neutral-900`): the near-black
  surface used for code, logs, popovers, and tooltips in both themes.
- **Border** (`border`, `--color-neutral-300`): the default hairline.

Dark mode inverts these roles through the same token names (canvas becomes
`--color-neutral-900`, ink becomes `--color-neutral-100`, and so on); write once,
both themes resolve.

### Status and functional

Status is a functional palette, not a set of decorative secondaries. Each hue has
a dedicated `--tag-*` family (background, hover, border, text, icon) so pills flip
cleanly in dark mode. Consume them through the `Badge` component; never fabricate a
custom colored pill.

- **Running** (`running`, blue) for active execution.
- **Succeeded** (`succeeded`, green) for terminal success.
- **Failed** (`failed`, red) for failure, runner-lost, and timed-out.
- **Warning** (`warning`, orange) for manual gates and attention (awaiting runner).
- **Meta** (`meta`, purple) reserved for non-status taxonomy only: environment,
  tier, "internal" or "experimental" markers.
- **Neutral** for pending, queued, delayed, cancelled, and skipped.

The canonical run, job, and step states map onto these: `pending` / `queued` /
`delayed` neutral, `running` blue, `awaiting-runner` / `awaiting-manual` warning,
`succeeded` green, `failed` / `runner-disappeared` / `timed-out` red, `cancelled`
/ `skipped` dimmed neutral. Trigger and delivery surfaces reuse the same taxonomy
(`received` neutral, `routed` blue, `failed` red, and so on).

**The Warning-Light Rule.** Brand orange marks four things and nothing else:
the focus ring (always), the active or selected surface ("you are here"), inline
links, and the brand mark. It is deliberately *not* the primary button (that is
inverted neutral) and *not* a status hue (warning orange is a different scale,
`--color-orange-*`, from brand `--color-primary-*`). If you reach for orange to
make something feel branded, stop. The brand lives in monospace, density,
restraint, and that one precise ring.

<!-- vale off -->
**The Shape-Not-Just-Color Rule.** Status is never carried by color alone
(WCAG 1.4.1). A glyph shape or a written word always co-signs the hue, and the
status color lives in the dot, pill, glyph, or border, never as a full row or card
fill (which fights zebra rhythm and dark mode).
<!-- vale on -->

## Typography

**Display and UI Font:** Inter (self-hosted variable, weights 100 to 900, latin +
latin-ext, with italics). Fallback `sans-serif`.
**Code Font:** Commit Mono (self-hosted, weights 400 and 700). Fallback `monospace`.

**Character:** Inter is the dev-tool default for legibility at 13 to 14px; Commit
Mono carries warmth across the heavy log, YAML, and SHA surfaces. `html` enables
OpenType `rlig`, `calt`, and `lnum`, so digits are tabular by default in both
families: durations, run numbers, and counters do not jitter when they update.

### Hierarchy

- **Display** (Inter Medium, `text-4xl` 40px / `text-5xl` 56px): marketing hero
  only.
- **Headline** (Inter Medium, `text-3xl` 28px/44, `text-2xl` 24px/32): page titles
  and sub-headings.
- **Title** (Inter Medium, `text-xl` 18px/28, `text-lg` 16px/24): section headings
  and card headings.
- **Body** (Inter Regular, `text-md` 14px/24): default copy, form labels, button
  labels at md. `text-sm` 13px/20 for table body and helper text.
- **Label** (Inter Medium, `text-xs` 12px/20): tags, metadata, table footers.
- **Code** (Commit Mono, `text-sm` 13px/20): everything monospace.

Weights are regular (400) by default, medium (500) for headings and emphasized
labels, bold (700) rare and reserved for code emphasis or alert titles.

**The Use-The-Components Rule.** Typography flows through `Header`, `Text`, and
`Code` (`components/typography/*`). Write `<Header variant="h1">` and
`<Text size="sm">`, never a raw `<h1 class="text-3xl font-medium">`. Inlining the
scale scatters type decisions across the codebase.

**The Monospace-Is-Structure Rule.** Reach for `font-code` whenever the content is
something a user types, copies, or pattern-matches: source, YAML, JSON, logs and
command output, SHAs, IDs, paths, refs, URLs, durations, byte counts, sequence and
line numbers, capability tokens, and environment or tag values. Numbers written as
prose ("14 jobs failed") stay in `font-display`; numbers presented as data stay in
`font-code`.

## Layout

**The spatial model is grid-disciplined in the app, editorial only on marketing
and auth.** The app is a predictable top nav plus content plus optional right rail.
Marketing gets asymmetry and air; settings and admin look like the run viewer, not
the marketing page.

- **App shell.** Top header 56px, sticky, holding the logo, workspace crumb,
  project crumb, and user menu. A 40px tab strip sits sticky directly beneath and
  is always reserved (rendered even when empty) so navigation never jumps. No
  persistent left rail; all navigation chrome lives in the top bar. Content is
  fluid, capped at 1120px (`max-w-[1120px] mx-auto px-24 py-32`). A details right
  rail, when present, is 360 to 420px.
- **Marketing.** Single content column up to ~1280px, generous vertical rhythm,
  full-bleed background panels allowed.
- **Auth and onboarding.** Rendered under a bare layout: centered cards, no nav
  chrome.

**The Pixel-Spacing Rule.** `index.css` sets `--spacing: 1px`, so in this Tailwind
v4 setup **utility numbers are pixels**: `p-16` is 16px, `gap-8` is 8px, and `h-32`
is 32px. This is *not* stock Tailwind, where `p-4` would be 16px. Here `p-4` is
4px. The raw scale remains useful for token definitions and component internals.
Product surfaces should use the semantic roles below.

**Semantic spacing roles.** Values are listed as `default / compact` pixels.
Compact values apply below an ancestor with `data-density="compact"`.

| Family | Roles |
| --- | --- |
| Gaps | `gap-tight` 4 / 2, `gap-inline` 8 / 4, `gap-cluster` 12 / 8, `gap-group` 16 / 12, `gap-section` 24 / 16, `gap-region` 32 / 24 |
| Padding | `p-tight` and `px-tight` 8 / 4, `px-row` 16 / 12, `py-row` 12 / 8, `p-panel-compact` 16 / 12, `p-panel` 24 / 16, `px-frame` 24 / 16, `py-frame` 32 / 24 |
| Margins | `ms-inline` 8 / 4, `my-region` 32 / 24, `mt-page` 48 / 32, `-mt-inline` and `-mr-inline` -8 / -4 |

Use a parent `gap-*` role before adding a child margin. Use the negative inline
roles only to preserve a touch target's optical alignment with its containing
surface. Keep zero utilities for explicit resets. Use arbitrary spacing only for
a fixed optical offset, reserved control space, or asymmetric component contract
that has no semantic role.

**Density posture.** The default medium button is `h-32`; component sizing owns its
padding. Use `gap-group` for form row rhythm, `p-panel` for standard cards, and
`px-row` or `py-row` for row controls. A surface is at the wrong density when a
table needs horizontal scroll from cell padding, when an app page shows more
whitespace than content above the fold, or when a marketing page feels like a
settings panel.

## Elevation & Depth

Depth is conveyed by **multi-layer token-driven shadows**, not by flat tonal
layering alone. Every interactive surface composes a stack: a hairline top
highlight, a 1px key-line border, and one or two soft ambient drops. These stacks
are theme-aware inside the token, so a component never sets a raw shadow.

### Shadow Vocabulary

- **`--shadow-border-base`**: the default surface and input keyline (hairline ring
  plus faint drop). The resting elevation for fields and bordered chips.
- **`--shadow-button-inverted` / `-neutral` / `-danger` / `-success`**: the
  per-variant button stacks (key-line in the variant color plus ambient drop).
- **`--shadow-button-*-focus`**: the same stack plus a 2px halo and a 4px
  `--color-primary-500` ring. This is the button focus affordance; fields and
  inputs compose their own `--shadow-border-interactive-with-active` ring.
- **`--shadow-tooltip`**: the lifted stack for tooltips and popovers.
- **`--shadow-separator-inset`**: an inset top-highlight / bottom-shadow pair for
  hairline dividers inside dark panels.

**The Token-Only Shadow Rule.** Never write a custom `box-shadow` hex. Custom
shadows break in dark mode because they miss the theme-aware alpha layering the
tokens carry. If you need a new elevation, add a token.

**The Flat-Focus-Ring Rule.** An orange focus ring is universal and never
stripped, though the exact token differs by family: buttons compose
`--shadow-button-*-focus` (a `--color-primary-500` ring) and fields compose
`--shadow-border-interactive-with-active`. If a container's `overflow-hidden`
would clip the standard outset ring (as inside a log row frame), switch that one
control to an inset ring in `--color-primary-500` (theme-invariant), never remove
it.

## Shapes

The form language is **softly rounded, tight radii, hairline borders.** Corners
signal role, not decoration, and the radius scale is fixed:

- **4px** (`rounded-4`): inputs and status pills.
- **6px** (`rounded-6`): buttons and small cards. The default component corner.
- **8px** (`rounded-8`): cards and popovers.
- **10px** (`rounded-10`): modals and sheets.
- **12 to 16px**: marketing tiles and hero cards.
- **`rounded-full`**: avatars, status dots, and icon-only circular buttons.

Borders are 1px hairlines in `border-border-neutral-base`, used between table rows
in place of zebra fills. Silhouettes stay rectangular and calm; there are no
organic blobs, no clipped diagonals, no decorative geometry. Buttons are `rounded-6`,
pills are `rounded-4` or `rounded-full`, cards are `rounded-8`. Do not drift.

## Components

`@shipfox/react-ui` ships the batteries. Reach for an existing component before
building anything: `accordion`, `alert`, `avatar`, `badge`, `button`, `calendar`,
`callout`, `card`, `code-block`, `collapsible`, `combobox`, `command`,
`date-picker`, `date-range-picker`, `dot`, `dropdown-menu`, `empty-state`,
`form-field`, `icon`, `input`, `kbd`, `label`, `load-error-state`, `loader`, `log`,
`logo`, `markdown`, `modal`, `popover`, `radio-group`, `relative-time`,
`scroll-area`, `search`, `select`, `sheet`, `shiny-text`, `skeleton`, `table`,
`tabs`, `theme`, `toast`, `tooltip`, and `typography`.

### Buttons

- **Shape:** `rounded-6`. Sizes `2xs` (20px), `xs` (24), `sm` (28), `md` (32,
  default), `lg` (36), `xl` (40). Tables and run-viewer toolbars trend to `sm`;
  marketing CTAs to `lg`.
- **Primary:** inverted neutral fill (near-black on light, a mid-tone neutral on dark),
  `--background-button-inverted-*`. This is the dominant action in a form, modal,
  or header. It is deliberately not orange: primary actions recur constantly in
  tables and modals, and an orange fill would exhaust the eye and compete with
  status.
- **Secondary:** neutral surface, soft `--shadow-button-neutral`, subtle border.
- **Danger** (red) / **Success** (green): destructive and explicit-confirm actions;
  success is rare.
- **Transparent / TransparentMuted:** no fill, hover wash. The correct variant for
  inline icon buttons, table row actions, and nav items. Full primary buttons
  inside table rows scream; use these instead.

### Chips / Badges

- **Status badge:** `Badge` with a `--tag-*` family, `rounded-4` or `rounded-full`,
  `text-xs`. When state is the headline of a card or header, the pill is **color
  plus word only**: no leading glyph or dot inside a pill (a circle within a
  rounded border is too many surfaces in a small space).

### Cards / Containers

- **Corners** `rounded-8`, **background** `bg-background-components-base`, **padding**
  `p-24` default (`p-16` compact), **border** the hairline, **elevation** from the
  shadow tokens. Never tint a card or row background to match a status.

### Inputs / Fields

- `h-32` default, `--shadow-border-base` treatment, `text-md` body, `rounded-4`.
- **Labels** `Text size="sm"` medium; **helper** `Text size="xs"` muted; **error**
  `text-foreground-highlight-error` at `text-xs`. Focus shows the orange ring.

### Navigation

- **NavBar** `h-56`, sticky, `bg-background-subtle-base`, hairline bottom border,
  holding a theme-aware `Logo`, split-affordance workspace and project crumbs (name
  links to the entity, chevron opens a `Command`+`Popover` switcher), and a
  `UserMenu` on a 28px avatar with the theme switcher and logout.
- **ProjectTabs** `h-40`, sticky under the nav, always rendered; the active tab
  carries `border-b-2 border-border-highlights-interactive` and the indicator slide
  respects `prefers-reduced-motion`.

### Signature: the status glyph

Run, job, and step state in a dense node or row is drawn by `WorkflowStatusIcon`
(in `client-workflows`, composing the shared `Icon` and `Dot`): a circular glyph in
the saturated `--tag-*-icon` tone leading the row. A bold masked ring for pending
(not a thin dotted outline), check / X / slash discs for succeeded / failed /
cancelled-skipped (terminal neutrals dimmed), and a filled disc with an external
pulsing ripple halo for the live running state (one motion treatment, no spinner;
`motion-safe` only, degrading to a static disc under reduced motion). The glyph
carries the status as its accessible name (`role="img"` + `aria-label`) and a hover
tooltip. A 6px `Dot` is for pure presence, never for job state.

### Signature: code, log, and config surfaces

Multi-line code, log, and YAML content always renders in `font-code`, `text-sm`, on
the inverted contrast surface (`bg-background-contrast-base`) in both themes, since
code reads better on near-black even in light mode. Default to no-wrap with
horizontal scroll (engineers reach for soft-wrap themselves), show line numbers in
`text-foreground-neutral-muted`, and surface validation errors as a `Callout` above
the block with file and line, never color alone. New log lines append silently:
appending 50 lines a second with an entrance animation is nausea.

### Notices, icons, and loaders

- **`Callout`** is the canonical static notice (quiet neutral surface, saturated
  status side-line, `default` / `info` / `success` / `warning` / `error`) for
  inline guidance, form and server errors, and authored annotation cards. `Alert`
  is reserved for dismissible or animated notices.
- **`Icon`** wraps Remix Icon, Lucide, and custom Shipfox marks, sized with
  `size-*`. Use `@remixicon/react` for app utility icons and `lucide-react` for the
  warmer marketing icons, and never mix the two styles in one surface.
- **`ShipfoxLoader`** is the brand spinner for page-level and blocking loads; the
  inline `Icon name="spinner"` goes inside buttons and small spots.

## Do's and Don'ts

### Do:

- **Do** carry status with shape and color together, and keep the status color in
  the glyph, pill, or border (never a full row or card fill).
- **Do** route every color through a semantic or component token. A raw `#RRGGBB`
  outside `index.css` is a bug; push it into a token.
- **Do** use the typography components (`Header`, `Text`, `Code`) for all type.
- **Do** keep tables tight: sticky header, hairline row borders (not zebra),
  right-aligned tabular numerics, row hover surface, and inline actions in
  `transparent` / `transparentMuted` revealed on hover.
- **Do** respect `prefers-reduced-motion`: disable pulsing indicators and tab
  transitions, and give every icon-only button an `aria-label`.
- **Do** reserve motion for discrete events (150 to 250 ms ease-out for a state
  flip or a panel entering); let high-frequency data (logs, polling counters) swap
  silently.
- **Do** let marketing breathe more (`text-5xl` heads, `gap-64` sections) while
  keeping the same restraint.

### Don't:

- **Don't** make the primary button orange. Primary is inverted neutral; orange is
  the focus ring, the "you are here," and the link.
- **Don't** treat `p-4` as 16px. It is 4px here. This diverges from stock Tailwind.
- **Don't** write a custom `box-shadow`; use the `--shadow-*` tokens or add one, or
  dark mode breaks.
- **Don't** put decorative gradients on CTAs, or icons-in-colored-circles feature
  grids, or centered-everything hero triplets on marketing. Engineers smell hype a
  block away.
- **Don't** animate append-only high-frequency data, or tint a card or row
  background to match a status.
- **Don't** mix icon styles (Lucide next to Remix) in the same toolbar.
- **Don't** expand brand orange into status, or `meta` purple into running-state
  semantics.
