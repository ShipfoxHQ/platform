# Shipfox React UI

Shared React component library for Shipfox apps. It provides design tokens, Tailwind CSS setup, common components, icons, theme state, and small UI utilities.

## What it does

- **Components**: Alert, Badge, Button, Card, Icon, Input, Label, Loader, Skeleton, ThemeProvider, Toast, Tooltip, and Typography.
- **Theme helpers**: `ThemeProvider`, `useTheme()`, and `useResolvedTheme()`.
- **Icons**: Custom Shipfox icons plus the icon registry used by the `Icon` component.
- **Utilities**: `cn()` for class name merging.
- **CSS entry**: `@shipfox/react-ui/index.css` for fonts, Tailwind, animation utilities, and design tokens.

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
import {ThemeProvider} from '@shipfox/react-ui';

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
import {Button, Card, CardContent, CardTitle, Text} from '@shipfox/react-ui';

export function EmptyState() {
  return (
    <Card>
      <CardTitle>No projects yet</CardTitle>
      <CardContent>
        <Text size="sm">Create a project to start running workflows.</Text>
      </CardContent>
      <Button iconLeft="plus">Create project</Button>
    </Card>
  );
}
```

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
```

## License

MIT
