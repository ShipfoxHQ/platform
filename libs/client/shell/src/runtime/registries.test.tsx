import {screen, within} from '@testing-library/react';
import {defineClientFeature} from '#contract.js';
import {renderComposedShell} from '#test/render.js';
import {defineRoute} from './define-route.js';

describe('composition registries', () => {
  test('sorts navigation and settings entries by order, feature position, then declaration order', async () => {
    const features = [
      defineClientFeature({
        id: 'shipfox.first',
        navigation: [
          {
            id: 'first-a',
            scope: 'workspace',
            label: 'First A',
            to: '/w/$workspaceSlug/first-a/',
            order: 100,
          },
          {
            id: 'first-b',
            scope: 'workspace',
            label: 'First B',
            to: '/w/$workspaceSlug/first-b',
            order: 100,
          },
        ],
        settingsSections: [
          {id: 'first', pathSegment: 'first', label: 'First setting', icon: 'userLine', order: 100},
        ],
        routes: [
          {path: '/w/$workspaceSlug/first-a', parent: 'workspaceLayout', impl: 'first-a'},
          {path: '/w/$workspaceSlug/first-b', parent: 'workspaceLayout', impl: 'first-b'},
          {
            path: '/w/$workspaceSlug/settings/first',
            parent: 'workspaceSettings',
            impl: 'first-setting',
          },
        ],
      }),
      defineClientFeature({
        id: 'acme.second',
        navigation: [
          {
            id: 'second',
            scope: 'workspace',
            label: 'Second',
            to: '/w/$workspaceSlug/second',
            order: 100,
          },
        ],
        settingsSections: [
          {
            id: 'second',
            pathSegment: 'second',
            label: 'Second setting',
            icon: 'userLine',
            order: 200,
          },
        ],
        routes: [
          {path: '/w/$workspaceSlug/second', parent: 'workspaceLayout', impl: 'second'},
          {
            path: '/w/$workspaceSlug/settings/second',
            parent: 'workspaceSettings',
            impl: 'second-setting',
          },
        ],
      }),
    ];

    await renderComposedShell({
      features,
      initialPath: '/w/workspace/settings/first',
      resolveImpl: () =>
        defineRoute({staticData: {frame: 'content'}, component: () => <h1>Settings page</h1>}),
    });

    expect(await screen.findByRole('heading', {name: 'Settings page'})).toBeVisible();
    expect(screen.queryByRole('heading', {name: 'Workspace settings'})).not.toBeInTheDocument();
    expect((await screen.findAllByRole('tab')).map((tab) => tab.textContent)).toEqual([
      'First A',
      'First B',
      'Second',
    ]);
    expect((await screen.findAllByRole('tab'))[0]).toHaveAttribute('href', '/w/workspace/first-a');
    const settingsNavigation = screen.getByRole('navigation', {name: 'Workspace settings'});
    expect(settingsNavigation.parentElement).toHaveClass('grid', 'grid-cols-[180px_minmax(0,1fr)]');
    const settingsLinks = within(settingsNavigation).getAllByRole('link');
    const [firstSettingsLink, secondSettingsLink] = settingsLinks;
    if (!firstSettingsLink || !secondSettingsLink) {
      throw new Error('Expected at least two settings links.');
    }

    expect(settingsLinks.map((link) => link.textContent)).toEqual([
      'First setting',
      'Second setting',
    ]);
    expect(firstSettingsLink).toHaveClass('w-full', 'justify-start');
    expect(firstSettingsLink).toHaveAttribute('aria-current', 'page');
    expect(firstSettingsLink).toHaveClass('bg-background-neutral-hover');
    expect(firstSettingsLink.querySelector('[aria-hidden="true"]')).toHaveClass(
      'bg-border-highlights-interactive',
    );
    expect(firstSettingsLink.querySelector('svg')).toHaveClass('size-16');
    expect(secondSettingsLink).not.toHaveAttribute('aria-current');
    expect(secondSettingsLink).not.toHaveClass('bg-background-neutral-hover');
    expect(secondSettingsLink.querySelector('[data-settings-active-bar]')).not.toBeInTheDocument();
  });

  test('keeps the project settings heading and project-scoped navigation', async () => {
    const feature = defineClientFeature({
      id: 'acme.project-settings',
      settingsSections: [
        {
          id: 'project.general',
          pathSegment: 'general',
          label: 'General',
          icon: 'settings3Line',
          scope: 'project',
        },
      ],
      routes: [
        {
          path: '/w/$workspaceSlug/p/$projectSlug/settings/general',
          parent: 'projectSettings',
          impl: 'project-general',
        },
      ],
    });

    await renderComposedShell({
      features: [feature],
      initialPath: '/w/workspace/p/project/settings/general',
      resolveImpl: () =>
        defineRoute({staticData: {frame: 'content'}, component: () => <h1>General</h1>}),
    });

    expect(await screen.findByRole('heading', {name: 'Project settings'})).toBeVisible();
    expect(screen.getByText('Configure this project.')).toBeVisible();
    const projectNavigation = screen.getByRole('navigation', {name: 'Project settings'});
    const projectLink = within(projectNavigation).getByRole('link', {name: 'General'});
    expect(projectLink).toHaveAttribute('href', '/w/workspace/p/project/settings/general');
    expect(projectLink).toHaveAttribute('aria-current', 'page');
  });
});
