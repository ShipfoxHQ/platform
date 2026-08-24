import {readdirSync} from 'node:fs';
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
const storybookFilePattern = /\.stories\.(?:[cm]?[jt]sx?|mdx)$/;

function hasStorybookStories(directory: string): boolean {
  return readdirSync(directory, {withFileTypes: true}).some((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return hasStorybookStories(entryPath);
    return entry.isFile() && storybookFilePattern.test(entry.name);
  });
}

function createStorybookProject() {
  return {
    extends: true as const,
    plugins: [
      storybookTest({configDir: path.join(dirname, '.storybook')}),
      argosVitestPlugin({
        uploadToArgos: !!process.env.CI,
        ...(process.env.ARGOS_TOKEN ? {token: process.env.ARGOS_TOKEN} : {}),
        buildName: 'client-onboarding',
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
        provider: playwright({
          launchOptions: {
            args: ['--disable-lcd-text', '--font-render-hinting=none'],
          },
          // The completion burst uses requestAnimationFrame, so visual captures need a static frame.
          contextOptions: {reducedMotion: 'reduce'},
        }),
        instances: [{browser: 'chromium' as const}],
      },
    },
  };
}

export default defineConfig(
  {
    plugins: [react(), tailwindcss()],
    test: {
      projects: [
        {
          extends: true,
          test: {
            name: 'node',
            environment: 'node',
            include: ['src/**/*.test.ts'],
          },
        },
        {
          extends: true,
          test: {
            name: 'dom',
            environment: 'jsdom',
            // Files are isolation-safe (test/setup.ts resets DOM + api client), so reuse the
            // module graph across files in a worker instead of re-importing it per file.
            isolate: false,
            include: ['src/**/*.test.tsx'],
            setupFiles: ['test/setup.ts'],
          },
        },
        ...(hasStorybookStories(path.join(dirname, 'src')) ? [createStorybookProject()] : []),
      ],
    },
  },
  import.meta.url,
) as UserConfigExport;
