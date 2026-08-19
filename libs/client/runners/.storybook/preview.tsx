import './preview.css';
import {ThemeProvider} from '@shipfox/react-ui/theme';
import type {Decorator, Preview} from '@storybook/react';

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

const preview: Preview = {
  decorators: [withTheme],
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
