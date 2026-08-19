import '../index.css';
import type {Decorator, Preview} from '@storybook/react';
import {MotionConfig} from 'framer-motion';
import {ThemeProvider} from '#components/theme/index.js';

// Proactively trigger font fetches before any story renders. Argos's built-in
// waitForFonts only checks `document.fonts.status === "loaded"`, which is
// trivially true before a `font-display: swap` face has started fetching. The
// fallback can be captured on cold CI. Calling `document.fonts.load()`
// flips status to "loading", which Argos then correctly waits on.
if (typeof document !== 'undefined' && document.fonts) {
  void Promise.all([
    document.fonts.load("16px 'IBM Plex Sans'"),
    document.fonts.load("italic 16px 'IBM Plex Sans'"),
    document.fonts.load("16px 'Commit Mono'"),
    document.fonts.load("bold 16px 'Commit Mono'"),
  ]);
}

const ignoredRadixActWarningComponents = new Set([
  'DismissableLayer',
  'FocusScope',
  'Menu',
  'MenuSub',
  'Popper',
  'PopperContent',
  'Presence',
]);

const interpolatedActWarningRegex =
  /^An update to ([A-Za-z]+) inside a test was not wrapped in act\(\.\.\.\)\./;

function installRadixActWarningFilter() {
  if (typeof navigator === 'undefined' || navigator.webdriver !== true) {
    return;
  }

  const globalState = globalThis as typeof globalThis & {
    __shipfoxRadixActWarningFilterInstalled?: boolean;
  };

  if (globalState.__shipfoxRadixActWarningFilterInstalled) {
    return;
  }

  globalState.__shipfoxRadixActWarningFilterInstalled = true;
  // biome-ignore lint/suspicious/noConsole: Storybook browser tests must keep actionable console errors while filtering known Radix act warnings.
  const originalError = console.error;

  console.error = (...args) => {
    const [message] = args;
    if (typeof message === 'string') {
      const componentName =
        message.match(interpolatedActWarningRegex)?.[1] ??
        (message.startsWith('An update to %s inside a test was not wrapped in act(...)') &&
        typeof args[1] === 'string'
          ? args[1]
          : undefined);

      if (componentName && ignoredRadixActWarningComponents.has(componentName)) {
        return;
      }
    }

    originalError(...args);
  };
}

installRadixActWarningFilter();

const withTheme: Decorator = (Story, context) => {
  const theme = context.globals.theme;
  return (
    <ThemeProvider key={theme} defaultTheme={theme} storageKey={`shipfox-theme-${theme}`}>
      {Story()}
    </ThemeProvider>
  );
};

const withStaticMotionInTests: Decorator = (Story) => {
  if (typeof navigator === 'undefined' || navigator.webdriver !== true) {
    return Story();
  }

  return <MotionConfig skipAnimations>{Story()}</MotionConfig>;
};

const preview: Preview = {
  decorators: [withTheme, withStaticMotionInTests],
  parameters: {
    argos: {
      modes: {
        light: {theme: 'light'},
        dark: {theme: 'dark'},
      },
      fitToContent: false,
    },
    viewport: {
      viewports: {
        large: {
          name: 'Large Viewport',
          styles: {
            width: '1280px',
            height: '2000px',
          },
        },
        extraLarge: {
          name: 'Extra Large Viewport',
          styles: {
            width: '1920px',
            height: '2000px',
          },
        },
      },
    },
    options: {
      storySort: {
        method: 'alphabetical',
      },
    },
  },
  globalTypes: {
    theme: {
      name: 'Theme',
      description: 'Global theme for components',
      defaultValue: 'system',
      toolbar: {
        icon: 'sun',
        items: [
          {
            value: 'light',
            icon: 'sun',
            title: 'Light',
          },
          {
            value: 'dark',
            icon: 'moon',
            title: 'Dark',
          },
          {
            value: 'system',
            icon: 'info',
            title: 'System',
          },
        ],
        showName: true,
      },
    },
  },
};

export default preview;
