import {configureApiClient} from '@shipfox/client-api';
import {fireEvent, screen, waitFor} from '@testing-library/react';
import {jsonResponse, PROJECT_TEST_WID, renderProjectPage} from '#test/pages.js';
import {ProjectWorkflowsPage} from './project-workflows-page.js';

const PROJECT_ID = '44444444-4444-4444-8444-444444444444';
const CONNECTION_ID = '33333333-3333-4333-8333-333333333333';

describe('ProjectWorkflowsPage', () => {
  test('renders workflow definitions and the source strip', async () => {
    configureApiClient({fetchImpl: createProjectDetailFetch()});

    renderWorkflowsPage();

    expect(await screen.findByRole('heading', {name: 'Workflows'})).toBeInTheDocument();
    expect(screen.getAllByText('Deploy production')[0]).toBeInTheDocument();
    expect(screen.getAllByText('.shipfox/workflows/deploy.yml')[0]).toBeInTheDocument();
    expect(screen.getByRole('region', {name: 'Project source'})).toBeInTheDocument();
    // Source strip resolves connection display_name from the integrations
    // workspace cache; external_repository_id renders as a Code chip.
    expect(await screen.findByText('Acme GitHub')).toBeInTheDocument();
    expect(screen.getAllByText('platform')[0]).toBeInTheDocument();
    expect(screen.getAllByText('succeeded')[0]).toBeInTheDocument();
    expect(screen.queryByRole('heading', {name: 'Source identity'})).not.toBeInTheDocument();
  });

  test('shows definitions error while keeping the source strip visible', async () => {
    configureApiClient({
      fetchImpl: createProjectDetailFetch({
        definitions: jsonResponse({code: 'server-error'}, {status: 500}),
      }),
    });

    renderWorkflowsPage();

    expect(await screen.findByText("Couldn't load workflows")).toBeInTheDocument();
    // SyncBadge in the strip falls back to Unavailable when sync is undefined
    // (definitions errored before providing one).
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.getByRole('region', {name: 'Project source'})).toBeInTheDocument();
  });

  test('shows failed sync empty state', async () => {
    configureApiClient({
      fetchImpl: createProjectDetailFetch({
        definitions: jsonResponse(
          definitionsDto({
            definitions: [],
            sync: {
              ref: 'main',
              status: 'failed',
              last_sync_at: '2026-05-07T01:00:00.000Z',
              started_at: '2026-05-07T01:00:00.000Z',
              finished_at: null,
              last_error_code: 'no-workflow-files',
              last_error_message: 'No workflow files found',
              warnings: [
                {
                  code: 're-evaluating-command',
                  message: 'Workflow data is re-executed as shell code.',
                  path: 'jobs.build.steps.0.run',
                },
              ],
            },
          }),
        ),
      }),
    });

    renderWorkflowsPage();

    expect(
      await screen.findByText('No workflow files found under .shipfox/workflows/.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Workflow sync failed')).toBeInTheDocument();
    expect(screen.queryByText('Workflow definition warnings')).not.toBeInTheDocument();
  });

  test('shows definition warnings without rendering a sync failure', async () => {
    configureApiClient({
      fetchImpl: createProjectDetailFetch({
        definitions: jsonResponse(
          definitionsDto({
            sync: {
              ref: 'main',
              status: 'succeeded',
              last_sync_at: '2026-05-07T01:00:00.000Z',
              started_at: '2026-05-07T00:59:55.000Z',
              finished_at: '2026-05-07T01:00:00.000Z',
              last_error_code: null,
              last_error_message: null,
              warnings: [
                {
                  code: 're-evaluating-command',
                  message: 'Workflow data is re-executed as shell code.',
                  path: 'jobs.build.steps.0.run',
                },
                {
                  code: 're-evaluating-command',
                  message: 'Workflow data is re-executed as shell code.',
                  path: 'jobs.build.steps.0.run',
                },
              ],
            },
          }),
        ),
      }),
    });

    renderWorkflowsPage();

    expect(await screen.findByText('Workflow definition warnings')).toBeInTheDocument();
    expect(screen.getAllByText('Workflow data is re-executed as shell code.')).toHaveLength(2);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getAllByText('jobs.build.steps.0.run')).toHaveLength(2);
    expect(screen.queryByText('Workflow sync failed')).not.toBeInTheDocument();
  });

  test('opens and closes the definition drawer by clicking the row', async () => {
    configureApiClient({fetchImpl: createProjectDetailFetch()});

    renderWorkflowsPage();

    const workflowName = (await screen.findAllByText('Deploy production'))[0];
    if (!workflowName) throw new Error('Workflow row was not rendered');
    fireEvent.click(workflowName);

    expect(await screen.findByText('Normalized definition')).toBeInTheDocument();
    expect(screen.getByText((content) => content.includes('"deploy"'))).toBeInTheDocument();

    fireEvent.keyDown(document, {key: 'Escape'});

    await waitFor(() => {
      expect(screen.queryByText('Normalized definition')).not.toBeInTheDocument();
    });
  });

  test('queues a run from a workflow definition', async () => {
    configureApiClient({fetchImpl: createProjectDetailFetch()});

    renderWorkflowsPage();

    // Run button lives in the row's hover-reveal slot; getAllByRole still
    // sees it (opacity-0, not display:none).
    const [runButton] = await screen.findAllByRole('button', {name: 'Run'});
    if (!runButton) throw new Error('Run button was not rendered');

    fireEvent.click(runButton);

    expect(await screen.findByText('Run queued')).toBeInTheDocument();
  });

  test('renders not found state', async () => {
    configureApiClient({
      fetchImpl: vi.fn((input) => {
        const url = new URL(requestInputUrl(input));
        if (url.pathname === `/projects/${PROJECT_ID}`) {
          return Promise.resolve(jsonResponse({code: 'not-found'}, {status: 404}));
        }
        if (url.pathname === '/integration-connections') {
          return Promise.resolve(jsonResponse(connectionsDto()));
        }
        return Promise.resolve(jsonResponse(definitionsDto()));
      }),
    });

    renderWorkflowsPage();

    expect(await screen.findByText('Project not found')).toBeInTheDocument();
  });
});

