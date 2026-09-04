import * as path from 'node:path';
import {fileURLToPath} from 'node:url';
import {argosVitestPlugin} from '@argos-ci/storybook/vitest-plugin';
import {defineConfig, type UserConfigExport} from '@shipfox/vitest';
import {storybookTest} from '@storybook/addon-vitest/vitest-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {playwright} from '@vitest/browser-playwright';

const dirname =
  typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(
  {
    plugins: [react(), tailwindcss()],
    test: {
      projects: [
        {extends: true, test: {name: 'node', environment: 'node', include: ['src/**/*.test.ts']}},
        {
          extends: true,
          test: {
            name: 'dom',
            environment: 'jsdom',
            isolate: false,
            include: ['src/**/*.test.tsx'],
            setupFiles: ['test/setup.ts'],
          },
        },
        {
          extends: true,
          plugins: [
            storybookTest({configDir: path.join(dirname, '.storybook')}),
            argosVitestPlugin({
              uploadToArgos: !!process.env.CI,
              ...(process.env.ARGOS_TOKEN ? {token: process.env.ARGOS_TOKEN} : {}),
              buildName: 'client-usage',
              argosCSS: `
                *, *::before, *::after {
                  animation-delay: 0s !important;
                  animation-duration: 0s !important;
                  transition-delay: 0s !important;
                  transition-duration: 0s !important;
                }
              `,
            }),
          ],
          test: {
            name: 'storybook',
            browser: {
              enabled: true,
              headless: true,
              provider: playwright(),
              instances: [{browser: 'chromium'}],
            },
          },
        },
      ],
    },
  },
  import.meta.url,
) as UserConfigExport;
