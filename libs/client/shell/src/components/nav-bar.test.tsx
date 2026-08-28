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

function StubProjectBreadcrumb() {
  return <span>Project breadcrumb</span>;
}

function chromeWithIndicator(): Partial<ChromeSlots> {
  return {
    ProjectBreadcrumb: StubProjectBreadcrumb,
    WorkspaceSetupIndicator: StubWorkspaceSetupIndicator,
  };
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

describe('NavBar', () => {
  test('links to the documentation before the user menu', async () => {
    await renderWorkspacePage({path: '/w/workspace/workspace'});

    const docsLink = await screen.findByRole('link', {name: 'Docs (opens in new tab)'});
    const userMenu = screen.getByRole('button', {name: 'User menu'});

    expect(docsLink).toHaveAttribute('href', 'https://shipfox.io/docs');
    expect(docsLink).toHaveAttribute('target', '_blank');
    expect(docsLink).toHaveAttribute('rel', 'noreferrer noopener');
    expect(docsLink.compareDocumentPosition(userMenu) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

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

    const indicator = await screen.findByRole('button', {name: 'Get started'});
    const breadcrumb = screen.getByText('Project breadcrumb');
    const header = indicator.closest('header');

    expect(indicator).toBeVisible();
    expect(breadcrumb).toBeVisible();
    expect(header).not.toBeNull();
    expect(header?.contains(breadcrumb)).toBe(true);
    expect(header?.contains(indicator)).toBe(true);
    expect(breadcrumb.compareDocumentPosition(indicator) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
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
    const docsLink = screen.getByRole('link', {name: 'Docs (opens in new tab)'});
    const userMenu = screen.getByRole('button', {name: 'User menu'});

    expect(docsLink).toBeVisible();
    expect(docsLink.compareDocumentPosition(userMenu) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.queryByRole('button', {name: 'Get started'})).not.toBeInTheDocument();
  });
});
