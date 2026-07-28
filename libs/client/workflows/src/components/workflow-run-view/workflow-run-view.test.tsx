import type {WorkflowRunDetailResponseDto} from '@shipfox/api-workflows-dto';
import {configureApiClient} from '@shipfox/client-api';
import {toast} from '@shipfox/react-ui/toast';
import {screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {workflowRunsQueryKeys} from '#hooks/api/workflow-runs.js';
import {inlineLogBody, outputLine} from '#test/fixtures/logs.js';
import {
  runAttemptsResponseDto,
  workflowJobDto,
  workflowJobExecutionDto,
  workflowRunAttemptDto,
  workflowRunDetailDto,
  workflowRunDto,
  workflowStepAttemptDto,
  workflowStepDto,
} from '#test/fixtures/workflow-run.js';
import {jsonResponse, PROJECT_TEST_WID, renderProjectPage} from '#test/pages.js';
import {WorkflowRunView} from './workflow-run-view.js';

const RUN_ID = '66666666-6666-4666-8666-666666666666';
const PROJECT_ID = '44444444-4444-4444-8444-444444444444';
const DEFINITION_ID = '55555555-5555-4555-8555-555555555555';
const BUILD_JOB_ID = '77777777-7777-4777-8777-777777777777';
const DEPLOY_JOB_ID = '88888888-8888-4888-8888-888888888888';
const CHECKOUT_STEP_ID = '99999999-9999-4999-8999-999999999999';
const CHECKOUT_ATTEMPT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RERUN_BUTTON_NAME = /^Re-run/;
const ATTEMPT_2_PATTERN = /Attempt 2/;
const COPY_RUN_BUTTON_NAME = /Copy run/;
const EXECUTION_ONE_MENU_ITEM_PATTERN = /#1/;

describe('WorkflowRunView', () => {
  test('renders the run summary, jobs graph, and selected job step attempts when a run loads', async () => {
    configureApiClient({
      fetchImpl: vi.fn(() => Promise.resolve(jsonResponse(workflowRunViewDetailDto()))),
    });

    renderView();

    const summary = await screen.findByRole('region', {name: 'deploy-web'});

    expect(within(summary).getByRole('heading', {name: 'deploy-web'})).toBeInTheDocument();
    expect(within(summary).getAllByText('Running')).not.toHaveLength(0);
    expect(within(summary).getByText('fire')).toBeInTheDocument();
    expect(
      within(summary).queryByRole('button', {name: COPY_RUN_BUTTON_NAME}),
    ).not.toBeInTheDocument();
    expect(await screen.findByRole('region', {name: 'Workflow jobs'})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'build, Succeeded'})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'deploy, Running'})).toBeInTheDocument();
    expect(screen.getByRole('region', {name: 'build'})).toBeInTheDocument();
    expect(
      screen.getByRole('button', {name: 'checkout, Succeeded, attempt 1'}),
    ).toBeInTheDocument();
  });

  test('renders active step attempt logs inline when the selected job is running', async () => {
    const stepId = '99999999-9999-4999-8999-000000000001';
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.pathname === `/steps/${stepId}/attempts/1/logs`) {
        return Promise.resolve(jsonResponse(inlineLogBody(outputLine('live output\n'), 1)));
      }
      return Promise.resolve(
        jsonResponse(
          workflowRunViewDetailDto({
            jobs: [
              workflowJobDto({
                id: BUILD_JOB_ID,
                run_attempt_id: RUN_ID,
                name: 'build',
                status: 'running',
                steps: [
                  workflowStepDto({
                    id: stepId,
                    key: 'test',
                    name: 'test',
                    status: 'running',
                    attempts: [
                      workflowStepAttemptDto({
                        id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',
                        step_id: stepId,
                        status: 'running',
                        exit_code: null,
                        finished_at: null,
                      }),
                    ],
                  }),
                ],
              }),
            ],
          }),
        ),
      );
    });
    configureApiClient({fetchImpl: fetchImpl as typeof fetch});

    renderView();

    expect(await screen.findByText('live output')).toBeInTheDocument();
    const logRequest = fetchImpl.mock.calls
      .map((call) => new URL((call[0] as Request).url))
      .find((url) => url.pathname === `/steps/${stepId}/attempts/1/logs`);
    expect(logRequest?.searchParams.get('cursor')).toBe('0');
  });

  test('switches executions from the listening job header', async () => {
    const user = userEvent.setup();
    configureApiClient({
      fetchImpl: vi.fn(() =>
        Promise.resolve(
          jsonResponse(
            workflowRunViewDetailDto({
              jobs: [
                workflowJobDto({
                  id: BUILD_JOB_ID,
                  run_attempt_id: RUN_ID,
                  name: 'release-gates',
                  mode: 'listening',
                  status: 'running',
                  listener_status: 'listening',
                  job_executions: [
                    workflowJobExecutionDto({
                      id: '77777777-7777-4777-8777-000000000001',
                      job_id: BUILD_JOB_ID,
                      sequence: 1,
                      status: 'succeeded',
                      trigger_events: [
                        {
                          source: 'github',
                          event: 'pull_request',
                          delivery_id: 'delivery-1',
                          received_at: '2026-05-07T01:00:00.000Z',
                          data: {number: 12},
                        },
                      ],
                      started_at: '2026-05-07T01:01:00.000Z',
                      finished_at: '2026-05-07T01:01:20.000Z',
                      steps: [
                        workflowStepDto({
                          key: 'first-event',
                          name: 'first-event',
                          status: 'succeeded',
                          attempts: [
                            workflowStepAttemptDto({
                              status: 'succeeded',
                              finished_at: '2026-05-07T01:01:20.000Z',
                            }),
                          ],
                        }),
                      ],
                    }),
                    workflowJobExecutionDto({
                      id: '77777777-7777-4777-8777-000000000002',
                      job_id: BUILD_JOB_ID,
                      sequence: 2,
                      status: 'failed',
                      status_reason: 'step_failed',
                      trigger_events: [
                        {
                          source: 'github',
                          event: 'deployment_status',
                          delivery_id: 'delivery-2',
                          received_at: '2026-05-07T01:01:00.000Z',
                          data: {state: 'success'},
                        },
                        {
                          source: 'github',
                          event: 'check_run',
                          delivery_id: 'delivery-3',
                          received_at: '2026-05-07T01:01:10.000Z',
                          data: {status: 'completed'},
                        },
                      ],
                      started_at: '2026-05-07T01:02:00.000Z',
                      finished_at: '2026-05-07T01:02:20.000Z',
                      steps: [
                        workflowStepDto({
                          key: 'second-event',
                          name: 'second-event',
                          status: 'failed',
                          attempts: [
                            workflowStepAttemptDto({
                              status: 'failed',
                              exit_code: 1,
                              finished_at: '2026-05-07T01:02:20.000Z',
                            }),
                          ],
                        }),
                      ],
                    }),
                  ],
                }),
              ],
            }),
          ),
        ),
      ),
    });

    renderView();
    expect(await screen.findByText('second-event')).toBeInTheDocument();
    expect(
      await screen.findByRole('button', {name: 'github · deployment_status (2 events)'}),
    ).toBeInTheDocument();
    expect(screen.getByText('deployment_status (2)')).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', {name: 'Switch job execution, currently execution 2'}),
    );
    await user.click(screen.getByRole('menuitem', {name: EXECUTION_ONE_MENU_ITEM_PATTERN}));

    expect(await screen.findByText('first-event')).toBeInTheDocument();
    expect(screen.queryByText('second-event')).not.toBeInTheDocument();
    expect(await screen.findByRole('button', {name: 'github · pull_request'})).toBeInTheDocument();
    expect(screen.getByText('pull_request')).toBeInTheDocument();
    expect(screen.queryByText('deployment_status (2)')).not.toBeInTheDocument();
  });

  test('shows generic provider setup guidance for agent config failures', async () => {
    const user = userEvent.setup();
    const stepId = '99999999-9999-4999-8999-000000000004';
    const attemptId = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000004';
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.pathname === `/steps/${stepId}/attempts/1/logs`) {
        return Promise.resolve(
          jsonResponse(inlineLogBody(outputLine('configuration failed\n'), 1)),
        );
      }
      return Promise.resolve(
        jsonResponse(
          workflowRunViewDetailDto({
            jobs: [
              workflowJobDto({
                id: BUILD_JOB_ID,
                run_attempt_id: RUN_ID,
                name: 'build',
                status: 'failed',
                steps: [
                  workflowStepDto({
                    id: stepId,
                    key: 'implement',
                    name: 'Fix the failing tests.',
                    type: 'agent',
                    status: 'failed',
                    config: {
                      provider: 'anthropic',
                      model: 'claude-opus-4-8',
                      thinking: 'high',
                      prompt: 'Fix the failing tests.',
                    },
                    error: {
                      message: 'Model provider request failed',
                      reason: 'agent_invocation_failed',
                      category: 'user',
                    },
                    attempts: [
                      workflowStepAttemptDto({
                        id: attemptId,
                        step_id: stepId,
                        status: 'failed',
                        exit_code: 1,
                        error: {
                          message: 'Model provider credentials are not configured',
                          reason: 'agent_config_invalid',
                          agentConfigIssue: 'provider_not_configured',
                        },
                        finished_at: '2026-05-07T01:01:20.000Z',
                      }),
                    ],
                  }),
                ],
              }),
            ],
          }),
        ),
      );
    });
    configureApiClient({fetchImpl: fetchImpl as typeof fetch});

    renderView();
    await user.click(
      await screen.findByRole('button', {
        name: 'Fix the failing tests., Failed, attempt 1, User',
      }),
    );

    expect(
      screen.queryByRole('region', {name: 'Resolved agent configuration'}),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('anthropic')).not.toBeInTheDocument();
    expect(screen.queryByText('claude-opus-4-8')).not.toBeInTheDocument();
    expect(screen.queryByText('high')).not.toBeInTheDocument();
    expect(screen.getByText('Configure credentials for anthropic')).toBeInTheDocument();
    expect(
      screen.getByText(
        'This step uses anthropic, but no workspace credentials are configured for that model provider. Configure anthropic in Agents, then re-run the workflow.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'Configure Agents'})).toHaveAttribute(
      'href',
      `/workspaces/${PROJECT_TEST_WID}/settings/agents`,
    );
  });

  test('shows runner guidance for agent harness failures without step settings or admin actions', async () => {
    const user = userEvent.setup();
    const stepId = '99999999-9999-4999-8999-000000000006';
    const attemptId = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000006';
    configureApiClient({
      fetchImpl: vi.fn((input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url.pathname === `/steps/${stepId}/attempts/1/logs`) {
          return Promise.resolve(jsonResponse(inlineLogBody(outputLine('runner failed\n'), 1)));
        }
        return Promise.resolve(
          jsonResponse(
            workflowRunViewDetailDto({
              jobs: [
                workflowJobDto({
                  id: BUILD_JOB_ID,
                  run_attempt_id: RUN_ID,
                  name: 'build',
                  status: 'failed',
                  steps: [
                    workflowStepDto({
                      id: stepId,
                      key: 'implement',
                      name: 'Fix the failing tests.',
                      type: 'agent',
                      status: 'failed',
                      config: {
                        provider: 'anthropic',
                        model: 'claude-opus-4-8',
                        thinking: 'high',
                        prompt: 'Fix the failing tests.',
                      },
                      error: {
                        message: 'Pi extension setup failed: Unknown option: --mcp-config',
                        reason: 'agent_harness_unavailable',
                        category: 'user',
                      },
                      attempts: [
                        workflowStepAttemptDto({
                          id: attemptId,
                          step_id: stepId,
                          status: 'failed',
                          exit_code: 1,
                          error: {
                            message: 'Pi extension setup failed: Unknown option: --mcp-config',
                            reason: 'agent_harness_unavailable',
                          },
                          finished_at: '2026-05-07T01:01:20.000Z',
                        }),
                      ],
                    }),
                  ],
                }),
              ],
            }),
          ),
        );
      }),
    });

    renderView();
    await user.click(
      await screen.findByRole('button', {
        name: 'Fix the failing tests., Failed, attempt 1, User',
      }),
    );

    expect(
      screen.getByText('The runner could not start the agent for this step'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "This step's prompt, provider, model, and thinking settings are valid. The runner could not start its agent before the model was called, so nothing ran. Re-running will not help. Ask an administrator to update the runner, then re-run the workflow.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Runner reported: Pi extension setup failed: Unknown option: --mcp-config'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', {name: 'Configure Agents'})).not.toBeInTheDocument();
    expect(screen.queryByText('claude-opus-4-8')).not.toBeInTheDocument();
  });

  test('falls back to the step error when an agent attempt has no typed error', async () => {
    const user = userEvent.setup();
    const stepId = '99999999-9999-4999-8999-000000000005';
    const attemptId = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000005';
    configureApiClient({
      fetchImpl: vi.fn((input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url.pathname === `/steps/${stepId}/attempts/1/logs`) {
          return Promise.resolve(
            jsonResponse(inlineLogBody(outputLine('configuration failed\n'), 1)),
          );
        }
        return Promise.resolve(
          jsonResponse(
            workflowRunViewDetailDto({
              jobs: [
                workflowJobDto({
                  id: BUILD_JOB_ID,
                  run_attempt_id: RUN_ID,
                  name: 'build',
                  status: 'failed',
                  steps: [
                    workflowStepDto({
                      id: stepId,
                      key: 'implement',
                      name: 'Fix the failing tests.',
                      type: 'agent',
                      status: 'failed',
                      config: {
                        provider: 'anthropic',
                        model: 'claude-opus-4-8',
                        thinking: 'high',
                        prompt: 'Fix the failing tests.',
                      },
                      error: {
                        message: 'Model provider credentials are not configured',
                        reason: 'agent_config_invalid',
                        agent_config_issue: 'provider_not_configured',
                        category: 'user',
                      },
                      attempts: [
                        workflowStepAttemptDto({
                          id: attemptId,
                          step_id: stepId,
                          status: 'failed',
                          exit_code: 1,
                          error: null,
                          finished_at: '2026-05-07T01:01:20.000Z',
                        }),
                      ],
                    }),
                  ],
                }),
              ],
            }),
          ),
        );
      }),
    });

    renderView();
    await user.click(
      await screen.findByRole('button', {
        name: 'Fix the failing tests., Failed, attempt 1, User',
      }),
    );

    expect(screen.queryByText('anthropic')).not.toBeInTheDocument();
    expect(screen.queryByText('claude-opus-4-8')).not.toBeInTheDocument();
    expect(screen.queryByText('high')).not.toBeInTheDocument();
    expect(screen.getByText('Configure credentials for anthropic')).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'Configure Agents'})).toHaveAttribute(
      'href',
      `/workspaces/${PROJECT_TEST_WID}/settings/agents`,
    );
  });

  test('renders skipped zero-attempt jobs as skipped instead of missing attempts', async () => {
    configureApiClient({
      fetchImpl: vi.fn(() =>
        Promise.resolve(
          jsonResponse(
            workflowRunViewDetailDto({
              jobs: [
                workflowJobDto({
                  id: DEPLOY_JOB_ID,
                  run_attempt_id: RUN_ID,
                  name: 'deploy',
                  status: 'skipped',
                  status_reason: 'dependency_not_completed',
                  job_executions: [],
                }),
              ],
            }),
          ),
        ),
      ),
    });

    renderView();

    expect(await screen.findByText('This job was skipped')).toBeInTheDocument();
    expect(
      screen.getByText('A required job did not complete, so this job was skipped.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('No steps recorded')).not.toBeInTheDocument();
  });

  test('uses the selected execution status for zero-step execution states', async () => {
    configureApiClient({
      fetchImpl: vi.fn(() =>
        Promise.resolve(
          jsonResponse(
            workflowRunViewDetailDto({
              jobs: [
                workflowJobDto({
                  id: DEPLOY_JOB_ID,
                  run_attempt_id: RUN_ID,
                  name: 'deploy',
                  status: 'succeeded',
                  job_executions: [
                    workflowJobExecutionDto({
                      id: '77777777-7777-4777-8777-000000000003',
                      job_id: DEPLOY_JOB_ID,
                      sequence: 2,
                      name: 'retry',
                      status: 'running',
                      steps: [],
                    }),
                  ],
                }),
              ],
            }),
          ),
        ),
      ),
    });

    renderView();

    expect(await screen.findByText('Waiting for the first step')).toBeInTheDocument();
    expect(
      screen.getByText('This job is running, but no steps have started yet.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('No steps recorded')).not.toBeInTheDocument();
  });

  test('renders pending zero-step jobs as waiting to start', async () => {
    configureApiClient({
      fetchImpl: vi.fn(() =>
        Promise.resolve(
          jsonResponse(
            workflowRunViewDetailDto({
              jobs: [
                workflowJobDto({
                  id: DEPLOY_JOB_ID,
                  run_attempt_id: RUN_ID,
                  name: 'deploy',
                  status: 'pending',
                  steps: [],
                }),
              ],
            }),
          ),
        ),
      ),
    });

    renderView();

    expect(await screen.findByText('Waiting for this job to start')).toBeInTheDocument();
    expect(screen.getByText('Steps will appear here once the job starts.')).toBeInTheDocument();
    expect(screen.queryByText('No steps recorded')).not.toBeInTheDocument();
  });

  test('renders running zero-step jobs as waiting for the first step', async () => {
    configureApiClient({
      fetchImpl: vi.fn(() =>
        Promise.resolve(
          jsonResponse(
            workflowRunViewDetailDto({
              jobs: [
                workflowJobDto({
                  id: DEPLOY_JOB_ID,
                  run_attempt_id: RUN_ID,
                  name: 'deploy',
                  status: 'running',
                  job_executions: [
                    workflowJobExecutionDto({
                      job_id: DEPLOY_JOB_ID,
                      status: 'running',
                      steps: [],
                    }),
                  ],
                }),
              ],
            }),
          ),
        ),
      ),
    });

    renderView();

    expect(await screen.findByText('Waiting for the first step')).toBeInTheDocument();
    expect(
      screen.getByText('This job is running, but no steps have started yet.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('No steps recorded')).not.toBeInTheDocument();
  });

  test('renders active listening jobs with no executions as waiting for trigger events', async () => {
    configureApiClient({
      fetchImpl: vi.fn(() =>
        Promise.resolve(
          jsonResponse(
            workflowRunViewDetailDto({
              jobs: [
                workflowJobDto({
                  id: DEPLOY_JOB_ID,
                  run_attempt_id: RUN_ID,
                  name: 'release-gates',
                  mode: 'listening',
                  status: 'running',
                  listener_status: 'listening',
                  job_executions: [],
                }),
              ],
            }),
          ),
        ),
      ),
    });

    renderView();

    expect(await screen.findByText('Waiting for trigger events')).toBeInTheDocument();
    expect(
      screen.getByText('Matching trigger events will create job executions here.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Execution details unavailable')).not.toBeInTheDocument();
  });

  test('renders finished one-shot jobs with no execution as unavailable execution details', async () => {
    configureApiClient({
      fetchImpl: vi.fn(() =>
        Promise.resolve(
          jsonResponse(
            workflowRunViewDetailDto({
              jobs: [
                workflowJobDto({
                  id: DEPLOY_JOB_ID,
                  run_attempt_id: RUN_ID,
                  name: 'deploy',
                  status: 'succeeded',
                  job_executions: [],
                }),
              ],
            }),
          ),
        ),
      ),
    });

    renderView();

    expect(await screen.findByText('Execution details unavailable')).toBeInTheDocument();
    expect(
      screen.getByText('This job finished, but no job execution record is available.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Waiting for trigger events')).not.toBeInTheDocument();
  });

  test('renders cancelled zero-attempt jobs separately from skipped jobs', async () => {
    configureApiClient({
      fetchImpl: vi.fn(() =>
        Promise.resolve(
          jsonResponse(
            workflowRunViewDetailDto({
              jobs: [
                workflowJobDto({
                  id: DEPLOY_JOB_ID,
                  run_attempt_id: RUN_ID,
                  name: 'deploy',
                  status: 'cancelled',
                  job_executions: [
                    workflowJobExecutionDto({
                      job_id: DEPLOY_JOB_ID,
                      status: 'cancelled',
                      steps: [],
                    }),
                  ],
                }),
              ],
            }),
          ),
        ),
      ),
    });

    renderView();

    expect(await screen.findByText('Cancelled before start')).toBeInTheDocument();
    expect(screen.getByText('This job was cancelled before any step started.')).toBeInTheDocument();
    expect(screen.queryByText('This job was skipped')).not.toBeInTheDocument();
  });

  test('shows the not-found surface when the run 404s', async () => {
    configureApiClient({
      fetchImpl: vi.fn(() => Promise.resolve(jsonResponse({code: 'not-found'}, {status: 404}))),
    });

    renderView();

    expect(await screen.findByText('Run not found')).toBeInTheDocument();
  });

  test('shows the load-error placeholder when the run fails to load', async () => {
    configureApiClient({
      fetchImpl: vi.fn(() => Promise.resolve(jsonResponse({code: 'server-error'}, {status: 500}))),
    });

    renderView();

    expect(
      await screen.findByRole('button', {name: 'Retry loading workflow run'}),
    ).toBeInTheDocument();
  });

  test('opens and closes workflow source without resetting the selected job', async () => {
    const user = userEvent.setup();
    configureApiClient({
      fetchImpl: vi.fn(() =>
        Promise.resolve(
          jsonResponse(
            workflowRunViewDetailDto({
              source_snapshot: {
                format: 'yaml',
                content: 'jobs:\n  build:\n    steps:\n      - run: pnpm test',
              },
            }),
          ),
        ),
      ),
    });

    renderView();

    const deployNode = await screen.findByRole('button', {name: 'deploy, Running'});
    await user.click(deployNode);
    expect(deployNode).toHaveAttribute('aria-pressed', 'true');

    const sourceButton = within(screen.getByRole('region', {name: 'deploy-web'})).getByRole(
      'button',
      {name: 'View source'},
    );
    const panelId = sourceButton.getAttribute('aria-controls');
    expect(panelId).toBeTruthy();
    expect(sourceButton).toHaveAttribute('aria-expanded', 'false');

    await user.click(sourceButton);

    const sourcePanel = screen.getByRole('dialog', {name: 'Workflow source'});
    expect(sourceButton).toHaveAttribute('aria-expanded', 'true');
    expect(sourcePanel).toHaveAttribute('id', panelId);
    expect(sourcePanel).toHaveTextContent('pnpm test');

    await user.click(screen.getByRole('button', {name: 'Close source'}));

    await waitFor(() => expect(sourceButton).toHaveFocus());
    expect(sourceButton).toHaveAttribute('aria-expanded', 'false');
    expect(deployNode).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('region', {name: 'deploy'})).toBeInTheDocument();
  });

  test('highlights selected step source lines when the source panel opens', async () => {
    const user = userEvent.setup();
    const stepId = '99999999-9999-4999-8999-000000000003';
    configureApiClient({
      fetchImpl: vi.fn(() =>
        Promise.resolve(
          jsonResponse(
            workflowRunViewDetailDto({
              source_snapshot: {
                format: 'yaml',
                content: 'jobs:\n  deploy:\n    steps:\n      - run: ship',
              },
              jobs: [
                workflowJobDto({
                  id: DEPLOY_JOB_ID,
                  run_attempt_id: RUN_ID,
                  name: 'deploy',
                  status: 'running',
                  steps: [
                    workflowStepDto({
                      id: stepId,
                      key: 'deploy',
                      name: 'deploy',
                      source_location: {start_line: 2, end_line: 3},
                      status: 'running',
                    }),
                  ],
                }),
              ],
            }),
          ),
        ),
      ),
    });

    renderView({selection: {stepId}});
    const summary = await screen.findByRole('region', {name: 'deploy-web'});
    await user.click(within(summary).getByRole('button', {name: 'View source'}));

    await screen.findByRole('dialog', {name: 'Workflow source'});
    const highlightedLines = document.body.querySelectorAll('.line.highlighted-line');
    expect(highlightedLines).toHaveLength(2);
    expect(highlightedLines[0]).toHaveTextContent('deploy:');
    expect(highlightedLines[1]).toHaveTextContent('steps:');
  });

  test('does not render a source control when the run has no source snapshot', async () => {
    configureApiClient({
      fetchImpl: vi.fn(() =>
        Promise.resolve(jsonResponse(workflowRunViewDetailDto({source_snapshot: null}))),
      ),
    });

    renderView();

    await screen.findByRole('region', {name: 'deploy-web'});

    expect(screen.queryByRole('button', {name: 'View source'})).not.toBeInTheDocument();
  });

  test('opens the source panel highlighting a step from the job header Source button', async () => {
    const user = userEvent.setup();
    configureApiClient({
      fetchImpl: vi.fn(() => Promise.resolve(jsonResponse(locatedStepSourceDetail()))),
    });

    renderView();

    const jobRegion = await screen.findByRole('region', {name: 'build'});
    await user.click(screen.getByRole('button', {name: 'checkout, Succeeded, attempt 1'}));
    const jobSourceButton = within(jobRegion).getByRole('button', {name: 'View source'});
    const summaryButton = within(screen.getByRole('region', {name: 'deploy-web'})).getByRole(
      'button',
      {name: 'View source'},
    );
    expect(jobSourceButton).toHaveAttribute('aria-expanded', 'false');
    expect(jobSourceButton).toHaveAttribute(
      'aria-controls',
      summaryButton.getAttribute('aria-controls'),
    );

    await user.click(jobSourceButton);

    await screen.findByRole('dialog', {name: 'Workflow source'});
    const highlighted = document.body.querySelectorAll('.line.highlighted-line');
    expect(highlighted).toHaveLength(2);
    expect(highlighted[0]).toHaveTextContent('build:');
    expect(highlighted[1]).toHaveTextContent('steps:');
    expect(jobSourceButton).toHaveAttribute('aria-expanded', 'true');
    expect(summaryButton).toHaveAttribute('aria-expanded', 'false');
  });

  test('returns focus to the job Source button on close and preserves the selected job', async () => {
    const user = userEvent.setup();
    configureApiClient({
      fetchImpl: vi.fn(() => Promise.resolve(jsonResponse(locatedStepSourceDetail()))),
    });

    renderView();

    const jobRegion = await screen.findByRole('region', {name: 'build'});
    await user.click(screen.getByRole('button', {name: 'checkout, Succeeded, attempt 1'}));
    const jobSourceButton = within(jobRegion).getByRole('button', {name: 'View source'});

    await user.click(jobSourceButton);
    await screen.findByRole('dialog', {name: 'Workflow source'});
    await user.click(screen.getByRole('button', {name: 'Close source'}));

    await waitFor(() => expect(jobSourceButton).toHaveFocus());
    expect(jobSourceButton).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('region', {name: 'build'})).toBeInTheDocument();
  });

  test('falls back to the summary Source button when refetch removes the focused step source', async () => {
    const user = userEvent.setup();
    let detailRequests = 0;
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.pathname === `/workflows/runs/${RUN_ID}`) {
        detailRequests += 1;
        return Promise.resolve(
          jsonResponse(
            detailRequests === 1
              ? locatedStepSourceDetail()
              : locatedStepSourceDetail({
                  jobs: [
                    workflowJobDto({
                      id: BUILD_JOB_ID,
                      name: 'build',
                      status: 'succeeded',
                      steps: [
                        workflowStepDto({
                          id: CHECKOUT_STEP_ID,
                          name: 'checkout',
                          status: 'succeeded',
                          source_location: null,
                          attempts: [
                            workflowStepAttemptDto({
                              id: CHECKOUT_ATTEMPT_ID,
                              step_id: CHECKOUT_STEP_ID,
                              status: 'succeeded',
                              exit_code: 0,
                              finished_at: '2026-05-07T01:01:20.000Z',
                            }),
                          ],
                        }),
                      ],
                    }),
                  ],
                }),
          ),
        );
      }
      return Promise.resolve(jsonResponse(inlineLogBody(outputLine('done\n'), 1)));
    });
    configureApiClient({fetchImpl: fetchImpl as typeof fetch});

    const {queryClient} = renderView();

    const jobRegion = await screen.findByRole('region', {name: 'build'});
    await user.click(screen.getByRole('button', {name: 'checkout, Succeeded, attempt 1'}));
    const jobSourceButton = within(jobRegion).getByRole('button', {name: 'View source'});
    const summaryButton = within(screen.getByRole('region', {name: 'deploy-web'})).getByRole(
      'button',
      {name: 'View source'},
    );
    await user.click(jobSourceButton);
    await screen.findByRole('dialog', {name: 'Workflow source'});

    await queryClient.refetchQueries({queryKey: workflowRunsQueryKeys.detail(RUN_ID)});
    await waitFor(() =>
      expect(
        within(jobRegion).queryByRole('button', {name: 'View source'}),
      ).not.toBeInTheDocument(),
    );
    await user.click(screen.getByRole('button', {name: 'Close source'}));

    await waitFor(() => expect(summaryButton).toHaveFocus());
    expect(summaryButton).toHaveAttribute('aria-expanded', 'false');
  });

  test('re-runs all jobs from a succeeded run and navigates to the new run', async () => {
    const user = userEvent.setup();
    const rerunId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const successSpy = vi.spyOn(toast, 'success').mockImplementation(() => 'toast-id');
    const postBodies: unknown[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const request = input as Request;
      const url = requestUrl(input);
      if (request.method === 'POST' && url.pathname === `/workflows/runs/${RUN_ID}/rerun`) {
        postBodies.push(await request.clone().json());
        return jsonResponse(workflowRunDto({id: rerunId, status: 'pending'}));
      }
      return jsonResponse(
        workflowRunViewDetailDto({
          status: 'succeeded',
          jobs: [
            workflowJobDto({
              id: BUILD_JOB_ID,
              run_attempt_id: RUN_ID,
              name: 'build',
              status: 'succeeded',
            }),
          ],
        }),
      );
    });
    configureApiClient({fetchImpl: fetchImpl as typeof fetch});

    const {router} = renderView({}, '?runAttempt=1');
    await user.click(await screen.findByRole('button', {name: 'Re-run workflow'}));

    const postRequest = await findRequest(fetchImpl, 'POST', `/workflows/runs/${RUN_ID}/rerun`);
    expect(postRequest).toBeDefined();
    expect(postBodies).toEqual([{mode: 'all'}]);
    expect(successSpy).toHaveBeenCalledWith('Re-run started');
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/workspaces/${PROJECT_TEST_WID}/projects/${PROJECT_ID}/runs/${rerunId}`,
      ),
    );
    expect((router.state.location.search as Record<string, unknown>).runAttempt).toBeUndefined();
  });

  test('re-runs failed jobs from the dropdown', async () => {
    const user = userEvent.setup();
    const postBodies: unknown[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const request = input as Request;
      const url = requestUrl(input);
      if (request.method === 'POST' && url.pathname === `/workflows/runs/${RUN_ID}/rerun`) {
        postBodies.push(await request.clone().json());
        return jsonResponse(workflowRunDto({id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'}));
      }
      return jsonResponse(
        workflowRunViewDetailDto({
          status: 'failed',
          jobs: [
            workflowJobDto({
              id: BUILD_JOB_ID,
              run_attempt_id: RUN_ID,
              name: 'build',
              status: 'failed',
            }),
            workflowJobDto({
              id: DEPLOY_JOB_ID,
              run_attempt_id: RUN_ID,
              name: 'deploy',
              status: 'cancelled',
              position: 1,
            }),
          ],
        }),
      );
    });
    configureApiClient({fetchImpl: fetchImpl as typeof fetch});

    renderView();
    await user.click(await screen.findByRole('button', {name: 'Re-run jobs'}));
    await user.click(await screen.findByRole('menuitem', {name: 'Re-run failed jobs'}));

    const postRequest = await findRequest(fetchImpl, 'POST', `/workflows/runs/${RUN_ID}/rerun`);
    expect(postRequest).toBeDefined();
    expect(postBodies).toEqual([{mode: 'failed'}]);
  });

  test('shows an error toast when rerun creation fails', async () => {
    const user = userEvent.setup();
    const errorSpy = vi.spyOn(toast, 'error').mockImplementation(() => 'toast-id');
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const request = input as Request;
      const url = requestUrl(input);
      if (request.method === 'POST' && url.pathname === `/workflows/runs/${RUN_ID}/rerun`) {
        return Promise.resolve(
          jsonResponse({code: 'no-failed-jobs', message: 'Run has no failed jobs'}, {status: 409}),
        );
      }
      return Promise.resolve(jsonResponse(workflowRunViewDetailDto({status: 'succeeded'})));
    });
    configureApiClient({fetchImpl: fetchImpl as typeof fetch});

    renderView();
    await user.click(await screen.findByRole('button', {name: 'Re-run workflow'}));

    await waitFor(() => expect(errorSpy).toHaveBeenCalledWith('Run has no failed jobs'));
  });

  test('selects another run attempt and clears job selection search', async () => {
    const user = userEvent.setup();
    const secondAttemptId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.pathname === `/workflows/runs/${RUN_ID}/attempts`) {
        return Promise.resolve(
          jsonResponse(
            runAttemptsResponseDto({
              attempts: [
                workflowRunAttemptDto({
                  id: RUN_ID,
                  attempt: 1,
                  status: 'succeeded',
                  created_at: '2026-05-07T01:01:00.000Z',
                }),
                workflowRunAttemptDto({
                  id: secondAttemptId,
                  attempt: 2,
                  status: 'running',
                  created_at: '2026-05-07T01:02:00.000Z',
                  rerun_mode: 'all',
                }),
              ],
            }),
          ),
        );
      }
      return Promise.resolve(
        jsonResponse(
          workflowRunViewDetailDto({
            current_attempt: 1,
            latest_attempt: 2,
            run_attempt: workflowRunAttemptDto({id: RUN_ID, workflow_run_id: RUN_ID, attempt: 1}),
          }),
        ),
      );
    });
    configureApiClient({fetchImpl: fetchImpl as typeof fetch});

    const {router} = renderProjectPage(
      `/workspaces/${PROJECT_TEST_WID}/projects/${PROJECT_ID}/runs/${RUN_ID}?job=${BUILD_JOB_ID}&step=${CHECKOUT_STEP_ID}&stepAttempt=${CHECKOUT_ATTEMPT_ID}`,
      () => (
        <WorkflowRunView
          workspaceId={PROJECT_TEST_WID}
          projectId={PROJECT_ID}
          workflowRunId={RUN_ID}
        />
      ),
    );

    await user.click(await screen.findByRole('button', {name: 'Switch attempt, currently 1 of 2'}));
    await user.click(await screen.findByRole('menuitem', {name: ATTEMPT_2_PATTERN}));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/workspaces/${PROJECT_TEST_WID}/projects/${PROJECT_ID}/runs/${RUN_ID}`,
      ),
    );
    expect(router.state.location.search).toEqual({runAttempt: 2});
  });

  test('does not render rerun controls for non-terminal runs', async () => {
    configureApiClient({
      fetchImpl: vi.fn(() => Promise.resolve(jsonResponse(workflowRunViewDetailDto()))),
    });

    renderView();

    await screen.findByRole('region', {name: 'deploy-web'});
    expect(screen.queryByRole('button', {name: RERUN_BUTTON_NAME})).not.toBeInTheDocument();
  });

  test('renders carried-over steps without requesting attempt logs', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        jsonResponse(
          workflowRunViewDetailDto({
            status: 'succeeded',
            jobs: [
              workflowJobDto({
                id: BUILD_JOB_ID,
                run_attempt_id: RUN_ID,
                name: 'build',
                status: 'succeeded',
                carried_over: true,
                steps: [
                  workflowStepDto({
                    id: CHECKOUT_STEP_ID,
                    key: 'checkout',
                    name: 'checkout',
                    status: 'succeeded',
                    attempts: [],
                  }),
                ],
              }),
            ],
          }),
        ),
      ),
    );
    configureApiClient({fetchImpl: fetchImpl as typeof fetch});

    renderView();
    expect(
      await screen.findByRole('button', {name: 'build, Succeeded, reused'}),
    ).toBeInTheDocument();
    expect(screen.getAllByText('reused')).toHaveLength(2);
    await user.click(screen.getByRole('button', {name: 'checkout, Succeeded, attempt 1'}));

    expect(await screen.findByText('Not executed in this run.')).toBeInTheDocument();
    expect(
      mockRequests(fetchImpl).some((request) => requestUrl(request).pathname.includes('/logs')),
    ).toBe(false);
  });
});

