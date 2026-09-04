import type {
  StepAttemptDetailResponseDto,
  StepAttemptDto,
  WorkflowRunStepDetailDto,
} from '@shipfox/api-workflows-dto';
import {configureApiClient, resetApiClient} from '@shipfox/client-api';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import {act, render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {useState} from 'react';
import type {StepErrorReason} from '#core/workflow-run.js';
import {stepAttemptDetailQueryKeys} from '#hooks/api/step-attempt-detail.js';
import {
  workflowJob,
  workflowJobExecutionDto,
  workflowStepAttemptDto,
  workflowStepDto,
} from '#test/fixtures/workflow-run.js';
import {buildStepListModel, type StepListEntryModel} from '../step-list/step-list-model.js';
import {StepInspectorSheet} from './step-troubleshooting.js';

const STEP_ID = '55555555-5555-4555-8555-555555555555';
const ATTEMPT_ID = '66666666-6666-4666-8666-666666666666';
const EXECUTION_ID = '77777777-7777-4777-8777-777777777777';
const INSPECTOR_TRIGGER_NAME = 'Open inspector';
const INVOCATION_LOG_DESCRIPTION = /The full result remains available in the invocation log\./u;
const REDUCE_AUTHORED_VALUE_DESCRIPTION =
  "Reduce the authored value or its upstream input before starting a new run. Re-running failed jobs preserves this attempt's inputs; re-running all jobs can recompute upstream outputs.";
const REDUCE_STEP_RESULT_DESCRIPTION =
  "Reduce the user-controlled result before re-running. Re-running failed jobs preserves this attempt's inputs.";

describe('StepInspectorSheet', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetApiClient();
  });

  it('shows a loading state only after the inspector is opened', async () => {
    const user = userEvent.setup();
    configureApiClient({
      fetchImpl: vi.fn(() => new Promise<Response>(() => undefined)),
    });

    await renderPanel();

    expect(screen.queryByRole('status', {name: 'Loading troubleshooting details'})).toBeNull();
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));
    expect(
      await screen.findByRole('status', {name: 'Loading troubleshooting details'}),
    ).toBeInTheDocument();
  });

  it('keeps failure detail out of the default log path', async () => {
    const user = userEvent.setup();
    configureApiClient({
      fetchImpl: vi.fn(() => new Promise<Response>(() => undefined)),
    });

    await renderPanel();

    expect(screen.queryByRole('alert')).toBeNull();
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it.each([
    {
      reason: 'agent_session_key_invalid',
      title: 'Agent session key is invalid',
      description: 'The resolved agent session key does not match the allowed key format.',
    },
    {
      reason: 'agent_inference_credentials_unavailable',
      title: 'Inference credentials are unavailable',
      description:
        'Shipfox could not obtain inference credentials for this agent. Try again. If the problem continues, check the model provider configuration.',
    },
    {
      reason: 'agent_session_held',
      title: 'Agent session is held by another attempt',
      description:
        'Another running step currently holds this agent session. Parallel steps cannot share a session in resume mode.',
    },
    {
      reason: 'agent_session_harness_mismatch',
      title: 'Agent session harness does not match',
      description: 'The step harness differs from the harness the agent session is pinned to.',
    },
    {
      reason: 'agent_session_unavailable',
      title: 'Agent session is unavailable',
      description:
        'The agent session was unavailable during dispatch. Review the error details below and retry after resolving the cause.',
    },
  ] as const)('explains the $reason failure', async ({reason, title, description}) => {
    const user = userEvent.setup();
    configureApiClient({
      fetchImpl: vi.fn(() => new Promise<Response>(() => undefined)),
    });

    await renderPanel({entry: stepEntry(reason)});
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(screen.getByText(description)).toBeInTheDocument();
  });

  it('shows the evaluation count only after the lazy detail response arrives', async () => {
    const user = userEvent.setup();
    configureApiClient({
      fetchImpl: vi.fn(async () =>
        jsonResponse(
          stepDetailResponse({
            step_id: STEP_ID,
            attempt: 1,
            authored_config: {run: 'pnpm test'},
            config: {run: 'pnpm test --filter=client'},
            evaluation_trace: [
              {
                expression: 'inputs.message',
                roots: ['inputs.message'],
                fill_target: 'run',
                evaluated_at: '2026-08-05T12:00:00.000Z',
                field: 'run',
                value: 'hello',
              },
            ],
          }),
        ),
      ),
    });

    await renderPanel();

    expect(screen.queryByText('Evaluation')).toBeNull();
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));
    expect((await screen.findAllByText('Evaluation')).length).toBeGreaterThan(0);
  });

  it('renders complete attempt diagnostics from the lazy detail response', async () => {
    const user = userEvent.setup();
    configureApiClient({
      fetchImpl: vi.fn(async () =>
        jsonResponse(
          stepDetailResponse({
            authored_config: {tool: {id: 'chat_post_message'}},
            config: {
              tool: {
                provider: 'slack',
                id: 'chat_post_message',
                with: {channel: '#releases'},
              },
            },
            output: {result: {id: 'result-1'}},
            outputs: {message_id: 'message-1'},
            response: 'provider response',
            error: {message: 'diagnostic warning', reason: 'tool_error'},
            gate_result: {kind: 'passed', passed: true, source: 'exit 0', exit_code: 0},
            invocations: [
              {
                call_index: 0,
                started_at: '2026-09-01T09:00:00.000Z',
                finished_at: '2026-09-01T09:00:00.412Z',
                outcome: 'success',
                duration_ms: 412,
              },
            ],
            restart_feedback: 'Restarted from the previous attempt.',
          }),
        ),
      ),
    });

    await renderPanel({entry: toolStepEntry({status: 'succeeded'})});
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    const configuration = await screen.findByRole('region', {name: 'Configuration'});
    expect(
      within(configuration).getByRole('tab', {name: 'Authored configuration'}),
    ).toBeInTheDocument();
    expect(
      within(configuration).getByRole('tab', {name: 'Resolved configuration'}),
    ).toBeInTheDocument();
    expect(screen.getByRole('region', {name: 'Invocations'})).toHaveTextContent('Succeeded');
    expect(screen.getByText('provider response')).toBeInTheDocument();
    expect(screen.getByRole('region', {name: 'Attempt diagnostics'})).toHaveTextContent(
      'diagnostic warning',
    );
    expect(screen.getByRole('region', {name: 'Attempt diagnostics'})).toHaveTextContent(
      'Restarted from the previous attempt.',
    );
  });

  it('renders a failed gate in attempt diagnostics', async () => {
    const user = userEvent.setup();
    configureApiClient({
      fetchImpl: vi.fn(async () =>
        jsonResponse(
          stepDetailResponse({
            gate_result: {kind: 'failed', passed: false, source: 'exit 1', exit_code: 1},
          }),
        ),
      ),
    });

    await renderPanel({entry: toolStepEntry({status: 'failed'})});
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    const diagnostics = await screen.findByRole('region', {name: 'Attempt diagnostics'});
    expect(diagnostics).toHaveTextContent('failed');
    expect(diagnostics).toHaveTextContent('exit 1');
  });

  it('renders typed unavailable states for oversized diagnostic fields', async () => {
    const user = userEvent.setup();
    configureApiClient({
      fetchImpl: vi.fn(async () =>
        jsonResponse(
          stepDetailResponse({
            oversized_fields: [
              {
                field: 'config',
                stored_bytes: 70_000,
                reason: 'legacy_value_exceeds_inline_limit',
              },
              {
                field: 'output',
                stored_bytes: 300_000,
                reason: 'value_exceeds_inline_limit',
              },
              {
                field: 'evaluation_trace',
                stored_bytes: 70_000,
                reason: 'value_truncated_at_write_limit',
              },
            ],
          }),
        ),
      ),
    });

    await renderPanel({entry: emptyStepEntry()});
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    const unavailable = await screen.findByRole('region', {name: 'Unavailable diagnostics'});
    expect(unavailable).toHaveTextContent('Resolved configuration is unavailable in this view');
    expect(unavailable).toHaveTextContent(
      'The complete value exceeds the display limit and is not shown here.',
    );
    expect(unavailable).toHaveTextContent('Step output exceeds the display limit');
    expect(unavailable).toHaveTextContent(
      'The complete value is preserved for workflow execution but is not shown here.',
    );
    expect(unavailable).toHaveTextContent('Evaluation was not fully recorded');
    expect(unavailable).toHaveTextContent(
      'Shipfox preserved the workflow outcome and omitted the oversized detail.',
    );
    expect(unavailable).toHaveTextContent('300,000 bytes');
    expect(within(unavailable).getByText('300,000 bytes')).toHaveClass('font-code');
  });

  it('explains deterministic payload failures and opens bounded configuration detail', async () => {
    const user = userEvent.setup();
    const largeAuthoredValue = 'x'.repeat(75_644);
    configureApiClient({
      fetchImpl: vi.fn(async () =>
        jsonResponse(
          stepDetailResponse({
            authored_config: {prompt: largeAuthoredValue},
            config: {prompt: largeAuthoredValue},
          }),
        ),
      ),
    });

    await renderPanel({
      entry: stepEntry('execution_payload_too_large', undefined, {
        field: 'resolved_config',
        retryable: false,
        limit_bytes: 65_536,
        measured_bytes: 75_644,
        overshoot_bytes: 10_108,
      }),
    });
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    expect(
      await screen.findByText('Resolved configuration exceeds the execution limit'),
    ).toBeInTheDocument();
    expect(screen.getByText('Affected value')).toBeInTheDocument();
    expect(screen.getByText(`${(75_644).toLocaleString()} bytes`)).toBeInTheDocument();
    expect(screen.getByText(`${(65_536).toLocaleString()} bytes`)).toBeInTheDocument();
    expect(screen.getByText('Over by')).toBeInTheDocument();
    expect(screen.getByText(`${(10_108).toLocaleString()} bytes`)).toBeInTheDocument();
    expect(screen.getByText(REDUCE_AUTHORED_VALUE_DESCRIPTION)).toBeInTheDocument();
    expect(screen.queryByText('Agent dispatch failed')).toBeNull();

    const inputs = await screen.findByRole('region', {name: 'Inputs'});
    expect(within(inputs).getByRole('tab', {name: 'Authored configuration'})).toBeInTheDocument();
    expect(within(inputs).getByRole('tab', {name: 'Resolved configuration'})).toBeInTheDocument();
    await user.click(screen.getByRole('button', {name: 'View configuration'}));
    expect(inputs).toHaveFocus();
  });

  it('uses the step status reason for mixed-version configuration failures', async () => {
    const user = userEvent.setup();
    configureApiClient({
      fetchImpl: vi.fn(async () =>
        jsonResponse(stepDetailResponse({authored_config: {run: 'pnpm test'}, config: null})),
      ),
    });

    const entry = stepEntry(
      'execution_payload_too_large',
      undefined,
      {field: 'authored_config'},
      true,
    );
    entry.step.statusReason = 'execution_payload_too_large';
    await renderPanel({entry});
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    const inputs = await screen.findByRole('region', {name: 'Inputs'});
    await user.click(screen.getByRole('button', {name: 'View configuration'}));
    expect(inputs).toHaveFocus();
  });

  it('opens resolved tool configuration when authored configuration is unavailable', async () => {
    const user = userEvent.setup();
    configureApiClient({
      fetchImpl: vi.fn(async () =>
        jsonResponse(
          stepDetailResponse({
            authored_config: null,
            config: {tool: {provider: 'slack', with: {channel: '#releases'}}},
          }),
        ),
      ),
    });

    await renderPanel({
      entry: toolStepEntry({
        status: 'failed',
        reason: 'execution_payload_too_large',
        field: 'resolved_config',
      }),
    });
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    const configuration = await screen.findByRole('region', {name: 'Configuration'});
    expect(within(configuration).queryByRole('tab', {name: 'Authored configuration'})).toBeNull();
    expect(
      within(configuration).getByRole('tab', {name: 'Resolved configuration'}),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', {name: 'View configuration'}));
    expect(configuration).toHaveFocus();
  });

  it('does not link unrelated payload failures to configuration', async () => {
    const user = userEvent.setup();
    configureApiClient({
      fetchImpl: vi.fn(async () =>
        jsonResponse(
          stepDetailResponse({
            authored_config: {run: 'pnpm test'},
            config: {run: 'pnpm test --filter=client'},
          }),
        ),
      ),
    });

    await renderPanel({
      entry: stepEntry('step_result_too_large', undefined, {field: 'output'}),
    });
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    await screen.findByRole('region', {name: 'Inputs'});
    expect(screen.queryByRole('button', {name: 'View configuration'})).toBeNull();
  });

  it('explains a user-controlled oversized step response', async () => {
    const user = userEvent.setup();
    configureApiClient({fetchImpl: vi.fn(() => new Promise<Response>(() => undefined))});

    await renderPanel({
      entry: stepEntry('step_result_too_large', undefined, {field: 'response'}),
    });
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    expect(await screen.findByText('Response exceeds the step result limit')).toBeInTheDocument();
    expect(screen.getByText(REDUCE_STEP_RESULT_DESCRIPTION)).toBeInTheDocument();
  });

  it('explains an oversized generated step detail without asking the user to reduce it', async () => {
    const user = userEvent.setup();
    configureApiClient({fetchImpl: vi.fn(() => new Promise<Response>(() => undefined))});

    await renderPanel({
      entry: stepEntry('step_result_too_large', undefined, {field: 'gate_result'}),
    });
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    expect(
      await screen.findByText('Gate result exceeds the step result limit'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Shipfox recorded the step outcome, but this generated detail exceeded its retention limit. Review the bounded details available below.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(REDUCE_STEP_RESULT_DESCRIPTION)).toBeNull();
  });

  it('explains an oversized listener batch without suggesting a failed-job rerun', async () => {
    const user = userEvent.setup();
    configureApiClient({fetchImpl: vi.fn(() => new Promise<Response>(() => undefined))});

    await renderPanel({
      entry: stepEntry('execution_payload_too_large', undefined, {field: 'listener_batch'}),
    });
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    expect(
      await screen.findByText('Trigger events exceed the execution limit'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Adjust the listener batch or source event before starting a new run. Re-running failed jobs preserves the same trigger events.',
      ),
    ).toBeInTheDocument();
  });

  it('falls back to the server message when structured payload details are absent', async () => {
    const user = userEvent.setup();
    configureApiClient({fetchImpl: vi.fn(() => new Promise<Response>(() => undefined))});

    await renderPanel({entry: stepEntry('execution_payload_too_large')});
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    expect(await screen.findByText('Agent dispatch failed')).toBeInTheDocument();
  });

  it('does not ask users to reduce an internal diagnostic', async () => {
    const user = userEvent.setup();
    configureApiClient({
      fetchImpl: vi.fn(() => new Promise<Response>(() => undefined)),
    });

    await renderPanel({entry: stepEntry('diagnostic_too_large')});
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    expect(await screen.findByText('Step details could not be recorded')).toBeInTheDocument();
    expect(
      screen.getByText(
        'The workflow outcome was preserved, but this server could not retain all troubleshooting details. Review the bounded details available below.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(REDUCE_AUTHORED_VALUE_DESCRIPTION)).toBeNull();
    expect(screen.queryByText(REDUCE_STEP_RESULT_DESCRIPTION)).toBeNull();
  });

  it('shows the session descriptor without transcript data', async () => {
    const user = userEvent.setup();
    configureApiClient({
      fetchImpl: vi.fn(async () =>
        jsonResponse(
          stepDetailResponse({
            step_id: STEP_ID,
            attempt: 1,
            authored_config: {run: 'pnpm test'},
            config: {run: 'pnpm test --filter=client'},
            session: {
              id: '99999999-9999-4999-8999-999999999999',
              key: 'main',
              mode: 'resume',
              segment: 2,
            },
            evaluation_trace: null,
          }),
        ),
      ),
    });

    await renderPanel();
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    expect(await screen.findByText('Session main · resume · segment 2 loaded')).toBeInTheDocument();
  });

  it('hides an absent session descriptor while preserving the inspector', async () => {
    const user = userEvent.setup();
    configureApiClient({
      fetchImpl: vi.fn(async () =>
        jsonResponse(
          stepDetailResponse({
            step_id: STEP_ID,
            attempt: 1,
            authored_config: {run: 'pnpm test'},
            config: {run: 'pnpm test --filter=client'},
            session: null,
            evaluation_trace: null,
          }),
        ),
      ),
    });

    await renderPanel();
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    expect(await screen.findByRole('region', {name: 'Inputs'})).toBeInTheDocument();
  });

  it('shows an actionable error and retries the detail request', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({code: 'server-error'}, {status: 500}))
      .mockResolvedValueOnce(
        jsonResponse(
          stepDetailResponse({
            step_id: STEP_ID,
            attempt: 1,
            authored_config: {run: 'pnpm test'},
            config: {run: 'pnpm test --filter=client'},
            evaluation_trace: null,
          }),
        ),
      );
    configureApiClient({fetchImpl});

    await renderPanel();
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    expect(await screen.findByText('Details unavailable')).toBeInTheDocument();
    await user.click(screen.getByRole('button', {name: 'Retry'}));
    expect(await screen.findByRole('region', {name: 'Inputs'})).toBeInTheDocument();
    expect(screen.getByText('Resolved configuration')).toBeInTheDocument();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('keeps the last successful detail while a refresh fails', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          stepDetailResponse({
            authored_config: {run: 'pnpm test'},
            config: {run: 'pnpm test --filter=client'},
            evaluation_trace: null,
          }),
        ),
      )
      .mockResolvedValueOnce(jsonResponse({code: 'server-error'}, {status: 500}));
    configureApiClient({fetchImpl});

    const {queryClient} = await renderPanel();
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));
    expect(await screen.findByRole('region', {name: 'Inputs'})).toBeInTheDocument();

    await act(async () => {
      await queryClient.refetchQueries({
        queryKey: stepAttemptDetailQueryKeys.detail(STEP_ID, 1),
      });
    });

    expect(
      await screen.findByText('Could not refresh troubleshooting details.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('region', {name: 'Inputs'})).toBeInTheDocument();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('keeps the annotation link available when the detail request fails', async () => {
    const user = userEvent.setup();
    configureApiClient({
      fetchImpl: vi.fn(() => Promise.resolve(jsonResponse({code: 'server-error'}, {status: 500}))),
    });

    await renderPanel({annotationCount: 2});
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    expect(await screen.findByText('Details unavailable')).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'View 2 annotations'})).toBeInTheDocument();
  });

  it('does not replace an annotation link with an empty inspector state', async () => {
    const user = userEvent.setup();
    configureApiClient({
      fetchImpl: vi.fn(async () =>
        jsonResponse(
          stepDetailResponse({
            step_id: STEP_ID,
            attempt: 1,
            authored_config: null,
            config: null,
            evaluation_trace: null,
          }),
        ),
      ),
    });

    await renderPanel({annotationCount: 2, entry: emptyStepEntry()});
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    expect(await screen.findByRole('link', {name: 'View 2 annotations'})).toBeInTheDocument();
    expect(screen.queryByText('No additional troubleshooting details were recorded.')).toBeNull();
  });

  it('does not show current step configuration or evaluation for a historical attempt', async () => {
    const user = userEvent.setup();
    configureApiClient({
      fetchImpl: vi.fn(async () =>
        jsonResponse(
          stepDetailResponse({
            step_id: STEP_ID,
            attempt: 1,
            authored_config: null,
            config: null,
            evaluation_trace: null,
          }),
        ),
      ),
    });

    await renderPanel();
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));
    expect(await screen.findByRole('region', {name: 'Outputs'})).toBeInTheDocument();

    expect(screen.queryByText('Authored configuration')).toBeNull();
    expect(screen.queryByText('Resolved configuration')).toBeNull();
    expect(screen.queryByText('Evaluation')).toBeNull();
  });

  it('shows resolved arguments, results, invocations, outputs, and write sensitivity', async () => {
    const user = userEvent.setup();
    configureToolDetailResponse();

    await renderPanel({entry: toolStepEntry({status: 'succeeded'})});
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    expect(await screen.findByText('Write tool')).toBeInTheDocument();
    expect(screen.getByRole('region', {name: 'Arguments'})).toHaveTextContent('#releases');
    expect(screen.getByRole('region', {name: 'Result'})).toHaveTextContent('1717171717.000100');
    expect(screen.getByRole('region', {name: 'Invocations'})).toHaveTextContent('Succeeded');
    expect(screen.getByRole('region', {name: 'Invocations'})).toHaveTextContent('412ms');
    expect(screen.getByRole('region', {name: 'Outputs'})).toHaveTextContent('message_id');
  });

  it('explains provider access failures and links to recovery and logs', async () => {
    const user = userEvent.setup();
    const onViewLogs = vi.fn();
    configureToolDetailResponse();

    await renderPanel({
      entry: toolStepEntry({status: 'failed', reason: 'tool_error', code: 'access-denied'}),
      onViewLogs,
    });
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    expect(await screen.findByText('Tool access was denied')).toBeInTheDocument();
    expect(
      screen.getByText(
        'The integration rejected this call. Review its permissions before re-running the step.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Slack rejected the token.')).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'Review integration access'})).toHaveAttribute(
      'href',
      '/w/acme/settings/integrations',
    );
    const invocations = screen.getByRole('region', {name: 'Invocations'});
    expect(invocations).toHaveTextContent('Failed');
    const errorCode = within(invocations).getByText('access-denied');
    expect(errorCode).toHaveAttribute('tabindex', '0');
    await user.hover(errorCode);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('access-denied');
    expect(screen.queryByRole('region', {name: 'Result'})).toBeNull();

    await user.click(screen.getByRole('button', {name: 'View invocation log'}));
    expect(onViewLogs).toHaveBeenCalledOnce();
  });

  it('explains unavailable credentials and links to reconnection', async () => {
    const user = userEvent.setup();
    configureToolDetailResponse();

    await renderPanel({
      entry: toolStepEntry({
        status: 'failed',
        reason: 'tool_error',
        code: 'credentials-unavailable',
      }),
    });
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    expect(await screen.findByText('Tool credentials are unavailable')).toBeInTheDocument();
    expect(
      screen.getByText(
        'The integration credentials are missing or unavailable. Reconnect the integration before re-running the step.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'Reconnect integration'})).toHaveAttribute(
      'href',
      '/w/acme/settings/integrations',
    );
  });

  it('shows a countdown for a scheduled retry', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2999-09-01T09:00:01.000Z'));
    const user = userEvent.setup();
    configureToolDetailResponse();

    await renderPanel({entry: toolStepEntry({status: 'running'})});
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    expect(await screen.findByRole('region', {name: 'Invocations'})).toHaveTextContent('Failed');
    expect(screen.getByRole('region', {name: 'Invocations'})).toHaveTextContent('Retry pending');
    expect(screen.getByText('Retry in 5s')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each([
    {nextDueAt: '2999-09-01T09:00:00.000Z', label: 'Retry in now'},
    {nextDueAt: 'not-a-date', label: 'Retry in pending'},
  ])('shows $label for a running retry', async ({nextDueAt, label}) => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2999-09-01T09:00:01.000Z'));
    const user = userEvent.setup();
    configureToolDetailResponse();

    await renderPanel({entry: toolStepEntry({status: 'running', nextDueAt})});
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    expect(await screen.findByText(label)).toBeInTheDocument();
  });

  it('marks a queued retry as not retried after the attempt terminates', async () => {
    const user = userEvent.setup();
    configureToolDetailResponse();

    await renderPanel({
      entry: toolStepEntry({status: 'failed', reason: 'invocation_interrupted'}),
    });
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    expect(await screen.findByText('Not retried')).toBeInTheDocument();
  });

  it.each([
    {
      sensitivity: 'write',
      description:
        'The provider call was interrupted. Confirm whether the write completed before re-running it.',
    },
    {
      sensitivity: 'read',
      description:
        'The provider call was interrupted before its outcome could be recorded. Review the invocation log before retrying.',
    },
  ] as const)('explains an interrupted $sensitivity tool invocation', async ({
    sensitivity,
    description,
  }) => {
    const user = userEvent.setup();
    configureToolDetailResponse();

    await renderPanel({
      entry: toolStepEntry({
        status: 'failed',
        reason: 'invocation_interrupted',
        sensitivity,
      }),
    });
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    expect(await screen.findByText(description)).toBeInTheDocument();
  });

  it('distinguishes a successful provider call from an invalid step output', async () => {
    const user = userEvent.setup();
    configureToolDetailResponse();

    await renderPanel({
      entry: toolStepEntry({status: 'failed', reason: 'output_invalid', code: 'output-too-large'}),
    });
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    expect(await screen.findByText('Tool call succeeded, but the step failed')).toBeInTheDocument();
    expect(screen.getByText(INVOCATION_LOG_DESCRIPTION)).toBeInTheDocument();
    expect(screen.queryByRole('region', {name: 'Result'})).toBeNull();
  });

  it('points an invalid resolved tool field back to source', async () => {
    const user = userEvent.setup();
    configureToolDetailResponse();

    await renderPanel({
      entry: toolStepEntry({
        status: 'failed',
        reason: 'tool_config_invalid',
        code: 'invalid-argument',
        field: 'tool.with.channel',
      }),
    });
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    expect(await screen.findByText('Tool configuration is invalid')).toBeInTheDocument();
    expect(
      screen.getByText(
        'The resolved tool.with.channel value is invalid. Fix the step configuration before re-running.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'View in source'})).toBeInTheDocument();
  });

  it('keeps non-tool failure chips keyed to their stable reason', async () => {
    const user = userEvent.setup();
    configureApiClient({fetchImpl: vi.fn(() => new Promise<Response>(() => undefined))});

    await renderPanel({
      entry: stepEntry('agent_invocation_failed', 'workspace-providers-disabled'),
    });
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    expect(await screen.findByText('agent_invocation_failed')).toBeInTheDocument();
  });
});

async function renderPanel({
  annotationCount,
  entry,
  onViewLogs,
}: {
  annotationCount?: number;
  entry?: StepListEntryModel;
  onViewLogs?: (() => void) | undefined;
} = {}) {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  const rootRoute = createRootRoute({component: Outlet});
  const panelRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId',
    component: () => (
      <QueryClientProvider client={queryClient}>
        <PanelHarness annotationCount={annotationCount} entry={entry} onViewLogs={onViewLogs} />
      </QueryClientProvider>
    ),
  });
  const router = createRouter({
    history: createMemoryHistory({initialEntries: ['/w/acme/p/platform/runs/run-1']}),
    routeTree: rootRoute.addChildren([panelRoute]),
  });
  await router.load();
  let result: ReturnType<typeof render> | undefined;
  await act(() => {
    result = render(<RouterProvider router={router} />);
  });
  if (!result) throw new Error('Step inspector did not render.');
  return {result, queryClient};
}

