// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {configureApiClient} from '@shipfox/client-api';
import {screen} from '@testing-library/react';
import {jsonResponse, renderIntegrationsPage} from '#test/render.js';
import {SourceControlOnboardingPage} from './source-control-onboarding-page.js';

describe('SourceControlOnboardingPage', () => {
  test('renders only source-control provider cards', async () => {
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes('/integration-providers')) {
        return Promise.resolve(
          jsonResponse({
            providers: [
              {provider: 'github', display_name: 'GitHub', capabilities: ['source_control']},
              {provider: 'sentry', display_name: 'Sentry', capabilities: []},
            ],
          }),
        );
      }
      return Promise.resolve(jsonResponse({}, {status: 404}));
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderIntegrationsPage({
      path: '/w/acme/integrations',
      routePath: '/w/$workspaceSlug/integrations',
      element: <SourceControlOnboardingPage />,
      extraRoutes: ['/w/$workspaceSlug/integrations/github'],
    });

    expect(await screen.findByRole('heading', {name: 'Install source control'})).toBeVisible();
    expect(await screen.findByRole('link', {name: 'Install GitHub'})).toBeVisible();
    expect(screen.queryByRole('region', {name: 'Installed integrations'})).not.toBeInTheDocument();
    expect(screen.queryByRole('region', {name: 'Available integrations'})).not.toBeInTheDocument();
    expect(
      screen.queryByText('Provider accounts installed in this workspace.'),
    ).not.toBeInTheDocument();

    const urls = fetchImpl.mock.calls.map(([input]) =>
      input instanceof Request ? input.url : String(input),
    );
    expect(urls.some((url) => url.includes('/integration-connections?'))).toBe(false);
  });
});