function renderWorkflowsPage() {
  return renderProjectPage(
    `/workspaces/${PROJECT_TEST_WID}/projects/${PROJECT_ID}/workflows`,
    () => <ProjectWorkflowsPage projectId={PROJECT_ID} />,
  );
}

function createProjectDetailFetch({
  project = jsonResponse(projectDto()),
  definitions = jsonResponse(definitionsDto()),
  run = jsonResponse(runDto(), {status: 201}),
  connections = jsonResponse(connectionsDto()),
}: {
  project?: Response;
  definitions?: Response;
  run?: Response;
  connections?: Response;
} = {}) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(requestInputUrl(input));
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');

    if (url.pathname === `/projects/${PROJECT_ID}`) {
      return Promise.resolve(project.clone());
    }
    if (url.pathname === '/definitions') {
      return Promise.resolve(definitions.clone());
    }
    if (url.pathname === '/integration-connections') {
      return Promise.resolve(connections.clone());
    }
    if (
      url.pathname.startsWith('/workflow-definitions/') &&
      url.pathname.endsWith('/fire-manual') &&
      method === 'POST'
    ) {
      return Promise.resolve(run.clone());
    }
    return Promise.resolve(jsonResponse({code: 'not-found'}, {status: 404}));
  });
}

function requestInputUrl(input: RequestInfo | URL) {
  if (input instanceof Request) return input.url;
  return String(input);
}

function projectDto() {
  return {
    id: PROJECT_ID,
    workspace_id: PROJECT_TEST_WID,
    name: 'Platform',
    slug: 'platform',
    source: {
      connection_id: CONNECTION_ID,
      external_repository_id: 'platform',
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function connectionsDto() {
  return {
    connections: [
      {
        id: CONNECTION_ID,
        workspace_id: PROJECT_TEST_WID,
        provider: 'github',
        external_account_id: 'acme',
        slug: 'github_acme',
        display_name: 'Acme GitHub',
        lifecycle_status: 'active',
        capabilities: ['source_control'],
        created_at: '2026-05-07T00:00:00.000Z',
        updated_at: '2026-05-07T00:00:00.000Z',
      },
    ],
  };
}

function definitionsDto(overrides: Partial<{definitions: unknown[]; sync: unknown}> = {}) {
  return {...baseDefinitionsDto(), ...overrides};
}

function baseDefinitionsDto() {
  return {
    definitions: [
      {
        id: '55555555-5555-4555-8555-555555555555',
        project_id: PROJECT_ID,
        config_path: '.shipfox/workflows/deploy.yml',
        source: 'vcs',
        sha: 'abc123',
        ref: 'main',
        name: 'Deploy production',
        workflow_document: {
          name: 'Deploy production',
          triggers: {on_demand: {source: 'manual', event: 'fire'}},
          jobs: {deploy: {steps: [{run: './deploy.sh'}]}},
        },
        workflow_model: {kind: 'workflow', name: 'Deploy production'},
        manual_trigger: {name: 'on_demand'},
        fetched_at: '2026-05-07T01:00:00.000Z',
        created_at: '2026-05-07T01:00:00.000Z',
        updated_at: '2026-05-07T01:00:00.000Z',
      },
    ],
    next_cursor: null,
    sync: {
      ref: 'main',
      status: 'succeeded',
      last_sync_at: '2026-05-07T01:00:00.000Z',
      started_at: '2026-05-07T00:59:55.000Z',
      finished_at: '2026-05-07T01:00:00.000Z',
      last_error_code: null,
      last_error_message: null,
      warnings: [],
    },
  };
}

function runDto() {
  return {workflow_run_id: '66666666-6666-4666-8666-666666666666'};
}