function PanelHarness({
  annotationCount,
  entry: providedEntry,
  onViewLogs,
}: {
  annotationCount?: number | undefined;
  entry?: StepListEntryModel | undefined;
  onViewLogs?: (() => void) | undefined;
}) {
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const entry = providedEntry ?? stepEntry();
  return (
    <>
      <button type="button" onClick={() => setInspectorOpen(true)}>
        Open inspector
      </button>
      <StepInspectorSheet
        entry={entry}
        open={inspectorOpen}
        onOpenChange={setInspectorOpen}
        workspaceSlug="acme"
        projectSlug="platform"
        workflowRunId="11111111-1111-4111-8111-111111111111"
        runAttempt={1}
        jobId="44444444-4444-4444-8444-444444444444"
        annotationCount={annotationCount}
        onViewLogs={onViewLogs}
      />
    </>
  );
}

function stepEntry(
  reason: StepErrorReason = 'agent_invocation_failed',
  code?: string,
  errorOverrides: Partial<NonNullable<WorkflowRunStepDetailDto['error']>> = {},
  omitErrorReason = false,
): StepListEntryModel {
  const jobId = '44444444-4444-4444-8444-444444444444';
  const job = workflowJob({
    id: jobId,
    name: 'verification',
    key: 'verification',
    status: 'failed',
    job_executions: [
      workflowJobExecutionDto({
        id: EXECUTION_ID,
        job_id: jobId,
        status: 'failed',
        steps: [
          workflowStepDto({
            id: STEP_ID,
            job_execution_id: EXECUTION_ID,
            name: 'Run verification',
            status: 'failed',
            type: 'agent',
            config: {run: 'pnpm test'},
            error: {
              message: 'Agent dispatch failed',
              ...(omitErrorReason ? {} : {reason}),
              ...(code ? {code} : {}),
              ...errorOverrides,
            },
            evaluation_trace: [
              {
                expression: 'inputs.message',
                roots: ['inputs.message'],
                fill_target: 'run',
                evaluated_at: '2026-08-05T12:00:00.000Z',
                field: 'run',
                value: 'current attempt value',
              },
            ],
            attempts: [
              workflowStepAttemptDto({
                id: ATTEMPT_ID,
                step_id: STEP_ID,
                status: 'failed',
                output: {result: 'failed'},
                finished_at: '2026-08-05T12:01:00.000Z',
              }),
            ],
          }),
        ],
      }),
    ],
  });
  const execution = job.jobExecutions[0];
  if (!execution) throw new Error('Test fixture is missing an execution.');
  const entry = buildStepListModel({job, jobExecution: execution}).entries[0];
  if (!entry) throw new Error('Test fixture is missing a step attempt.');

  return entry;
}

