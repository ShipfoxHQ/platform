import type {ClientFeature} from '#contract.js';
import {composeLayouts, composeRoutes} from './compose-routes.js';

const base: ClientFeature = {
  id: 'shipfox.base',
  routes: [{path: '/projects', parent: 'root', impl: 'base'}],
};
const collisionMessage = /\/projects.*shipfox\.base.*acme\.insights/u;
const danglingOverrideMessage = /\/missing.*acme\.insights/u;
const competingOverridesMessage = /\/projects.*acme\.one.*acme\.two/u;

describe('composeRoutes', () => {
  test('declares a layout that another feature can use as a route parent', () => {
    const features: ClientFeature[] = [
      {
        id: 'acme.shell',
        layouts: [{id: 'acme.admin', path: '/admin', parent: 'root', impl: 'layout'}],
      },
      {
        id: 'acme.users',
        routes: [{path: '/admin/users', parent: 'acme.admin', impl: 'users'}],
      },
    ];

    expect(composeLayouts(features)).toEqual([
      {
        id: 'acme.admin',
        path: '/admin',
        parent: 'root',
        impl: 'layout',
        featureId: 'acme.shell',
      },
    ]);
    expect(composeRoutes(features)).toEqual([
      {
        path: '/admin/users',
        parent: 'acme.admin',
        impl: 'users',
        featureId: 'acme.users',
        ownerFeatureId: 'acme.users',
      },
    ]);
  });

  test('names duplicate layout ids and missing layout parents', () => {
    expect(() =>
      composeLayouts([
        {id: 'acme.one', layouts: [{id: 'acme.admin', path: '/one', parent: 'root', impl: 'one'}]},
        {id: 'acme.two', layouts: [{id: 'acme.admin', path: '/two', parent: 'root', impl: 'two'}]},
      ]),
    ).toThrow('Layout id "acme.admin" is contributed by both features "acme.one" and "acme.two".');
    expect(() =>
      composeLayouts([
        {
          id: 'acme.admin',
          layouts: [{id: 'acme.admin', path: '/admin', parent: 'acme.missing', impl: 'admin'}],
        },
      ]),
    ).toThrow(
      'Layout "acme.admin" in feature "acme.admin" targets missing layout parent "acme.missing".',
    );
  });

  test('rejects a layout path reserved by a shell anchor', () => {
    expect(() =>
      composeLayouts([
        {
          id: 'acme.shell',
          layouts: [
            {id: 'acme.fake-workspace', path: '/w/$workspaceSlug', parent: 'root', impl: 'fake'},
          ],
        },
      ]),
    ).toThrow(
      'Layout "acme.fake-workspace" in feature "acme.shell" targets path "/w/$workspaceSlug" which is reserved by a shell anchor.',
    );
  });

  test('rejects root-parented routes and layouts inside protected anchors', () => {
    expect(() =>
      composeRoutes([
        {
          id: 'acme.reports',
          routes: [{path: '/w/$workspaceSlug/reports', parent: 'root', impl: 'reports'}],
        },
      ]),
    ).toThrow(
      'Route "/w/$workspaceSlug/reports" in feature "acme.reports" cannot use root parent inside reserved anchor "workspaceLayout" (/w/$workspaceSlug). Use parent "workspaceLayout".',
    );
    expect(() =>
      composeLayouts([
        {
          id: 'acme.reports',
          layouts: [
            {
              id: 'acme.reports.layout',
              path: '/w/$workspaceSlug/reports',
              parent: 'root',
              impl: 'reports',
            },
          ],
        },
      ]),
    ).toThrow(
      'Route "/w/$workspaceSlug/reports" in feature "acme.reports" cannot use root parent inside reserved anchor "workspaceLayout" (/w/$workspaceSlug). Use parent "workspaceLayout".',
    );
  });

  test('rejects a protected path smuggled through an intermediate root-parented layout', () => {
    expect(() =>
      composeLayouts([
        {
          id: 'acme.decoy',
          layouts: [{id: 'acme.decoy-layout', path: '/legacy', parent: 'root', impl: 'decoy'}],
        },
        {
          id: 'acme.smuggled',
          layouts: [
            {
              id: 'acme.smuggled-layout',
              path: '/w/$workspaceSlug/reports',
              parent: 'acme.decoy-layout',
              impl: 'reports',
            },
          ],
        },
      ]),
    ).toThrow(
      'Route "/w/$workspaceSlug/reports" in feature "acme.smuggled" cannot use root parent inside reserved anchor "workspaceLayout" (/w/$workspaceSlug). Use parent "workspaceLayout".',
    );
  });

  test('rejects a child route outside its declared layout path', () => {
    expect(() =>
      composeRoutes([
        {
          id: 'acme.admin',
          layouts: [{id: 'acme.admin', path: '/admin', parent: 'root', impl: 'admin'}],
        },
        {
          id: 'acme.users',
          routes: [{path: '/users', parent: 'acme.admin', impl: 'users'}],
        },
      ]),
    ).toThrow('Route "/users" must be nested under layout "acme.admin" (/admin).');
  });

  test('reports a route and layout path conflict as non-overridable', () => {
    expect(() =>
      composeRoutes([
        {
          id: 'acme.admin',
          layouts: [{id: 'acme.admin.layout', path: '/admin', parent: 'root', impl: 'admin'}],
        },
        {
          id: 'acme.route',
          routes: [{path: '/admin', parent: 'root', impl: 'route'}],
        },
      ]),
    ).toThrow(
      'Route "/admin" from feature "acme.route" conflicts with layout "acme.admin.layout" contributed by feature "acme.admin". Routes cannot replace layouts.',
    );
  });

  test('appends a unique route and explicitly replaces an existing route', () => {
    const routes = composeRoutes([
      base,
      {
        id: 'acme.insights',
        routes: [{path: '/projects', parent: 'root', override: true, impl: 'override'}],
      },
      {id: 'acme.audit', routes: [{path: '/audit', parent: 'root', impl: 'audit'}]},
    ]);

    expect(routes).toEqual([
      {
        path: '/projects',
        parent: 'root',
        override: true,
        impl: 'override',
        featureId: 'acme.insights',
        ownerFeatureId: 'shipfox.base',
      },
      {
        path: '/audit',
        parent: 'root',
        impl: 'audit',
        featureId: 'acme.audit',
        ownerFeatureId: 'acme.audit',
      },
    ]);
  });

  test('names the path and both features for a collision', () => {
    expect(() =>
      composeRoutes([
        base,
        {id: 'acme.insights', routes: [{path: '/projects', parent: 'root', impl: 'next'}]},
      ]),
    ).toThrow(collisionMessage);
  });

  test('normalizes trailing slashes before collision checks', () => {
    expect(() =>
      composeRoutes([
        base,
        {
          id: 'acme.insights',
          routes: [{path: '/projects/', parent: 'root', impl: 'next'}],
        },
      ]),
    ).toThrow(collisionMessage);
  });

  test('names the path and feature for a dangling override', () => {
    expect(() =>
      composeRoutes([
        {
          id: 'acme.insights',
          routes: [{path: '/missing', parent: 'root', override: true, impl: 'next'}],
        },
      ]),
    ).toThrow(danglingOverrideMessage);
  });

  test('names the path and both features for competing overrides', () => {
    expect(() =>
      composeRoutes([
        base,
        {
          id: 'acme.one',
          routes: [{path: '/projects', parent: 'root', override: true, impl: 'one'}],
        },
        {
          id: 'acme.two',
          routes: [{path: '/projects', parent: 'root', override: true, impl: 'two'}],
        },
      ]),
    ).toThrow(competingOverridesMessage);
  });

  test('rejects an override that changes the route anchor', () => {
    expect(() =>
      composeRoutes([
        {
          id: 'shipfox.projects',
          routes: [
            {
              path: '/w/$workspaceSlug/projects',
              parent: 'workspaceLayout',
              impl: 'base',
            },
          ],
        },
        {
          id: 'acme.projects',
          routes: [
            {
              path: '/w/$workspaceSlug/projects',
              parent: 'root',
              override: true,
              impl: 'override',
            },
          ],
        },
      ]),
    ).toThrow(
      'Route override for "/w/$workspaceSlug/projects" from feature "acme.projects" cannot change anchor from "workspaceLayout" in feature "shipfox.projects" to "root".',
    );
  });
});
