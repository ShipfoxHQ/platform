// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {ApiError} from '@shipfox/client-api';
import {FOCUSED_FRAME_CONTENT_CLASS_NAME} from '@shipfox/client-shell/runtime';
import {screen, waitFor} from '@testing-library/react';
import {StrictMode} from 'react';
import {INTEGRATIONS_TEST_WID, renderIntegrationsPage} from '#test/render.js';
import {RedirectInstallPage} from './redirect-install-page.js';

const FOCUSED_FRAME_CONTENT_CLASSES = FOCUSED_FRAME_CONTENT_CLASS_NAME.split(' ');

function renderInstallPage(
  props: Parameters<typeof RedirectInstallPage>[0],
  options?: {strict?: boolean},
) {
  return renderIntegrationsPage({
    path: '/w/acme/integrations/github',
    routePath: '/w/$workspaceSlug/integrations/github',
    element: options?.strict ? (
      <StrictMode>
        <RedirectInstallPage {...props} />
      </StrictMode>
    ) : (
      <RedirectInstallPage {...props} />
    ),
    extraRoutes: ['/w/$workspaceSlug/integrations'],
  });
}

describe('RedirectInstallPage', () => {
  test('requests the install URL and leaves the app', async () => {
    const installRequest = vi.fn().mockResolvedValue({installUrl: 'https://provider.test/install'});
    const assignLocation = vi.fn();
    const beforeRedirect = vi.fn();

    renderInstallPage({
      installRequest,
      errorFallbackMessage: 'Could not start install.',
      beforeRedirect,
      assignLocation,
    });

    await waitFor(() =>
      expect(assignLocation).toHaveBeenCalledWith('https://provider.test/install'),
    );
    expect(installRequest).toHaveBeenCalledWith({workspace_id: INTEGRATIONS_TEST_WID});
    expect(beforeRedirect).toHaveBeenCalledWith(INTEGRATIONS_TEST_WID);
    expect(beforeRedirect.mock.invocationCallOrder[0]).toBeLessThan(
      installRequest.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  test('shows the API error message with a back link on failure', async () => {
    const installRequest = vi
      .fn()
      .mockRejectedValue(
        new ApiError({message: 'Sentry app not configured', code: 'bad-config', status: 422}),
      );

    renderInstallPage({
      installRequest,
      errorFallbackMessage: 'Could not start install.',
      assignLocation: vi.fn(),
    });

    // Alert mounts via framer-motion (opacity 0 in jsdom), so assert presence.
    expect(await screen.findByText('Sentry app not configured')).toBeInTheDocument();
    expect(screen.getByRole('alert').parentElement).toHaveClass(...FOCUSED_FRAME_CONTENT_CLASSES);
    expect(screen.getByRole('link', {name: 'Back to integrations'})).toBeVisible();
  });

  test('requests the install URL exactly once in Strict Mode', async () => {
    const installRequest = vi.fn().mockResolvedValue({installUrl: 'https://provider.test/install'});

    renderInstallPage(
      {
        installRequest,
        errorFallbackMessage: 'Could not start install.',
        assignLocation: vi.fn(),
      },
      {strict: true},
    );

    await waitFor(() => expect(installRequest).toHaveBeenCalledTimes(1));
  });

  test('falls back to the provided message for unknown errors', async () => {
    const installRequest = vi.fn().mockRejectedValue(new Error('network down'));

    renderInstallPage({
      installRequest,
      errorFallbackMessage: 'Could not start install.',
      assignLocation: vi.fn(),
    });

    expect(await screen.findByText('Could not start install.')).toBeInTheDocument();
  });
});
