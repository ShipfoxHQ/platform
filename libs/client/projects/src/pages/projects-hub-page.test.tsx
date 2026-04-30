import {configureApiClient} from '@shipfox/client-api';
import {fireEvent, screen} from '@testing-library/react';
import {jsonResponse, renderProjectPage} from '#test/pages.js';
import {ProjectsHubPage} from './projects-hub-page.js';

describe('ProjectsHubPage', () => {
  test('renders empty state with create CTA', async () => {
    configureApiClient({
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse({projects: [], next_cursor: null})),
    });

    renderProjectPage('/', <ProjectsHubPage />);

    expect(await screen.findByRole('heading', {name: 'Projects'})).toBeInTheDocument();
    expect(await screen.findByText('Create your first project')).toBeInTheDocument();
    expect(screen.getAllByRole('link', {name: 'Create project'})[0]).toHaveAttribute(
      'href',
      '/projects/new',
    );
  });

  test('renders projects and loads the next cursor page', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          projects: [projectDto({id: 'project-1', name: 'Platform'})],
          next_cursor: 'cursor-1',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          projects: [projectDto({id: 'project-2', name: 'API'})],
          next_cursor: null,
        }),
      );
    configureApiClient({fetchImpl});

    renderProjectPage('/', <ProjectsHubPage />);
    expect(await screen.findByText('Platform')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'Load more'}));

    expect(await screen.findByText('API')).toBeInTheDocument();
    const secondRequest = fetchImpl.mock.calls[1]?.[0] as Request;
    expect(secondRequest.url).toContain('cursor=cursor-1');
  });

  test('renders an error alert with retry', async () => {
    configureApiClient({
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse({code: 'server-error'}, {status: 500})),
    });

    renderProjectPage('/', <ProjectsHubPage />);

    expect(await screen.findByText('Project request failed')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Retry'})).toBeInTheDocument();
  });
});

function projectDto({id, name}: {id: string; name: string}) {
  return {
    id,
    workspace_id: '11111111-1111-4111-8111-111111111111',
    name,
    source: {
      connection_id: '33333333-3333-4333-8333-333333333333',
      external_repository_id: name.toLowerCase(),
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}
