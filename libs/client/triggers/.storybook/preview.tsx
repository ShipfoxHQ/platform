import './preview.css';
import {RelativeTimeProvider} from '@shipfox/react-ui/relative-time';
import {ThemeProvider} from '@shipfox/react-ui/theme';
import type {Decorator, Preview} from '@storybook/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';

if (typeof document !== 'undefined' && document.fonts) {
  void Promise.all([
    document.fonts.load("16px 'IBM Plex Sans'"),
    document.fonts.load("italic 16px 'IBM Plex Sans'"),
    document.fonts.load("16px 'Commit Mono'"),
    document.fonts.load("bold 16px 'Commit Mono'"),
  ]);
}

const withTheme: Decorator = (Story, context) => {
  const theme = context.globals.theme;
  return (
    <ThemeProvider key={theme} defaultTheme={theme} storageKey={`shipfox-theme-${theme}`}>
      <Story />
    </ThemeProvider>
  );
};

const withRelativeTime: Decorator = (Story) => (
  <RelativeTimeProvider>
    <Story />
  </RelativeTimeProvider>
);

// The empty state renders `<Link to="/w/$workspaceSlug/settings/integrations">`, which needs a
// router in context to resolve its href. A memory router seeded at a matching path lets the
// story render the link without the real app shell.
const withRouter: Decorator = (Story) => {
  const rootRoute = createRootRoute();
  const integrationsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceSlug/settings/integrations',
    component: () => <Story />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([integrationsRoute]),
    history: createMemoryHistory({
      initialEntries: ['/w/ws-demo/settings/integrations'],
    }),
  });
  return <RouterProvider router={router} />;
};

const preview: Preview = {
  decorators: [withTheme, withRelativeTime, withRouter],
  parameters: {
    argos: {
      // Dual-theme coverage lives in @shipfox/react-ui (the theming source of truth);
      // feature packages capture only the primary dark theme to limit Argos spend.
      modes: {
        dark: {theme: 'dark'},
      },
      fitToContent: false,
    },
    options: {
      storySort: {method: 'alphabetical'},
    },
  },
  globalTypes: {
    theme: {
      name: 'Theme',
      description: 'Global theme for components',
      defaultValue: 'dark',
      toolbar: {
        icon: 'sun',
        items: [
          {value: 'light', icon: 'sun', title: 'Light'},
          {value: 'dark', icon: 'moon', title: 'Dark'},
          {value: 'system', icon: 'info', title: 'System'},
        ],
        showName: true,
      },
    },
  },
};

export default preview;