function emptyStepEntry(): StepListEntryModel {
  const jobId = '44444444-4444-4444-8444-444444444444';
  const job = workflowJob({
    id: jobId,
    name: 'verification',
    key: 'verification',
    status: 'succeeded',
    job_executions: [
      workflowJobExecutionDto({
        id: EXECUTION_ID,
        job_id: jobId,
        status: 'succeeded',
        steps: [
          workflowStepDto({
            id: STEP_ID,
            job_execution_id: EXECUTION_ID,
            name: 'Run verification',
            status: 'succeeded',
            config: {},
            attempts: [
              workflowStepAttemptDto({
                id: ATTEMPT_ID,
                step_id: STEP_ID,
                status: 'succeeded',
                output: null,
                outputs: null,
                response: null,
                error: null,
                exit_code: 0,
                finished_at: '2026-08-05T12:01:00.000Z',
              }),
            ],
          }),
        ],
      }),
    ],
  });
  const execution = job.jobExecutions[0];
  if (!execution) throw new Error('Test fixture is missing an execution.');
  const entry = buildStepListModel({job, jobExecution: execution}).entries[0];
  if (!entry) throw new Error('Test fixture is missing a step attempt.');

  return entry;
}

function toolStepEntry({
  status,
  reason,
  code,
  field,
  sensitivity = 'write',
  nextDueAt = '2999-09-01T09:00:06.000Z',
}: {
  status: 'succeeded' | 'failed' | 'running';
  reason?: StepErrorReason | undefined;
  code?: string | undefined;
  field?: string | undefined;
  sensitivity?: 'read' | 'write' | undefined;
  nextDueAt?: string | undefined;
}): StepListEntryModel {
  const jobId = '44444444-4444-4444-8444-444444444444';
  const error = toolTestError(reason, code, field);
  const invocations = toolTestInvocations(status, reason, code, nextDueAt);
  const succeeded = status === 'succeeded';
  const running = status === 'running';
  const output = succeeded ? {result: {ts: '1717171717.000100'}} : null;
  const outputs = succeeded ? {message_id: '1717171717.000100'} : null;
  const finishedAt = running ? null : '2026-09-01T09:00:00.412Z';
  const job = workflowJob({
    id: jobId,
    name: 'release',
    key: 'release',
    status,
    job_executions: [
      workflowJobExecutionDto({
        id: EXECUTION_ID,
        job_id: jobId,
        status,
        steps: [
          workflowStepDto({
            id: STEP_ID,
            job_execution_id: EXECUTION_ID,
            name: 'Post release notice',
            key: 'notify-release',
            status,
            source_location: {start_line: 20, end_line: 29},
            type: 'tool',
            config: {
              tool: {
                provider: 'slack',
                connection_slug: 'release-notifications',
                id: 'chat_post_message',
                method: 'post',
                sensitivity,
              },
            },
            error,
            attempts: [
              workflowStepAttemptDto({
                id: ATTEMPT_ID,
                step_id: STEP_ID,
                status,
                output,
                outputs,
                error,
                invocations,
                finished_at: finishedAt,
              }),
            ],
          }),
        ],
      }),
    ],
  });
  const execution = job.jobExecutions[0];
  if (!execution) throw new Error('Test fixture is missing an execution.');
  const entry = buildStepListModel({job, jobExecution: execution}).entries[0];
  if (!entry) throw new Error('Test fixture is missing a step attempt.');
  return entry;
}

