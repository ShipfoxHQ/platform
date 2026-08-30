import './preview.css';
import {type Theme, ThemeProvider} from '@shipfox/react-ui/theme';
import {DocsContainer, type DocsContainerProps} from '@storybook/addon-docs/blocks';
import type {Decorator, Preview} from '@storybook/react';
import {useEffect, useState} from 'react';
import {GLOBALS_UPDATED} from 'storybook/internal/core-events';
import type {GlobalsUpdatedPayload} from 'storybook/internal/types';
import {themes as storybookThemes, type ThemeVars} from 'storybook/theming';

function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system';
}

function getThemeFromParentUrl(): Theme {
  if (typeof window === 'undefined') return 'system';

  const globals = new URL(window.parent.location.href).searchParams.get('globals');
  const theme = globals
    ?.split(';')
    .find((global) => global.startsWith('theme:'))
    ?.slice(6);

  return isTheme(theme) ? theme : 'system';
}

function getResolvedTheme(theme: Theme): 'light' | 'dark' {
  if (theme !== 'system') return theme;
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

function themeColor(isDark: boolean, dark: string, light: string): string {
  return isDark ? dark : light;
}

function getDocsTheme(theme: Theme): ThemeVars {
  const resolvedTheme = getResolvedTheme(theme);
  const baseTheme = storybookThemes[resolvedTheme];
  const isDark = resolvedTheme === 'dark';

  return {
    ...baseTheme,
    base: resolvedTheme,
    appBg: themeColor(isDark, '#1a1a1b', '#ffffff'),
    appContentBg: themeColor(isDark, '#030303', '#fafafa'),
    appHoverBg: themeColor(isDark, '#27272a', '#f4f4f5'),
    appPreviewBg: themeColor(isDark, '#1a1a1b', '#ffffff'),
    appBorderColor: themeColor(isDark, '#27272a', '#d4d4d8'),
    colorPrimary: '#ff4b00',
    colorSecondary: '#ff4b00',
    textColor: themeColor(isDark, '#f4f4f5', '#0f0f10'),
    textInverseColor: themeColor(isDark, '#0f0f10', '#ffffff'),
    textMutedColor: '#71717a',
    barTextColor: '#71717a',
    barHoverColor: themeColor(isDark, '#ff9e7a', '#e63e00'),
    barSelectedColor: '#ff4b00',
    barBg: themeColor(isDark, '#1a1a1b', '#ffffff'),
    buttonBg: themeColor(isDark, 'rgba(255, 255, 255, 0.04)', '#ffffff'),
    buttonBorder: themeColor(isDark, 'rgba(255, 255, 255, 0.1)', '#d4d4d8'),
    booleanBg: themeColor(isDark, 'rgba(255, 255, 255, 0.04)', '#ffffff'),
    booleanSelectedBg: themeColor(isDark, '#4d1300', '#fff4f0'),
    inputBg: themeColor(isDark, 'rgba(255, 255, 255, 0.04)', '#ffffff'),
    inputBorder: themeColor(isDark, '#27272a', '#d4d4d8'),
    inputTextColor: themeColor(isDark, '#f4f4f5', '#0f0f10'),
  };
}

function DesignSystemDocsContainer({children, context}: DocsContainerProps) {
  const [theme, setTheme] = useState<Theme>(getThemeFromParentUrl);

  useEffect(() => {
    const onGlobalsUpdated = ({globals}: GlobalsUpdatedPayload) => {
      if (isTheme(globals.theme)) setTheme(globals.theme);
    };

    context.channel.on(GLOBALS_UPDATED, onGlobalsUpdated);
    return () => context.channel.off(GLOBALS_UPDATED, onGlobalsUpdated);
  }, [context.channel]);

  return (
    <ThemeProvider key={theme} defaultTheme={theme} storageKey={`shipfox-storybook-theme-${theme}`}>
      <DocsContainer context={context} theme={getDocsTheme(theme)}>
        {children}
      </DocsContainer>
    </ThemeProvider>
  );
}

const withTheme: Decorator = (Story, context) => {
  const theme = context.globals.theme;

  return (
    <ThemeProvider key={theme} defaultTheme={theme} storageKey={`shipfox-storybook-theme-${theme}`}>
      <Story />
    </ThemeProvider>
  );
};

const preview: Preview = {
  decorators: [withTheme],
  globalTypes: {
    theme: {
      name: 'Theme',
      description: 'Global theme for the Storybook shell',
      defaultValue: 'system',
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
  parameters: {
    docs: {
      container: DesignSystemDocsContainer,
    },
    options: {
      storySort: {method: 'alphabetical'},
    },
  },
};

export default preview;
