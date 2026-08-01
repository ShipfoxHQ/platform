import {composeClientFeatures} from './compose-client-features.js';

describe('composeClientFeatures', () => {
  test('validates and returns one aggregate composition for the shell', () => {
    const composition = composeClientFeatures([
      {
        id: 'acme.projects',
        routes: [
          {path: '/projects', parent: 'root', impl: 'projects'},
          {
            path: '/w/$workspaceSlug/settings/members',
            parent: 'workspaceSettings',
            impl: 'members',
          },
        ],
        navigation: [{id: 'projects', scope: 'workspace', label: 'Projects', to: '/projects'}],
        settingsSections: [
          {id: 'members', pathSegment: 'members', label: 'Members', icon: 'userLine'},
        ],
      },
    ]);

    expect(composition.routes.map(({path}) => path)).toEqual([
      '/projects',
      '/w/$workspaceSlug/settings/members',
    ]);
    expect(composition.navigation.map(({id}) => id)).toEqual(['projects']);
    expect(composition.settingsSections.map(({id}) => id)).toEqual(['members']);
  });

  test('fails deterministically for an owner-mismatched contribution', () => {
    expect(() =>
      composeClientFeatures([
        {
          id: 'shipfox.projects',
          routes: [{path: '/projects', parent: 'root', impl: 'projects'}],
        },
        {
          id: 'acme.shell',
          navigation: [{id: 'projects', scope: 'workspace', label: 'Projects', to: '/projects'}],
        },
      ]),
    ).toThrow(
      'Navigation entry "projects" in feature "acme.shell" targets route "/projects" owned by feature "shipfox.projects". Declare coordinator: "acme.shell" to own this cross-feature contribution.',
    );
  });
});
