import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {composeLayouts, composeRoutes} from '#compose/compose-routes.js';
import {navigationEntries, settingsEntries} from '#runtime/registries.js';
import {features} from '#test/fixtures/features.js';
import {generateAppModule} from './generate.js';

const goldenFile = fileURLToPath(
  new URL('../../test/typecheck/shipfox-app.gen.ts', import.meta.url),
);

describe('generateAppModule', () => {
  test('matches the checked composition fixture', async () => {
    const generated = generateAppModule({
      routes: composeRoutes(features),
      navigation: navigationEntries(features),
      settingsSections: settingsEntries(features),
    });

    await expect(readFile(goldenFile, 'utf8')).resolves.toBe(generated);
  });

  test('declares nested layout trees from child to parent', () => {
    const nestedFeatures = [
      {
        id: 'nested-layouts',
        layouts: [
          {id: 'nested.outer', path: '/admin', parent: 'root' as const, impl: 'outer'},
          {
            id: 'nested.inner',
            path: '/admin/settings',
            parent: 'nested.outer',
            impl: 'inner',
          },
        ],
        routes: [
          {
            path: '/admin/settings/users',
            parent: 'nested.inner',
            impl: 'users',
          },
        ],
      },
    ];
    const generated = generateAppModule({
      layouts: composeLayouts(nestedFeatures),
      routes: composeRoutes(nestedFeatures),
      navigation: [],
      settingsSections: [],
    });

    expect(generated.indexOf('const layout1Tree')).toBeLessThan(
      generated.indexOf('const layout0Tree'),
    );
  });
});
