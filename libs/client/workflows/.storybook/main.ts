import type {StorybookConfig} from '@storybook/react-vite';
import sharedConfig from '../../.storybook/main.ts';
import {withWorkspaceSource} from './workspace-source.ts';

const config: StorybookConfig = {
  ...sharedConfig,
  viteFinal: async (viteConfig, options) => {
    const sharedViteConfig = sharedConfig.viteFinal
      ? await sharedConfig.viteFinal(viteConfig, options)
      : viteConfig;

    return withWorkspaceSource(sharedViteConfig);
  },
};

export default config;
