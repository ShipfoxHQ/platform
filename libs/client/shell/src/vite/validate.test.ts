import {z} from 'zod';
import {composeRoutes} from '#compose/compose-routes.js';
import {mergeConfigShapes} from '#compose/merge-config.js';
import {validateProviderIds} from '#compose/validate-providers.js';
import {validateNavigation, validateSettingsSections} from '#compose/validate-registries.js';
import {defineClientFeature} from '#contract.js';

const route = {path: '/projects', parent: 'root' as const, impl: '#test/default-route-impl.js'};

describe('composition validation', () => {
  test('accepts non-conflicting feature contributions', () => {
    const features = [
      defineClientFeature({
        id: 'acme.projects',
        routes: [
          route,
          {
            path: '/w/$workspaceSlug/settings/members',
            parent: 'workspaceSettings',
            impl: '#test/default-route-impl.js',
          },
        ],
        providers: [{id: 'acme-theme', Component: () => null}],
        navigation: [{id: 'projects', scope: 'workspace', label: 'Projects', to: '/projects'}],
        settingsSections: [
          {id: 'members', pathSegment: 'members', label: 'Members', icon: 'users'},
        ],
        configShape: {projectId: z.string()},
      }),
    ];

    const routes = composeRoutes(features);

    expect(() => validateProviderIds(features)).not.toThrow();
    expect(() =>
      validateNavigation(
        features,
        routes.map(({path}) => path),
      ),
    ).not.toThrow();
    expect(() =>
      validateSettingsSections(
        features,
        routes.map(({path}) => path),
      ),
    ).not.toThrow();
    expect(() => mergeConfigShapes(features)).not.toThrow();
  });

  test('reports route collisions with both feature ids', () => {
    const features = [
      defineClientFeature({id: 'shipfox.projects', routes: [route]}),
      defineClientFeature({id: 'acme.projects', routes: [route]}),
    ];

    expect(() => composeRoutes(features)).toThrow(
      'Route "/projects" is contributed by both features "shipfox.projects" and "acme.projects". Set override: true to replace it explicitly.',
    );
  });

  test('reports dangling and competing overrides with their feature ids', () => {
    const dangling = [
      defineClientFeature({id: 'acme.projects', routes: [{...route, override: true}]}),
    ];
    const competing = [
      defineClientFeature({id: 'shipfox.projects', routes: [route]}),
      defineClientFeature({id: 'acme.one', routes: [{...route, override: true}]}),
      defineClientFeature({id: 'acme.two', routes: [{...route, override: true}]}),
    ];

    expect(() => composeRoutes(dangling)).toThrow(
      'Route override for "/projects" from feature "acme.projects" has no route to replace.',
    );
    expect(() => composeRoutes(competing)).toThrow(
      'Route "/projects" has competing overrides from features "acme.one" and "acme.two".',
    );
  });

  test('reports reserved and duplicate provider ids', () => {
    const reserved = [
      defineClientFeature({id: 'acme.theme', providers: [{id: 'theme', Component: () => null}]}),
    ];
    const duplicate = [
      defineClientFeature({id: 'acme.one', providers: [{id: 'flags', Component: () => null}]}),
      defineClientFeature({id: 'acme.two', providers: [{id: 'flags', Component: () => null}]}),
    ];

    expect(() => validateProviderIds(reserved)).toThrow(
      'Provider id "theme" in feature "acme.theme" is reserved by the shell.',
    );
    expect(() => validateProviderIds(duplicate)).toThrow(
      'Provider id "flags" is contributed by both features "acme.one" and "acme.two".',
    );
  });

  test('reports duplicate and missing navigation entries', () => {
    const duplicate = [
      defineClientFeature({
        id: 'acme.one',
        navigation: [{id: 'projects', scope: 'workspace', label: 'Projects', to: '/projects'}],
      }),
      defineClientFeature({
        id: 'acme.two',
        navigation: [{id: 'projects', scope: 'workspace', label: 'Projects', to: '/projects'}],
      }),
    ];
    const missing = [
      defineClientFeature({
        id: 'acme.insights',
        navigation: [{id: 'insights', scope: 'workspace', label: 'Insights', to: '/insights'}],
      }),
    ];

    expect(() => validateNavigation(duplicate, ['/projects'])).toThrow(
      'Navigation entry "projects" is contributed by both features "acme.one" and "acme.two".',
    );
    expect(() => validateNavigation(missing, [])).toThrow(
      'Navigation entry "insights" in feature "acme.insights" targets missing route "/insights".',
    );
  });

  test('reports duplicate and missing settings sections', () => {
    const duplicate = [
      defineClientFeature({
        id: 'acme.one',
        settingsSections: [
          {id: 'members', pathSegment: 'members', label: 'Members', icon: 'users'},
        ],
      }),
      defineClientFeature({
        id: 'acme.two',
        settingsSections: [
          {id: 'members', pathSegment: 'members', label: 'Members', icon: 'users'},
        ],
      }),
    ];
    const missing = [
      defineClientFeature({
        id: 'acme.insights',
        settingsSections: [
          {id: 'insights', pathSegment: 'insights', label: 'Insights', icon: 'chart-line'},
        ],
      }),
    ];

    expect(() =>
      validateSettingsSections(duplicate, ['/w/$workspaceSlug/settings/members']),
    ).toThrow(
      'Settings section "members" is contributed by both features "acme.one" and "acme.two".',
    );
    expect(() => validateSettingsSections(missing, [])).toThrow(
      'Settings section "insights" in feature "acme.insights" requires route "/w/$workspaceSlug/settings/insights".',
    );
  });

  test('reports duplicate config keys', () => {
    const features = [
      defineClientFeature({id: 'acme.one', configShape: {token: z.string()}}),
      defineClientFeature({id: 'acme.two', configShape: {token: z.string()}}),
    ];

    expect(() => mergeConfigShapes(features)).toThrow(
      'Config key "token" is contributed by both features "acme.one" and "acme.two". Reuse the same schema instance to intentionally share it.',
    );
  });
});
