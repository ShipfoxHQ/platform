## Building with @shipfox/react-ui

This is Shipfox's real component library (Radix + Tailwind v4, React 19). Compose screens
from `window.ShipfoxReactUi.*`; style your own layout glue with the design tokens below.

### Setup

`styles.css` carries everything (tokens, fonts, and component styles via `_ds_bundle.css`) —
load it once and components are styled out of the box. No provider is required for the default
(light) theme: the tokens resolve at `:root`.

Dark mode is opt-in. The library toggles a `.dark` class on `<html>` via `ThemeProvider`
(a bundle export). Wrap your tree in it only when you want dark or a theme switch:

```jsx
const { ThemeProvider, Button } = window.ShipfoxReactUi;
<ThemeProvider defaultTheme="dark"> … </ThemeProvider>   // omit for light
```

### Styling idiom — props first, then tokens

1. **Component appearance comes from props, never from restyling.** Components take
   `variant`, `size`, `tone`, `iconLeft`/`iconRight`, `isLoading`, etc. — read each
   component's `<Name>.prompt.md` for its exact API. Example: `<Button variant="danger"
   size="sm" iconLeft="google">`. The brand orange is the *interactive/focus* accent
   (`--foreground-highlight-interactive`), not a primary fill — the default primary Button is
   inverted neutral (dark). Use orange for links and focus, not for CTAs.

2. **For your own layout/styling, use the design tokens** — they are the reliable surface.
   `_ds_bundle.css` is a *static* Tailwind build: only utility classes the components already
   use are compiled (so `flex`, `flex-col`, `gap-16`, `text-foreground-neutral-subtle` exist,
   but an arbitrary class like `bg-background-accent-blue-soft` is NOT emitted and renders
   nothing). When in doubt, reference the CSS variables directly via `style`, which always
   resolve:

   ```jsx
   <div style={{ display: 'flex', gap: 16,
     color: 'var(--foreground-neutral-subtle)',
     background: 'var(--background-components-base)',
     border: '1px solid var(--border-neutral-base)' }} />
   ```

   Token families (names verbatim in `_ds_bundle.css`):
   - `--foreground-*` — text/icon color: `neutral-{base,subtle,muted,disabled,on-color}`,
     `contrast-*`, `highlight-interactive` (orange), `highlight-error`.
   - `--background-*` — surfaces: `components-{base,hover,pressed}`, `field-*`, `neutral-*`,
     `subtle-*`, `accent-{blue,purple,success,warning,error,neutral}-{soft,base,strong}`,
     `button-{inverted,neutral,danger,success,transparent}-*`, `modal-overlay`.
   - `--border-*` — `neutral-{base,strong,transparent}`, `contrast-*`, `highlights-*`.
   - `--ring-*`, `--shadow-*` — focus rings and elevation. `--font-sans`, `--font-mono`.
   - **Spacing base is 1px**: Tailwind spacing maps directly to pixels (`gap-16` = 16px,
     `p-4` = 4px), so token-driven numbers are literal pixels.

### Where the truth lives

- `styles.css` → its `@import` closure (`_ds_bundle.css`, tokens, fonts) is the full token list.
- `components/<group>/<Name>/<Name>.prompt.md` — per-component API, variants, and example JSX.
  Read it before composing a component.
