import {configureApiClient} from '@shipfox/client-api';
import {fireEvent, screen, waitFor} from '@testing-library/react';
import {jsonResponse, renderProjectPage} from '#test/pages.js';
import {ProjectSettingsPage} from './project-settings-page.js';

describe('ProjectSettingsPage', () => {
  test('saves a name change without opening the slug warning', async () => {
    let patchBody: unknown;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.method === 'PATCH') {
        patchBody = await request.clone().json();
        return jsonResponse(projectDto({name: 'Platform API'}));
      }
      return jsonResponse({projects: [projectDto()], next_cursor: null});
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderProjectPage('/w/acme/p/platform/settings/general', <ProjectSettingsPage />);
    const nameInput = await screen.findByLabelText('Project name');
    expect(screen.getByRole('heading', {name: 'General'})).toBeInTheDocument();
    const settingsForm = nameInput.closest('form');
    expect(settingsForm).not.toBeNull();
    expect(settingsForm).toHaveClass('max-w-[560px]');
    expect(
      screen.queryByText('Update the project name and the slug used in its URLs.'),
    ).not.toBeInTheDocument();
    expect(document.querySelectorAll('[data-slot="panel"]')).toHaveLength(1);
    fireEvent.change(nameInput, {
      target: {value: 'Platform API'},
    });
    fireEvent.click(screen.getByRole('button', {name: 'Save changes'}));

    await waitFor(() => expect(patchBody).toEqual({name: 'Platform API'}));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('requires confirmation before saving a slug change', async () => {
    let patchBody: unknown;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.method === 'PATCH') {
        patchBody = await request.clone().json();
        return jsonResponse(projectDto({slug: 'platform-api'}));
      }
      return jsonResponse({projects: [projectDto()], next_cursor: null});
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderProjectPage('/w/acme/p/platform/settings/general', <ProjectSettingsPage />);
    fireEvent.change(await screen.findByLabelText('Project slug'), {
      target: {value: 'platform-api'},
    });
    fireEvent.click(screen.getByRole('button', {name: 'Save changes'}));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('old URL stop working');
    expect(
      fetchImpl.mock.calls.some(([input]) =>
        (input as Request).url.includes('/projects/slug-availability'),
      ),
    ).toBe(false);
    expect(patchBody).toBeUndefined();

    fireEvent.click(screen.getByRole('button', {name: 'Change slug'}));
    await waitFor(() => expect(patchBody).toEqual({slug: 'platform-api'}));
  });
});

function projectDto({name = 'Platform', slug = 'platform'}: {name?: string; slug?: string} = {}) {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    workspace_id: '11111111-1111-4111-8111-111111111111',
    name,
    slug,
    source: {
      connection_id: '33333333-3333-4333-8333-333333333333',
      external_repository_id: 'platform',
    },
    created_at: '2026-05-07T01:00:00.000Z',
    updated_at: '2026-05-07T01:00:00.000Z',
  };
}
