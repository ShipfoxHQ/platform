# Shipfox React UI — how to build with it

A React + Tailwind CSS v4 design system. You compose its real components and drive
their look through **props** (variant / size / tone), not by hand-writing component
styles. Use Tailwind utility classes only for your own layout glue around them.

## Wrapping & theme

Wrap the tree in **`ThemeProvider`** (a bundle export) so light/dark works — it sets
the `dark` class that every component's `dark:` styles read, and supplies theme
context that components like the theme switch consume. Without it components still
render, but dark mode never toggles.

```jsx
<ThemeProvider defaultTheme="system">
  <App />
</ThemeProvider>
```

Fonts and component styles load from the bound **`styles.css`**, which `@import`s
`_ds_bundle.css` (all component CSS + design tokens) and `fonts/fonts.css`
(**Inter** for text via `--font-sans`, **Commit Mono** for code via `--font-mono`).
Load `styles.css` once; nothing renders styled without it.

## Styling idiom — props first, then utilities

- **Component look comes from props.** Common axes:
  - `Button` — `variant`: `primary` (inverted neutral / near-black), `secondary`,
    `danger`, `success`, `transparent`, `transparentMuted`; `size`: `2xs|xs|sm|md|lg|xl`;
    `iconLeft` / `iconRight` (icon-NAME strings, e.g. `"github"`); `isLoading`.
  - `Badge` — `variant`: `info|success|warning|error|neutral|feature`; `size`: `2xs|xs`;
    `radius`: `default|rounded`.
  - `Header` — `variant`: `h1|h2|h3|h4`. `Text`/`Code` carry size/weight variants.
  - `Icon` — `name` (string, e.g. `"check"`, `"close"`, `"copy"`, `"info"`, `"search"`,
    `"github"`, `"google"`, `"microsoft"`, `"shipfox"`, `"slack"`, `"chevronRight"`),
    plus `size`, `color`.
- **Tailwind utilities for your own layout/spacing glue**, and note the spacing base:
  this DS sets `--spacing: 1px`, so spacing/size/radius numbers are **1px-scaled** —
  `p-16` = 16px, `gap-8` = 8px, `rounded-8` = 8px, `h-320` = 320px. Multiply the
  number by 1px, not 0.25rem. Layout utilities (`flex`, `flex-col`, `items-center`,
  `gap-*`, `grid`) work as usual.
- **Color is via SEMANTIC utility classes, not a raw `primary`/`gray` scale.** Use:
  - text: `text-foreground-neutral-base` / `-muted` / `-subtle` / `-on-color`,
    `text-foreground-contrast-primary`, `text-foreground-highlight-interactive`
  - surfaces: `bg-background-neutral-base` / `-background` / `-overlay` / `-disabled`,
    `bg-background-subtle-base`, `bg-background-components-base`, `bg-background-field-base`
  - borders: `border-border-neutral-base` / `-strong`
  - tag accents: `bg-tag-{blue,success,warning,error,neutral,purple}-{bg,icon}`
  The raw ramps `--color-primary-50…950` (orange), `--color-accent-*`,
  `--color-alpha-{black,white}-*` exist only as CSS variables behind those semantic
  classes — reach for them via `var(--color-…)` only when no semantic class fits.
- **Brand orange is the focus / interactive-highlight color, not the primary fill.**
  The default primary `Button` is inverted neutral (dark). For "interactive / you are
  here" accents use the `*-foreground-highlight-interactive` classes, not a fill.

## Where the truth lives

Before styling, read the bound **`styles.css`** and the `_ds_bundle.css` /
`fonts/fonts.css` it imports for the real token names, and each component's
**`<Name>.prompt.md`** + **`<Name>.d.ts`** for its exact prop contract.

## Example

```jsx
<ThemeProvider defaultTheme="system">
  <div className="flex flex-col gap-12 p-16 rounded-8 bg-background-neutral-base text-foreground-neutral-base">
    <div className="flex items-center gap-8">
      <Badge variant="success" size="xs">Live</Badge>
      <Header variant="h3">Deployments</Header>
    </div>
    <div className="flex gap-8">
      <Button variant="primary" iconLeft="github">Connect repo</Button>
      <Button variant="secondary">Cancel</Button>
    </div>
  </div>
</ThemeProvider>
```
