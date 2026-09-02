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
      modes: {dark: {theme: 'dark'}},
      fitToContent: false,
    },
    options: {storySort: {method: 'alphabetical'}},
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
