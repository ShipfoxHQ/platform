import {configureApiClient} from '@shipfox/client-api';
import {
  dismissWorkspaceSetupChecklist,
  isWorkspaceSetupChecklistDismissed,
} from '@shipfox/client-shell/runtime';
import {fireEvent, screen, waitFor} from '@testing-library/react';
import {
  jsonResponse,
  renderWorkspaceSettingsPage,
  WORKSPACE_SETTINGS_TEST_WID,
} from '#test/pages.js';
import {GeneralSettingsPage} from './general-settings-page.js';

describe('GeneralSettingsPage', () => {
  test('saves a name change without opening the slug warning', async () => {
    let patchBody: unknown;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.method === 'PATCH') {
        patchBody = await request.clone().json();
        return jsonResponse(workspaceDto({name: 'Acme Labs'}));
      }
      return jsonResponse({available: true});
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderWorkspaceSettingsPage('/w/acme/settings/general', <GeneralSettingsPage />);
    fireEvent.change(await screen.findByLabelText('Workspace name'), {
      target: {value: 'Acme Labs'},
    });
    fireEvent.click(screen.getByRole('button', {name: 'Save changes'}));

    await waitFor(() => expect(patchBody).toEqual({name: 'Acme Labs'}));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('requires confirmation before saving a slug change', async () => {
    let patchBody: unknown;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
        const request = input as Request;
        if (request.url.includes('/slug-availability')) {
          return jsonResponse({available: true});
        }
        if (request.method === 'PATCH') {
          patchBody = await request.clone().json();
          return jsonResponse(workspaceDto({slug: 'acme-labs'}));
        }
        return jsonResponse({});
      });
      configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

      renderWorkspaceSettingsPage('/w/acme/settings/general', <GeneralSettingsPage />);
      fireEvent.change(await screen.findByLabelText('Workspace slug'), {
        target: {value: 'acme-labs'},
      });
      await waitFor(() =>
        expect(
          fetchImpl.mock.calls.some(([input]) =>
            (input as Request).url.includes('/workspaces/slug-availability'),
          ),
        ).toBe(true),
      );
      fireEvent.click(screen.getByRole('button', {name: 'Save changes'}));

      const dialog = await screen.findByRole('dialog');
      expect(dialog).toHaveTextContent('old URL stop working');
      expect(
        fetchImpl.mock.calls.some(([input]) =>
          (input as Request).url.includes('/workspaces/slug-availability'),
        ),
      ).toBe(true);
      expect(patchBody).toBeUndefined();

      fireEvent.click(screen.getByRole('button', {name: 'Change slug'}));
      await waitFor(() => expect(patchBody).toEqual({slug: 'acme-labs'}));
      expect(
        consoleError.mock.calls.some((args) =>
          args.some((argument) => String(argument).includes('useActiveWorkspace called outside')),
        ),
      ).toBe(false);
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe('setup guide re-entry link', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test('is absent while the setup guide is not dismissed', async () => {
    configureApiClient({baseUrl: 'https://api.example.test'});

    renderWorkspaceSettingsPage('/w/acme/settings/general', <GeneralSettingsPage />);

    expect(await screen.findByLabelText('Workspace name')).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Show the setup guide'})).not.toBeInTheDocument();
  });

  test('is present while the setup guide is dismissed', async () => {
    dismissWorkspaceSetupChecklist(WORKSPACE_SETTINGS_TEST_WID);
    configureApiClient({baseUrl: 'https://api.example.test'});

    renderWorkspaceSettingsPage('/w/acme/settings/general', <GeneralSettingsPage />);

    expect(await screen.findByRole('button', {name: 'Show the setup guide'})).toBeInTheDocument();
  });

  test('clears the dismissal flag on click', async () => {
    dismissWorkspaceSetupChecklist(WORKSPACE_SETTINGS_TEST_WID);
    configureApiClient({baseUrl: 'https://api.example.test'});

    renderWorkspaceSettingsPage('/w/acme/settings/general', <GeneralSettingsPage />);
    fireEvent.click(await screen.findByRole('button', {name: 'Show the setup guide'}));

    expect(isWorkspaceSetupChecklistDismissed(WORKSPACE_SETTINGS_TEST_WID)).toBe(false);
    expect(screen.queryByRole('button', {name: 'Show the setup guide'})).not.toBeInTheDocument();
  });
});

function workspaceDto({name = 'Acme', slug = 'acme'}: {name?: string; slug?: string} = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name,
    slug,
    status: 'active',
    settings: {},
    created_at: '2026-04-27T00:00:00.000Z',
    updated_at: '2026-04-27T00:00:00.000Z',
  };
}
