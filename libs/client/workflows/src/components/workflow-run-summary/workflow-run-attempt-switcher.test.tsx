import {configureApiClient} from '@shipfox/client-api';
import {screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {toWorkflowRunAttempt} from '#hooks/api/workflow-run-mapper.js';
import {workflowRunsQueryKeys} from '#hooks/api/workflow-runs.js';
import {
  runAttemptsResponseDto,
  workflowRunAttemptDto,
  workflowRunDetail,
} from '#test/fixtures/workflow-run.js';
import {jsonResponse, PROJECT_TEST_WSLUG, renderProjectPage} from '#test/pages.js';
import {WorkflowRunAttemptSwitcher} from './workflow-run-attempt-switcher.js';

const ROOT_RUN_ID = '11111111-1111-4111-8111-111111111111';
const CURRENT_RUN_ID = '22222222-2222-4222-8222-222222222222';
const THIRD_RUN_ID = '33333333-3333-4333-8333-333333333333';
const SWITCH_ATTEMPT_PATTERN = /Switch attempt/;
const ATTEMPT_1_PATTERN = /Attempt 1/;
const ATTEMPT_2_PATTERN = /Attempt 2/;
const ATTEMPT_3_PATTERN = /Attempt 3/;

describe('WorkflowRunAttemptSwitcher', () => {
  test('hides itself for a single-attempt run', async () => {
    renderSwitcher({latestAttempt: 1});

    await screen.findByTestId('attempt-switcher-test-mount');
    expect(screen.queryByRole('button', {name: SWITCH_ATTEMPT_PATTERN})).not.toBeInTheDocument();
  });

  test('shows a loading row while attempts are loading', async () => {
    const user = userEvent.setup();
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn(() => new Promise<Response>(() => undefined)),
    });
    renderSwitcher();

    await user.click(await screen.findByRole('button', {name: 'Switch attempt, currently 2 of 4'}));

    expect(await screen.findByText('Loading attempts...')).toBeInTheDocument();
  });

  test('shows an error row when attempts fail to load', async () => {
    const user = userEvent.setup();
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn(() => Promise.resolve(jsonResponse({code: 'server-error'}, {status: 500}))),
    });
    renderSwitcher();

    await user.click(await screen.findByRole('button', {name: 'Switch attempt, currently 2 of 4'}));

    expect(
      await screen.findByRole('menuitem', {name: 'Could not load attempts. Retry'}),
    ).toBeInTheDocument();
  });

  test('lists attempts newest first, updates the max attempt, and marks the current row', async () => {
    const user = userEvent.setup();
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn(() =>
        Promise.resolve(
          jsonResponse(
            runAttemptsResponseDto({
              attempts: [
                workflowRunAttemptDto({
                  id: ROOT_RUN_ID,
                  attempt: 1,
                  status: 'succeeded',
                  created_at: '2026-05-07T01:00:00.000Z',
                }),
                workflowRunAttemptDto({
                  id: CURRENT_RUN_ID,
                  attempt: 2,
                  status: 'failed',
                  created_at: '2026-05-07T01:02:00.000Z',
                  rerun_mode: 'all',
                }),
                workflowRunAttemptDto({
                  id: THIRD_RUN_ID,
                  attempt: 3,
                  status: 'running',
                  created_at: '2026-05-07T01:03:00.000Z',
                  rerun_mode: 'failed',
                }),
              ],
            }),
          ),
        ),
      ),
    });
    renderSwitcher({latestAttempt: 2});

    await user.click(await screen.findByRole('button', {name: 'Switch attempt, currently 2 of 2'}));

    await waitFor(() => expect(screen.getByText('Attempt 2 of 3')).toBeInTheDocument());
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(ATTEMPT_3_PATTERN),
        expect.stringMatching(ATTEMPT_2_PATTERN),
        expect.stringMatching(ATTEMPT_1_PATTERN),
      ]),
    );
    expect(items[0]).toHaveTextContent('Attempt 3');
    expect(items[1]).toHaveTextContent('Attempt 2');
    expect(items[2]).toHaveTextContent('Attempt 1');
    const current = screen.getByRole('menuitem', {name: ATTEMPT_2_PATTERN});
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(current).not.toHaveClass('bg-background-highlight-base');
    expect(within(current).getByRole('img', {name: 'Failed'})).toBeInTheDocument();
  });

  test('keeps the max attempt from dropping when cached attempts are stale', async () => {
    const user = userEvent.setup();
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn(() =>
        Promise.resolve(
          jsonResponse(
            runAttemptsResponseDto({
              attempts: [
                workflowRunAttemptDto({id: ROOT_RUN_ID, attempt: 1}),
                workflowRunAttemptDto({id: CURRENT_RUN_ID, attempt: 2}),
              ],
            }),
          ),
        ),
      ),
    });
    renderSwitcher({latestAttempt: 3});

    await user.click(await screen.findByRole('button', {name: 'Switch attempt, currently 2 of 3'}));

    await waitFor(() => expect(screen.getByText('Attempt 2 of 3')).toBeInTheDocument());
  });

  test('shows stale cached attempts with a loading row while fetching a known newer attempt', async () => {
    const user = userEvent.setup();
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn(() => new Promise<Response>(() => undefined)),
    });
    const {queryClient} = renderSwitcher({latestAttempt: 3});
    queryClient.setQueryData(
      workflowRunsQueryKeys.attempts(CURRENT_RUN_ID),
      [
        workflowRunAttemptDto({id: ROOT_RUN_ID, attempt: 1}),
        workflowRunAttemptDto({id: CURRENT_RUN_ID, attempt: 2}),
      ].map(toWorkflowRunAttempt),
    );

    await user.click(await screen.findByRole('button', {name: 'Switch attempt, currently 2 of 3'}));

    expect(await screen.findByRole('menuitem', {name: ATTEMPT_2_PATTERN})).toBeInTheDocument();
    expect(screen.getByRole('menuitem', {name: 'Loading attempts...'})).toBeInTheDocument();
  });

  test('links to an attempt and clears selected step search on navigation', async () => {
    const user = userEvent.setup();
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn(() =>
        Promise.resolve(
          jsonResponse(
            runAttemptsResponseDto({
              attempts: [
                workflowRunAttemptDto({id: ROOT_RUN_ID, attempt: 1}),
                workflowRunAttemptDto({id: CURRENT_RUN_ID, attempt: 2}),
              ],
            }),
          ),
        ),
      ),
    });
    const {router} = renderSwitcher({
      path: `/w/${PROJECT_TEST_WSLUG}/p/project/runs/${CURRENT_RUN_ID}?job=job-1&step=step-1&stepAttempt=attempt-1`,
    });

    await user.click(await screen.findByRole('button', {name: 'Switch attempt, currently 2 of 4'}));
    const attemptLink = await screen.findByRole('menuitem', {name: ATTEMPT_1_PATTERN});

    expect(attemptLink).toHaveAttribute(
      'href',
      `/w/${PROJECT_TEST_WSLUG}/p/project/runs/${CURRENT_RUN_ID}?runAttempt=1`,
    );

    await user.click(attemptLink);

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/w/${PROJECT_TEST_WSLUG}/p/project/runs/${CURRENT_RUN_ID}`,
      ),
    );
    expect(router.state.location.search).toEqual({runAttempt: 1});
  });
});

function renderSwitcher({
  latestAttempt = 4,
  path = `/w/${PROJECT_TEST_WSLUG}/p/project/runs/${CURRENT_RUN_ID}`,
}: {
  latestAttempt?: number | undefined;
  path?: string | undefined;
} = {}) {
  const run = workflowRunDetail({
    id: CURRENT_RUN_ID,
    current_attempt: 2,
    latest_attempt: latestAttempt,
    run_attempt: workflowRunAttemptDto({
      id: CURRENT_RUN_ID,
      workflow_run_id: CURRENT_RUN_ID,
      attempt: 2,
    }),
  });

  return renderProjectPage(path, () => (
    <div data-testid="attempt-switcher-test-mount">
      <WorkflowRunAttemptSwitcher
        workspaceSlug={PROJECT_TEST_WSLUG}
        projectSlug="project"
        run={run}
        latestAttempt={latestAttempt}
      />
    </div>
  ));
}
