import {createRequire} from 'node:module';
import type {StorybookConfig} from '@storybook/react-vite';

const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../src/**/*.stories.@(js|jsx|ts|tsx|mdx)'],
  addons: ['storybook-addon-pseudo-states', '@storybook/addon-vitest'],
  core: {
    disableTelemetry: true,
  },
  viteFinal: async (config) => {
    const require = createRequire(`${process.cwd()}/package.json`);
    const {default: tailwindcss} = await import(require.resolve('@tailwindcss/vite'));

    config.plugins = config.plugins ?? [];
    config.plugins.push(tailwindcss());

    return config;
  },
};

export default config;
