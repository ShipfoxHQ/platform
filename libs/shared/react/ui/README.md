# Shipfox React UI

Shared React component library for Shipfox apps. It provides design tokens, Tailwind CSS setup, common components, icons, theme state, hooks, and small UI utilities.

## What it does

- **Components**: Accordion, Alert, Avatar, Badge, Button, Calendar, Callout, CodeBlock, Collapsible, Combobox, Command, DatePicker, DateRangePicker, Dot, DropdownMenu, EmptyState, FormField, Icon, Input, Kbd, Label, LoadErrorState, Loader, Log, Logo, Markdown, Modal, Panel, Popover, RadioGroup, RelativeTime, ScrollArea, Search, Select, Sheet, ShinyText, Skeleton, Switch, Table, Tabs, Textarea, ThemeProvider, Toast, Tooltip, and Typography.
- **Theme helpers**: `ThemeProvider`, `useTheme()`, and `useResolvedTheme()`.
- **Hooks**: `useCopyToClipboard`, `useIsTextTruncated`, `useShikiHighlight`, `useShikiStyleInjection`, plus the theme hooks above.
- **Utilities**: `cn()` for class name merging, `copyTextToClipboard`, `formatBytes`, `formatDate`/`formatTimestamp`, `formatDuration`/`humanDuration`, `formatRelative`, `debounce`, and avatar helpers (`getInitial`, `getPlaceholderImageUrl`).
- **Icons**: Custom Shipfox icons plus the icon registry used by the `Icon` component.
- **CSS entry**: `@shipfox/react-ui/index.css` for fonts, Tailwind, animation utilities, and design tokens.

## Public API

### Surface roles

The `@shipfox/react-ui/index.css` entry defines four target surface roles for page and component authors.
The table records the target contract, not every token's current resolution. Until the migration
lands, light canvas uses `--color-alpha-black-2`, light inline fill resolves to `#fafafa`, and dark
code resolves to `#27272a`. See [the surface ladder in `DESIGN.md`](../../../../DESIGN.md#the-surface-ladder)
for the current-versus-target mapping.

| Role | Token | Target light | Target dark | Used for |
| --- | --- | --- | --- | --- |
| Canvas | `background-subtle-base` | `#fafafa` | `#0f0f10` | the page, nav bar, tab strip, rails, object headers, panel header strips |
| Panel | `background-neutral-base` | `#ffffff` | `#1a1a1b` | panel bodies, rows, popovers, modals |
| Code | `background-contrast-*` | `#1a1a1b` | `#030303` | code, logs, YAML, agent transcripts |
| Inline fill | `background-components-base` | `#f4f4f5` | `#27272a` | avatars, badges, kbd, chips inside a panel |

The ladder follows two rules:

- Panel sits one ramp step toward the foreground from canvas in both themes. A panel header strip sits one step below its panel, which is the canvas value.
- Page, panel, or code surfaces should use opaque tokens, because alpha composites over a parent that varies. During migration, light-mode canvas is the current exception: `background-subtle-base` uses `--color-alpha-black-2` and resolves to `#fafafa` over white.

## Imports

Import from a subpath. Each component has its own entry
(`@shipfox/react-ui/button`, `@shipfox/react-ui/panel`, ...); hooks live under
`@shipfox/react-ui/hooks` and utilities under `@shipfox/react-ui/utils`. This
keeps the dev server and bundlers from pulling the whole component tree (and its
Radix and icon dependencies) when you only need one component. The package root
(`@shipfox/react-ui`) is not importable: there is no root barrel, and a bare
import is blocked by lint.

## Setup

Install the package in a React app:

```json
{
  "dependencies": {
    "@shipfox/react-ui": "workspace:*"
  }
}
```

Import the CSS once near the app root:

```ts
import '@shipfox/react-ui/index.css';
```

Wrap the app with the theme provider:

```tsx
import {ThemeProvider} from '@shipfox/react-ui/theme';

export function AppRoot() {
  return (
    <ThemeProvider defaultTheme="system">
      <App />
    </ThemeProvider>
  );
}
```

## Usage

```tsx
import {Panel, PanelBody, PanelHeader, PanelRow, PanelTitle} from '@shipfox/react-ui/panel';

export function ProjectList() {
  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Projects</PanelTitle>
      </PanelHeader>
      <PanelBody>
        <PanelRow>Shipfox</PanelRow>
      </PanelBody>
    </Panel>
  );
}
```

`Panel` is the shared container for a data region. Use `PanelRow` for rows and
keep panels flat. Rows use a neutral hover surface, and status stays in glyphs or
pills. Use `PanelHeader` with `variant="plain"` for a titled block on a focused
surface.

Version 2 removes `Card`. Migrate `Card` to `Panel`, `CardHeader` to
`PanelHeader variant="plain"`, `CardTitle` to `PanelTitle`, `CardContent` to
`PanelBody`, `CardAction` to `PanelActions`, and `CardDescription` to a muted
`Text` component. Keep `CardFooter` content in the panel layout or a `PanelBody`.

`FormField` wires up label, input, error, and description with the correct `id`, `aria-invalid`, and `aria-describedby` plumbing. Render controls through `FormFieldInput` or `FormFieldTextarea` to inherit those props automatically:

```tsx
import {FormField, FormFieldInput, FormFieldTextarea} from '@shipfox/react-ui/form-field';

<FormField label="Email" id="email" error={error}>
  <FormFieldInput type="email" value={value} onChange={...} />
</FormField>

<FormField label="Notes" id="notes" error={error}>
  <FormFieldTextarea value={value} onChange={...} />
</FormField>
```

## Storybook

Components are documented in Storybook stories under `src/**/*.stories.tsx`:

```sh
pnpm --filter=@shipfox/react-ui storybook
```

For repository-wide story ordering and Argos rules, read the
[testing guide](../../../../docs/guides/testing.md). This package captures stories
in light and dark under `turbo test`.

## Build

The package builds JavaScript with SWC and CSS with Vite:

```sh
turbo build --filter=@shipfox/react-ui
```

The CSS build writes `dist/styles.css`. The package also exports `./index.css` for source CSS.

## Development

```sh
turbo check --filter=@shipfox/react-ui
turbo type --filter=@shipfox/react-ui
turbo build --filter=@shipfox/react-ui
turbo test --filter=@shipfox/react-ui
```

## License

MIT
