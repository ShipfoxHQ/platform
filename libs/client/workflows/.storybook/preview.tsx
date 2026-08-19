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

const STORYBOOK_NOW_MS = Date.parse('2026-06-26T12:00:00.000Z');

Object.defineProperty(Date, 'now', {
  configurable: true,
  writable: true,
  value: () => STORYBOOK_NOW_MS,
});

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

// Run rows render `<Link to="/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId">` and read
// `useParams`, both of which need a router in context. A memory router seeded at a
// matching path lets the rows render and resolve their hrefs without a real app shell.
const withRouter: Decorator = (Story) => {
  const rootRoute = createRootRoute();
  const runRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId',
    component: () => <Story />,
  });
  const jobDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId/jobs/$jobId',
    component: () => <Story />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([runRoute, jobDetailRoute]),
    history: createMemoryHistory({
      initialEntries: ['/w/ws-demo/p/proj-demo/runs/run-1/jobs/job-1'],
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
