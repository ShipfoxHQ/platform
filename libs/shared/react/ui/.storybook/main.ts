import type {StorybookConfig} from '@storybook/react-vite';

const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../src/**/*.stories.@(js|jsx|ts|tsx|mdx)'],
  addons: ['storybook-addon-pseudo-states'],
  viteFinal: async (config) => {
    const [{default: react}, {default: tailwindcss}, {dirname, resolve}, {fileURLToPath}] =
      await Promise.all([
        import('@vitejs/plugin-react'),
        import('@tailwindcss/vite'),
        import('node:path'),
        import('node:url'),
      ]);

    config.plugins = config.plugins ?? [];
    config.plugins.push(react(), tailwindcss());

    const currentFile = fileURLToPath(import.meta.url);
    const currentDir = dirname(currentFile);

    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...config.resolve.alias,
      '#components': resolve(currentDir, '../src/components'),
      '#hooks': resolve(currentDir, '../src/hooks'),
      '#state': resolve(currentDir, '../src/state'),
      '#utils': resolve(currentDir, '../src/utils'),
    };

    return config;
  },
};

export default config;