function renderView(props: Partial<Parameters<typeof WorkflowRunView>[0]> = {}, search = '') {
  return renderProjectPage(
    `/workspaces/${PROJECT_TEST_WID}/projects/x/runs/${RUN_ID}${search}`,
    () => (
      <WorkflowRunView
        workspaceId={PROJECT_TEST_WID}
        projectId={PROJECT_ID}
        workflowRunId={RUN_ID}
        {...props}
      />
    ),
  );
}

function requestUrl(input: RequestInfo | URL): URL {
  if (input instanceof Request) return new URL(input.url);
  return new URL(String(input));
}

async function findRequest(
  fetchImpl: ReturnType<typeof vi.fn>,
  method: string,
  pathname: string,
): Promise<Request> {
  await waitFor(() => {
    const match = mockRequests(fetchImpl).find(
      (request) => request.method === method && requestUrl(request).pathname === pathname,
    );
    expect(match).toBeDefined();
  });
  const match = mockRequests(fetchImpl).find(
    (request) => request.method === method && requestUrl(request).pathname === pathname,
  );
  if (!match) throw new Error(`Missing ${method} ${pathname}`);
  return match;
}

function mockRequests(fetchImpl: ReturnType<typeof vi.fn>): Request[] {
  return (fetchImpl.mock.calls as unknown[][])
    .map((call) => call[0])
    .filter((input): input is Request => input instanceof Request);
}