function toolTestInvocations(
  status: 'succeeded' | 'failed' | 'running',
  reason: StepErrorReason | undefined,
  code: string | undefined,
  nextDueAt: string,
): StepAttemptDto['invocations'] {
  if (status === 'running') {
    return [
      {
        call_index: 0,
        started_at: '2026-09-01T09:00:00.000Z',
        finished_at: '2026-09-01T09:00:00.412Z',
        outcome: 'error',
        error_code: 'rate-limited',
        duration_ms: 412,
      },
      {
        call_index: 1,
        started_at: '2026-09-01T09:00:01.000Z',
        next_due_at: nextDueAt,
      },
    ];
  }
  if (reason === 'tool_error') {
    return [
      {
        call_index: 0,
        started_at: '2026-09-01T09:00:00.000Z',
        finished_at: '2026-09-01T09:00:00.412Z',
        outcome: 'error',
        ...(code ? {error_code: code} : {}),
        duration_ms: 412,
      },
    ];
  }
  if (reason === 'invocation_interrupted') {
    return [
      {
        call_index: 0,
        started_at: '2026-09-01T09:00:01.000Z',
        next_due_at: nextDueAt,
      },
    ];
  }
  if (status === 'succeeded' || reason === 'output_invalid') {
    return [
      {
        call_index: 0,
        started_at: '2026-09-01T09:00:00.000Z',
        finished_at: '2026-09-01T09:00:00.412Z',
        outcome: 'success',
        duration_ms: 412,
      },
    ];
  }
  return [];
}

