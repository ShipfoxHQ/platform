// @vitest-environment jsdom
import {screen} from '@testing-library/react';
import {defineClientFeature} from '#contract.js';
import type {ChromeSlots} from '#runtime/chrome-context.js';
import {defineRoute} from '#runtime/define-route.js';
import {renderComposedShell} from '#test/render.js';

function workspaceSetupFeature() {
  return defineClientFeature({
    id: 'acme.workspace-setup',
    routes: [
      {path: '/w/$workspaceSlug/workspace', parent: 'workspaceLayout', impl: 'workspace'},
      {path: '/w/$workspaceSlug/integrations', parent: 'workspaceLayout', impl: 'integrations'},
      {path: '/w/$workspaceSlug/model-provider', parent: 'workspaceLayout', impl: 'model-provider'},
      {path: '/w/$workspaceSlug/projects/new', parent: 'workspaceLayout', impl: 'projects-new'},
    ],
  });
}

function StubWorkspaceSetupIndicator() {
  return <button type="button">Get started</button>;
}

function chromeWithIndicator(): Partial<ChromeSlots> {
  return {WorkspaceSetupIndicator: StubWorkspaceSetupIndicator};
}

async function renderWorkspacePage(options: {
  path: string;
  chrome?: Partial<ChromeSlots>;
  hideProjectNavigation?: boolean;
}) {
  await renderComposedShell({
    features: [workspaceSetupFeature()],
    initialPath: options.path,
    resolveImpl: () =>
      defineRoute({staticData: {frame: 'content'}, component: () => <h1>Page</h1>}),
    ...(options.chrome ? {chrome: options.chrome} : {}),
    workspaceSetup: async () => ({hideProjectNavigation: options.hideProjectNavigation ?? false}),
  });
}

describe('NavBar workspace-setup indicator', () => {
  test('renders no indicator when the slot is absent', async () => {
    await renderWorkspacePage({path: '/w/workspace/workspace'});

    expect(await screen.findByRole('heading', {name: 'Page'})).toBeVisible();
    expect(screen.getByRole('link', {name: 'Shipfox home'})).toBeVisible();
    expect(screen.queryByRole('button', {name: 'Get started'})).not.toBeInTheDocument();
  });

  test('renders the indicator right of the breadcrumbs on in-shell pages', async () => {
    await renderWorkspacePage({
      path: '/w/workspace/workspace',
      chrome: chromeWithIndicator(),
    });

    expect(await screen.findByRole('button', {name: 'Get started'})).toBeVisible();
  });

  test.each([
    '/w/workspace/integrations',
    '/w/workspace/model-provider',
    '/w/workspace/projects/new',
  ])('hides the indicator on the gate page %s', async (path) => {
    await renderWorkspacePage({
      path,
      chrome: chromeWithIndicator(),
      hideProjectNavigation: true,
    });

    expect(await screen.findByRole('heading', {name: 'Page'})).toBeVisible();
    expect(screen.queryByRole('button', {name: 'Get started'})).not.toBeInTheDocument();
  });
});