function locatedStepSourceDetail(
  overrides: Partial<WorkflowRunDetailResponseDto> = {},
): WorkflowRunDetailResponseDto {
  return workflowRunViewDetailDto({
    source_snapshot: {
      format: 'yaml',
      content: 'jobs:\n  build:\n    steps:\n      - run: pnpm test',
    },
    jobs: [
      workflowJobDto({
        id: BUILD_JOB_ID,
        name: 'build',
        status: 'succeeded',
        steps: [
          workflowStepDto({
            id: CHECKOUT_STEP_ID,
            name: 'checkout',
            status: 'succeeded',
            source_location: {start_line: 2, end_line: 3},
            attempts: [
              workflowStepAttemptDto({
                id: CHECKOUT_ATTEMPT_ID,
                step_id: CHECKOUT_STEP_ID,
                status: 'succeeded',
                exit_code: 0,
                finished_at: '2026-05-07T01:01:20.000Z',
              }),
            ],
          }),
        ],
      }),
    ],
    ...overrides,
  });
}

function workflowRunViewDetailDto(
  overrides: Partial<WorkflowRunDetailResponseDto> = {},
): WorkflowRunDetailResponseDto {
  return workflowRunDetailDto({
    id: RUN_ID,
    project_id: PROJECT_ID,
    definition_id: DEFINITION_ID,
    name: 'deploy-web',
    status: 'running',
    trigger_payload: {},
    created_at: '2026-05-07T01:01:00.000Z',
    updated_at: '2026-05-07T01:02:00.000Z',
    jobs: [
      workflowJobDto({
        id: BUILD_JOB_ID,
        run_attempt_id: RUN_ID,
        name: 'build',
        status: 'succeeded',
        steps: [
          workflowStepDto({
            id: CHECKOUT_STEP_ID,
            key: 'checkout',
            name: 'checkout',
            status: 'succeeded',
            attempts: [
              workflowStepAttemptDto({
                id: CHECKOUT_ATTEMPT_ID,
                step_id: CHECKOUT_STEP_ID,
                status: 'succeeded',
                exit_code: 0,
                finished_at: '2026-05-07T01:01:20.000Z',
              }),
            ],
          }),
        ],
      }),
      workflowJobDto({
        id: DEPLOY_JOB_ID,
        run_attempt_id: RUN_ID,
        name: 'deploy',
        status: 'running',
        position: 1,
        dependencies: ['build'],
      }),
    ],
    ...overrides,
  });
}
