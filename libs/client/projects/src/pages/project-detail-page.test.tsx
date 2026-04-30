import {configureApiClient} from '@shipfox/client-api';
import {screen} from '@testing-library/react';
import {jsonResponse, renderProjectPage} from '#test/pages.js';
import {ProjectDetailPage} from './project-detail-page.js';

describe('ProjectDetailPage', () => {
  test('renders project metadata', async () => {
    configureApiClient({fetchImpl: vi.fn().mockResolvedValue(jsonResponse(projectDto()))});

    renderProjectPage(
      '/projects/44444444-4444-4444-8444-444444444444',
      <ProjectDetailPage projectId="44444444-4444-4444-8444-444444444444" />,
    );

    expect(await screen.findByRole('heading', {name: 'Platform'})).toBeInTheDocument();
    expect(screen.getAllByText('platform')[0]).toBeInTheDocument();
    expect(screen.getByText('Workflow discovery')).toBeInTheDocument();
  });

  test('renders not found state', async () => {
    configureApiClient({
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse({code: 'not-found'}, {status: 404})),
    });

    renderProjectPage('/projects/missing', <ProjectDetailPage projectId="missing" />);

    expect(await screen.findByText('This project was not found.')).toBeInTheDocument();
  });
});

function projectDto() {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    workspace_id: '11111111-1111-4111-8111-111111111111',
    name: 'Platform',
    source: {
      connection_id: '33333333-3333-4333-8333-333333333333',
      external_repository_id: 'platform',
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}
