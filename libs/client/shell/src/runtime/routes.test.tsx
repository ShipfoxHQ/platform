import {Link, Outlet} from '@tanstack/react-router';
import {screen} from '@testing-library/react';
import {defineClientFeature} from '#contract.js';
import {renderComposedShell} from '#test/render.js';
import {defineRoute} from './define-route.js';
import {useLayoutNavigation} from './layout-navigation.js';

describe('composed routes', () => {
  test('renders a feature-added route through memory history', async () => {
    const feature = defineClientFeature({
      id: 'acme.insights',
      routes: [{path: '/insights', parent: 'root', impl: 'insights'}],
    });

    await renderComposedShell({
      features: [feature],
      initialPath: '/insights',
      resolveImpl: () => defineRoute({component: () => <h1>Insights</h1>}),
    });

    expect(await screen.findByRole('heading', {name: 'Insights'})).toBeVisible();
  });

  test('renders an explicit route override instead of the upstream route', async () => {
    const features = [
      defineClientFeature({
        id: 'shipfox.projects',
        routes: [{path: '/projects', parent: 'root', impl: 'upstream'}],
      }),
      defineClientFeature({
        id: 'acme.projects',
        routes: [{path: '/projects', parent: 'root', override: true, impl: 'override'}],
      }),
    ];

    await renderComposedShell({
      features,
      initialPath: '/projects',
      resolveImpl: (specifier) =>
        defineRoute({
          component: () => (
            <h1>{specifier === 'override' ? 'Commercial projects' : 'Upstream projects'}</h1>
          ),
        }),
    });

    expect(await screen.findByRole('heading', {name: 'Commercial projects'})).toBeVisible();
    expect(screen.queryByText('Upstream projects')).not.toBeInTheDocument();
  });

  test('renders deterministic navigation supplied by child features to a layout', async () => {
    const features = [
      defineClientFeature({
        id: 'acme.admin',
        layouts: [{id: 'acme.admin.layout', path: '/admin', parent: 'root', impl: 'layout'}],
      }),
      defineClientFeature({
        id: 'acme.users',
        routes: [{path: '/admin/users', parent: 'acme.admin.layout', impl: 'users'}],
        navigation: [
          {
            id: 'admin.users',
            scope: 'layout',
            layout: 'acme.admin.layout',
            label: 'Users',
            to: '/admin/users',
            order: 200,
          },
        ],
      }),
      defineClientFeature({
        id: 'acme.overview',
        routes: [{path: '/admin/overview', parent: 'acme.admin.layout', impl: 'overview'}],
        navigation: [
          {
            id: 'admin.overview',
            scope: 'layout',
            layout: 'acme.admin.layout',
            label: 'Overview',
            to: '/admin/overview',
            order: 100,
          },
        ],
      }),
    ];

    await renderComposedShell({
      features,
      initialPath: '/admin/users',
      resolveImpl: (specifier) => {
        if (specifier === 'layout') {
          return defineRoute({
            component: () => (
              <>
                <nav aria-label="Administration sections">
                  {useLayoutNavigation('acme.admin.layout').map((entry) => (
                    <Link key={entry.id} to={entry.to as never}>
                      {entry.label}
                    </Link>
                  ))}
                </nav>
                <Outlet />
              </>
            ),
          });
        }
        return defineRoute({component: () => <h1>{specifier}</h1>});
      },
    });

    expect((await screen.findAllByRole('link')).map((link) => link.textContent)).toEqual([
      'Overview',
      'Users',
    ]);
    expect(await screen.findByRole('heading', {name: 'users'})).toBeVisible();
  });
});
