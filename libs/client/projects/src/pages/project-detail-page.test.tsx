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
    expect(screen.getByText('test-owner/platform')).toBeInTheDocument();
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
    repository_id: '66666666-6666-4666-8666-666666666666',
    name: 'Platform',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    repository: {
      id: '66666666-6666-4666-8666-666666666666',
      vcs_connection_id: '33333333-3333-4333-8333-333333333333',
      provider: 'test',
      provider_host: 'test.local',
      external_repository_id: 'platform',
      owner: 'test-owner',
      name: 'platform',
      full_name: 'test-owner/platform',
      default_branch: 'main',
      visibility: 'private',
      clone_url: 'https://test.local/test-owner/platform.git',
      html_url: 'https://test.local/test-owner/platform',
      metadata_fetched_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  };
}