function toolTestError(
  reason: StepErrorReason | undefined,
  code: string | undefined,
  field: string | undefined,
): WorkflowRunStepDetailDto['error'] {
  if (!reason) return null;
  const message =
    code === 'access-denied' ? 'Slack rejected the token.' : 'Tool output was invalid.';
  return {
    message,
    reason,
    ...(code ? {code} : {}),
    ...(field ? {field, source: 'resolved'} : {}),
  };
}

function stepDetailResponse(
  overrides: Partial<StepAttemptDetailResponseDto> = {},
): StepAttemptDetailResponseDto {
  return {
    workflow_run_id: '11111111-1111-4111-8111-111111111111',
    workflow_run_attempt: 1,
    job_id: '44444444-4444-4444-8444-444444444444',
    job_execution_id: EXECUTION_ID,
    step_id: STEP_ID,
    step_attempt_id: ATTEMPT_ID,
    attempt: 1,
    authored_config: null,
    config: null,
    session: null,
    evaluation_trace: null,
    oversized_fields: [],
    ...overrides,
  };
}

function configureToolDetailResponse() {
  configureApiClient({
    fetchImpl: vi.fn(async () =>
      jsonResponse(
        stepDetailResponse({
          step_id: STEP_ID,
          attempt: 1,
          authored_config: {
            tool: {
              provider: 'slack',
              connection: 'release-notifications',
              id: 'chat_post_message',
              with: {channel: `\${{ inputs.channel }}`},
            },
          },
          config: {
            tool: {
              provider: 'slack',
              connection_slug: 'release-notifications',
              id: 'chat_post_message',
              with: {channel: '#releases', text: 'Version 2.4.0 is live.'},
            },
          },
          evaluation_trace: null,
        }),
      ),
    ),
  });
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {'content-type': 'application/json'},
    ...init,
  });
}
