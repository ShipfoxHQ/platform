import {configureApiClient} from '@shipfox/client-api';
import {fireEvent, screen, waitFor, within} from '@testing-library/react';
import {
  jsonResponse,
  PROJECT_TEST_WID,
  PROJECT_TEST_WSLUG,
  renderProjectPage,
} from '#test/pages.js';
import {ProjectWorkflowsPage} from './project-workflows-page.js';

const PROJECT_ID = '44444444-4444-4444-8444-444444444444';
const CONNECTION_ID = '33333333-3333-4333-8333-333333333333';

describe('ProjectWorkflowsPage', () => {
  test('renders workflow definitions and their panel regions', async () => {
    configureApiClient({fetchImpl: createProjectDetailFetch()});

    renderWorkflowsPage();

    expect((await screen.findAllByText('Deploy production'))[0]).toBeInTheDocument();
    expect(screen.getByRole('heading', {name: 'Workflows'})).toHaveClass('sr-only');
    expect(
      screen.queryByText('Synced workflow definitions for this project source.'),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText('.shipfox/workflows/deploy.yml')[0]).toBeInTheDocument();
    const sourcePanel = screen
      .getByRole('region', {name: 'Project source'})
      .closest('[data-slot="panel"]');
    const definitionsPanel = screen.getByRole('region', {name: 'Workflow definitions'});
    expect(sourcePanel).toBeInTheDocument();
    expect(definitionsPanel).toBeInTheDocument();
    expect(sourcePanel).not.toBe(definitionsPanel);
    expect(screen.getByRole('table').closest('[data-slot="panel"]')).toBe(definitionsPanel);
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
              diagnostics: [
                {
                  code: 'invalid-definition',
                  message: 'Step gate success must be a valid CEL boolean expression.: No such key',
                  path: 'jobs.build.steps.0.gate.success',
                  file_path: '.shipfox/workflows/invalid.yml',
                  severity: 'error',
                },
                {
                  code: 'invalid-definition',
                  message: 'Another validation error: invalid value',
                  path: 'jobs.build.steps.1.gate.success',
                  file_path: '.shipfox/workflows/invalid.yml',
                  severity: 'error',
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
    expect(screen.getByText('Workflow definition errors')).toBeInTheDocument();
    expect(screen.getByText('.shipfox/workflows/invalid.yml')).toBeInTheDocument();
    expect(screen.getByText('jobs.build.steps.0.gate.success')).toBeInTheDocument();
    expect(
      screen.getByText('Step gate success must be a valid CEL boolean expression.: No such key'),
    ).toHaveClass('text-tag-error-text');
    expect(screen.getByText('jobs.build.steps.1.gate.success')).toBeInTheDocument();
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
              diagnostics: [
                {
                  code: 're-evaluating-command',
                  message: 'Workflow data is re-executed as shell code.',
                  path: 'jobs.build.steps.0.run',
                  file_path: '.shipfox/workflows/warning.yml',
                  severity: 'warning',
                },
                {
                  code: 're-evaluating-command',
                  message: 'Workflow data is re-executed as shell code.',
                  path: 'jobs.build.steps.0.run',
                  file_path: '.shipfox/workflows/warning.yml',
                  severity: 'warning',
                },
              ],
            },
          }),
        ),
      }),
    });

    renderWorkflowsPage();

    expect(await screen.findByText('Workflow definition warnings')).toBeInTheDocument();
    // Both warnings group under the shared workflow file; the file label renders once.
    expect(screen.getAllByText('Workflow data is re-executed as shell code.')).toHaveLength(2);
    expect(screen.getAllByText('.shipfox/workflows/warning.yml')).toHaveLength(1);
    expect(screen.getAllByText('jobs.build.steps.0.run')).toHaveLength(2);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('Workflow sync failed')).not.toBeInTheDocument();
  });

  test('shows errors and warnings together with severity labels, grouped by file path', async () => {
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
              diagnostics: [
                {
                  code: 'invalid-trigger-event',
                  message: 'Trigger event is never delivered by this source.',
                  path: 'triggers.on_deploy',
                  file_path: '.shipfox/workflows/deploy.yml',
                  severity: 'error',
                },
                {
                  code: 'unknown-trigger-source',
                  message: 'No connection matches this source slug.',
                  path: 'triggers.on_deploy',
                  file_path: '.shipfox/workflows/deploy.yml',
                  severity: 'warning',
                },
                {
                  code: 're-evaluating-command',
                  message: 'Workflow data is re-executed as shell code.',
                  path: 'jobs.build.steps.0.run',
                  file_path: '.shipfox/workflows/build.yml',
                  severity: 'warning',
                },
              ],
            },
          }),
        ),
      }),
    });

    renderWorkflowsPage();

    expect(await screen.findByText('Workflow definition diagnostics')).toBeInTheDocument();
    const diagnosticsCallout = screen.getByRole('status');
    expect(diagnosticsCallout).toBeInTheDocument();
    // Two groups: the deploy workflow file and the build workflow file.
    expect(within(diagnosticsCallout).getAllByText('.shipfox/workflows/deploy.yml')).toHaveLength(
      1,
    );
    expect(within(diagnosticsCallout).getAllByText('.shipfox/workflows/build.yml')).toHaveLength(1);
    expect(within(diagnosticsCallout).getAllByText('triggers.on_deploy')).toHaveLength(2);
    expect(within(diagnosticsCallout).getAllByText('jobs.build.steps.0.run')).toHaveLength(1);
    const errorRow = within(diagnosticsCallout).getByText(
      'Trigger event is never delivered by this source.',
    );
    const warningRow = within(diagnosticsCallout).getByText(
      'No connection matches this source slug.',
    );
    expect(errorRow).toHaveClass('text-tag-error-text');
    expect(warningRow).not.toHaveClass('text-tag-error-text');
    expect(
      within(diagnosticsCallout).getByText('Error:', {selector: 'span.font-medium'}),
    ).toBeInTheDocument();
    expect(
      within(diagnosticsCallout).getAllByText('Warning:', {selector: 'span.font-medium'}),
    ).toHaveLength(2);
    expect(
      within(diagnosticsCallout).getByText('Workflow data is re-executed as shell code.'),
    ).toBeInTheDocument();
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
  return renderProjectPage(`/w/${PROJECT_TEST_WSLUG}/p/project/workflows`, () => (
    <ProjectWorkflowsPage projectId={PROJECT_ID} />
  ));
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
      diagnostics: [],
    },
  };
}

function runDto() {
  return {workflow_run_id: '66666666-6666-4666-8666-666666666666'};
}
