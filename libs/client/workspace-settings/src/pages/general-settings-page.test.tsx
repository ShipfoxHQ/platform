import {configureApiClient} from '@shipfox/client-api';
import {fireEvent, screen, waitFor} from '@testing-library/react';
import {jsonResponse, renderWorkspaceSettingsPage} from '#test/pages.js';
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
    consoleError.mockRestore();
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
