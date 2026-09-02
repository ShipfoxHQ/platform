# Shipfox Client Shell

Browser shell and compile-time composition contracts for Shipfox client applications.

## What it does

- **`defineClientFeature()` and authoring types** define Node-safe routes,
  layouts, providers, navigation entries, settings sections, and runtime
  configuration fragments.
- **`@shipfox/client-shell/runtime`** provides the browser provider stack,
  router helpers, authentication state, chrome slots, route frames, and layout
  navigation registry.
- **`ApplicationLayout`** renders the standard authenticated application
  header, navigation strip, route frame, account menu, and session banner for a
  root-parented feature that has no active workspace.
- **`@shipfox/client-shell/vite`** validates the feature graph and generates the
  application's typed TanStack Router tree.
- **`@shipfox/client-shell/testing`** provides the shell provider stack for
  package tests and Storybook stories.

## Installation and setup

```sh
pnpm add @shipfox/client-shell
```

Install the package's React, TanStack Router, React Query, Jotai, Vite, and Zod
peer dependencies at the versions required by the consuming application. A
composed application supplies browser chrome slots through `composeClientApp()`
or `ChromeProvider`.

## Usage

Use `ApplicationLayout` for an authenticated feature layout parented at the
root anchor. Filter navigation by the application's authorization policy before
passing it to the shell.

```tsx
import {defineClientFeature} from '@shipfox/client-shell';
import {
  ApplicationLayout,
  defineRoute,
  useLayoutNavigation,
} from '@shipfox/client-shell/runtime';

export const administrationFeature = defineClientFeature({
  id: 'acme.administration',
  layouts: [
    {
      id: 'acme.administration',
      path: '/admin',
      parent: 'root',
      impl: './routes/admin-layout',
    },
  ],
  navigation: [
    {
      id: 'admin.overview',
      scope: 'layout',
      layout: 'acme.administration',
      label: 'Overview',
      to: '/admin/overview',
      exact: true,
      minimumRole: 'administrator',
    },
  ],
});

function AdminLayout() {
  const entries = useLayoutNavigation('acme.administration');
  const currentRole = 'administrator';
  const visibleEntries = entries.filter((entry) =>
    entry.minimumRole === undefined || entry.minimumRole === currentRole,
  );

  return (
    <ApplicationLayout
      context={<span>Administration</span>}
      navigation={{
        ariaLabel: 'Administration sections',
        entries: visibleEntries,
      }}
    />
  );
}

export default defineRoute({
  staticData: {frame: 'content'},
  component: AdminLayout,
});
```

`ApplicationLayout` renders its `children` when provided and otherwise renders
the current route's `Outlet`.

## Routes

The root, workspace, project, workspace-settings, and project-settings anchors
are the stable shell parents. Feature-owned layouts can attach below an anchor
and become parents for routes from other features. See
[ADR 0001](../../../docs/adr/0001-client-composition-contract.md) for the
composition and collision rules.

## Behavior notes

- `ApplicationLayout` follows the shared authentication state but never
  requires an active workspace or project.
- Layout navigation accepts only `scope: 'layout'` entries. The shell uses
  `exact` for active-link matching and treats `minimumRole` as opaque metadata.
- The 40px navigation strip remains mounted when `entries` is empty. It scrolls
  horizontally without a visible scrollbar when links exceed the viewport.
- The shared header owns the Docs link, user identity, theme selection, account
  menu slot, and logout action.
- The shared frame resolves the deepest route's `content`, `data`, or `focused`
  declaration and accounts for the measured session-banner height.
- Consumers import browser components from `@shipfox/client-shell/runtime`.
  The package root remains safe for build-time feature evaluation.

## Development

```sh
mise exec -- turbo check --filter=@shipfox/client-shell
mise exec -- turbo type --filter=@shipfox/client-shell
mise exec -- turbo test --filter=@shipfox/client-shell
mise exec -- turbo build --filter=@shipfox/client-shell
mise exec -- turbo test:external --filter=@shipfox/client-shell
```

The external-consumer fixture builds, tests, and type-checks the package from
packed tarballs.

## License

MIT
