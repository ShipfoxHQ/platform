import type {ClientFeature} from '#contract.js';
import {composeLayouts, composeRoutes} from './compose-routes.js';
import {validateNavigation, validateSettingsSections} from './validate-registries.js';

const duplicateNavigationMessage = /projects.*shipfox\.one.*acme\.two/u;
const missingNavigationMessage = /insights.*acme\.two.*\/insights/u;
const duplicateSettingsMessage = /members.*shipfox\.one.*acme\.two/u;
const missingSettingsMessage = /sso.*acme\.two.*\/w\/\$workspaceSlug\/settings\/sso/u;

describe('registry validation', () => {
  test('accepts child navigation scoped to a feature-owned layout', () => {
    const features = [
      {
        id: 'acme.admin',
        layouts: [
          {id: 'acme.admin.layout', path: '/admin', parent: 'root' as const, impl: 'admin'},
          {
            id: 'acme.admin.settings',
            path: '/admin/settings',
            parent: 'acme.admin.layout',
            impl: 'settings',
          },
        ],
      },
      {
        id: 'acme.users',
        routes: [{path: '/admin/settings/users', parent: 'acme.admin.settings', impl: 'users'}],
        navigation: [
          {
            id: 'admin.users',
            scope: 'layout' as const,
            layout: 'acme.admin.layout',
            label: 'Users',
            to: '/admin/settings/users',
            minimumRole: 'observer',
          },
        ],
      },
    ];
    const layouts = composeLayouts(features);
    const routes = composeRoutes(features, layouts);

    expect(() => validateNavigation(features, routes, layouts)).not.toThrow();
  });

  test('names missing layout and invalid role metadata', () => {
    const missingLayout = [
      {
        id: 'acme.users',
        navigation: [
          {
            id: 'admin.users',
            scope: 'layout' as const,
            layout: 'acme.missing',
            label: 'Users',
            to: '/admin/users',
          },
        ],
      },
    ];
    expect(() => validateNavigation(missingLayout, ['/admin/users'])).toThrow(
      'Navigation entry "admin.users" in feature "acme.users" targets missing layout "acme.missing".',
    );

    const invalidRole = [
      {
        id: 'acme.users',
        layouts: [{id: 'acme.admin.layout', path: '/admin', parent: 'root', impl: 'admin'}],
        navigation: [
          {
            id: 'admin.users',
            scope: 'layout' as const,
            layout: 'acme.admin.layout',
            label: 'Users',
            to: '/admin',
            minimumRole: '   ',
          },
        ],
      },
    ];
    expect(() => validateNavigation(invalidRole, ['/admin'])).toThrow(
      'Navigation entry "admin.users" in feature "acme.users" has invalid minimum role metadata.',
    );
  });

  test('rejects role metadata on untyped non-layout navigation', () => {
    const feature = {
      id: 'acme.users',
      navigation: [
        {
          id: 'users',
          scope: 'workspace',
          label: 'Users',
          to: '/users',
          minimumRole: 'observer',
        },
      ],
    } as unknown as ClientFeature;

    expect(() => validateNavigation([feature], ['/users'])).toThrow(
      'Navigation entry "users" in feature "acme.users" has minimum role metadata but is not layout-scoped.',
    );
  });

  test('rejects layout navigation outside the declared layout subtree', () => {
    const features = [
      {
        id: 'acme.admin',
        layouts: [
          {id: 'acme.admin.layout', path: '/admin', parent: 'root' as const, impl: 'admin'},
        ],
      },
      {
        id: 'acme.users',
        routes: [{path: '/users', parent: 'root' as const, impl: 'users'}],
        navigation: [
          {
            id: 'admin.users',
            scope: 'layout' as const,
            layout: 'acme.admin.layout',
            label: 'Users',
            to: '/users',
          },
        ],
      },
    ];

    expect(() =>
      validateNavigation(features, composeRoutes(features), composeLayouts(features)),
    ).toThrow(
      'Navigation entry "admin.users" in feature "acme.users" targets route "/users" outside layout "acme.admin.layout".',
    );
  });

  test('names the id and both features for a duplicate navigation entry', () => {
    expect(() =>
      validateNavigation(
        [
          {
            id: 'shipfox.one',
            navigation: [{id: 'projects', scope: 'workspace', label: 'Projects', to: '/projects'}],
          },
          {
            id: 'acme.two',
            navigation: [{id: 'projects', scope: 'workspace', label: 'Projects', to: '/projects'}],
          },
        ],
        ['/projects'],
      ),
    ).toThrow(duplicateNavigationMessage);
  });

  test('names the id, target, and feature for a missing navigation route', () => {
    expect(() =>
      validateNavigation(
        [
          {
            id: 'acme.two',
            navigation: [{id: 'insights', scope: 'workspace', label: 'Insights', to: '/insights'}],
          },
        ],
        [],
      ),
    ).toThrow(missingNavigationMessage);
  });

  test('normalizes navigation targets before checking route existence', () => {
    expect(() =>
      validateNavigation(
        [
          {
            id: 'acme.two',
            navigation: [{id: 'insights', scope: 'workspace', label: 'Insights', to: '/insights/'}],
          },
        ],
        ['/insights'],
      ),
    ).not.toThrow();
  });

  test('rejects navigation that targets another feature without an explicit coordinator', () => {
    const features = [
      {
        id: 'shipfox.projects',
        routes: [{path: '/projects', parent: 'root' as const, impl: 'projects'}],
      },
      {
        id: 'acme.shell',
        navigation: [
          {id: 'projects', scope: 'workspace' as const, label: 'Projects', to: '/projects'},
        ],
      },
    ];

    expect(() => validateNavigation(features, composeRoutes(features))).toThrow(
      'Navigation entry "projects" in feature "acme.shell" targets route "/projects" owned by feature "shipfox.projects". Declare coordinator: "acme.shell" to own this cross-feature contribution.',
    );
  });

  test('accepts cross-feature navigation for an explicit coordinator', () => {
    const features = [
      {
        id: 'shipfox.projects',
        routes: [{path: '/projects', parent: 'root' as const, impl: 'projects'}],
      },
      {
        id: 'acme.shell',
        coordinator: 'acme.shell',
        navigation: [
          {id: 'projects', scope: 'workspace' as const, label: 'Projects', to: '/projects'},
        ],
      },
    ];

    expect(() => validateNavigation(features, composeRoutes(features))).not.toThrow();
  });

  test('names the id and both features for a duplicate settings section', () => {
    expect(() =>
      validateSettingsSections(
        [
          {
            id: 'shipfox.one',
            settingsSections: [
              {id: 'members', pathSegment: 'members', label: 'Members', icon: 'userLine'},
            ],
          },
          {
            id: 'acme.two',
            settingsSections: [
              {id: 'members', pathSegment: 'members', label: 'Members', icon: 'userLine'},
            ],
          },
        ],
        ['/w/$workspaceSlug/settings/members'],
      ),
    ).toThrow(duplicateSettingsMessage);
  });

  test('names the id, expected path, and feature for a missing settings route', () => {
    expect(() =>
      validateSettingsSections(
        [
          {
            id: 'acme.two',
            settingsSections: [
              {id: 'sso', pathSegment: 'sso', label: 'Single sign-on', icon: 'userLine'},
            ],
          },
        ],
        [],
      ),
    ).toThrow(missingSettingsMessage);
  });

  test('rejects a settings section whose route belongs to another feature', () => {
    const features = [
      {
        id: 'shipfox.projects',
        routes: [
          {
            path: '/w/$workspaceSlug/settings/members',
            parent: 'workspaceSettings' as const,
            impl: 'projects-members',
          },
        ],
      },
      {
        id: 'acme.shell',
        settingsSections: [
          {id: 'members', pathSegment: 'members', label: 'Members', icon: 'userLine' as const},
        ],
      },
    ];

    expect(() => validateSettingsSections(features, composeRoutes(features))).toThrow(
      'Settings section "members" in feature "acme.shell" targets route "/w/$workspaceSlug/settings/members" owned by feature "shipfox.projects". Declare coordinator: "acme.shell" to own this cross-feature contribution.',
    );
  });
});
