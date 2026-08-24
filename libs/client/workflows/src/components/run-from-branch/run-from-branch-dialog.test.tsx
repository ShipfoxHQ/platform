import {configureApiClient} from '@shipfox/client-api';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {RunFromBranchDialog} from './run-from-branch-dialog.js';

const PROJECT_ID = '44444444-4444-4444-8444-444444444444';
const COMMIT = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';
const RUN_ID = '66666666-6666-4666-8666-666666666666';

const REF_INPUT_LABEL = 'Branch or tag';
const BROKEN_FILE_NAME = /Broken/;
const TRIAGE_FILE_NAME = /Triage Sentry/;
const ON_ISSUE_TRIGGER_NAME = /on_issue/;
const NIGHTLY_TRIGGER_NAME = /nightly/;
const SENTRY_TRIGGER_NAME = /sentry_issue/;
const CONFIRM_AGAIN_TEXT = /confirm the new commit and try again/i;

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {'content-type': 'application/json'},
    ...init,
  });
}

function atRefListingDto(overrides: {files?: unknown[]; ref?: string; commit?: string} = {}) {
  return {
    ref: overrides.ref ?? 'fix-triage-prompt',
    commit: overrides.commit ?? COMMIT,
    files: overrides.files ?? [
      {
        config_path: '.shipfox/workflows/triage-sentry.yml',
        name: 'Triage Sentry',
        valid: true,
        errors: [],
        warnings: [
          {
            code: 're-evaluating-command',
            message: 'Workflow data is re-executed as shell code.',
            path: 'jobs.build.steps.0.run',
          },
        ],
        triggers: {
          on_issue: {
            source: 'manual',
            event: 'fire',
            with: {environment: 'staging', region: 'us-east-1'},
          },
          nightly: {source: 'cron', event: 'tick'},
          sentry_issue: {source: 'github_acme', event: 'issue.created'},
        },
      },
      {
        config_path: '.shipfox/workflows/broken.yml',
        name: 'Broken',
        valid: false,
        errors: [{message: 'Unknown job reference: deploy', path: 'jobs.build'}],
        warnings: [],
        triggers: {on_demand: {source: 'manual', event: 'fire'}},
      },
    ],
  };
}

function createFetch({
  listing = jsonResponse(atRefListingDto()),
  devRun = jsonResponse({workflow_run_id: RUN_ID, commit: COMMIT}, {status: 201}),
}: {
  listing?: Response;
  devRun?: Response;
} = {}) {
  const devRunResponses: Response[] = [devRun];
  const devRunBodies: Array<Record<string, unknown>> = [];
  let atRefCalls = 0;

  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request ? request.url : String(input));
    const method = init?.method ?? request?.method ?? 'GET';

    if (url.pathname === '/definitions/at-ref') {
      atRefCalls += 1;
      return listing.clone();
    }
    if (url.pathname === '/dev-runs' && method === 'POST') {
      const bodyText = request ? await request.text() : String(init?.body ?? '');
      devRunBodies.push(JSON.parse(bodyText) as Record<string, unknown>);
      const next = devRunResponses.shift();
      return (next ?? devRun).clone();
    }
    return jsonResponse({code: 'not-found'}, {status: 404});
  });

  return {
    fetchImpl,
    getAtRefCalls: () => atRefCalls,
    getDevRunBodies: () => devRunBodies,
    /** Queue a response for the next `POST /dev-runs` call. */
    queueDevRun(response: Response) {
      devRunResponses.unshift(response);
    },
  };
}

function renderDialog(
  fetchImpl: typeof fetch,
  {
    onRunCreated = vi.fn(),
    onOpenChange = vi.fn(),
  }: {onRunCreated?: (workflowRunId: string) => void; onOpenChange?: (open: boolean) => void} = {},
) {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

  const result = render(
    <QueryClientProvider client={queryClient}>
      <RunFromBranchDialog
        projectId={PROJECT_ID}
        open
        onOpenChange={onOpenChange}
        onRunCreated={onRunCreated}
      />
    </QueryClientProvider>,
  );

  return {queryClient, onRunCreated, onOpenChange, ...result};
}

function resolveRefToFileStep() {
  const input = screen.getByLabelText(REF_INPUT_LABEL);
  fireEvent.change(input, {target: {value: 'fix-triage-prompt'}});
  fireEvent.blur(input);
  return input;
}

function selectFile(name: string) {
  fireEvent.click(screen.getByRole('radio', {name: new RegExp(name)}));
}

function selectTrigger(key: string) {
  fireEvent.click(screen.getByRole('radio', {name: new RegExp(key)}));
}

describe('RunFromBranchDialog', () => {
  test('resolves the ref on blur and shows the pinned commit', async () => {
    renderDialog(createFetch().fetchImpl);

    expect(screen.getByRole('dialog', {name: 'Run from branch'})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Next'})).toBeDisabled();

    resolveRefToFileStep();

    await waitFor(() => expect(screen.getByText('Resolved')).toBeInTheDocument());
    expect(screen.getByText('a1b2c3d')).toBeInTheDocument();
    expect(screen.getByText('2 files')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Next'})).toBeEnabled();
  });

  test('shows ref-invalid inline on the ref input', async () => {
    const {fetchImpl} = createFetch({
      listing: jsonResponse({code: 'ref-invalid'}, {status: 400}),
    });
    renderDialog(fetchImpl);

    resolveRefToFileStep();

    const input = await screen.findByLabelText(REF_INPUT_LABEL);
    await waitFor(() =>
      expect(input).toHaveAccessibleDescription('Enter a branch or tag name in this repository.'),
    );
    expect(input).toHaveAttribute('aria-invalid', 'true');
    // The inline code never renders a step-level alert.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Next'})).toBeDisabled();
  });

  test('shows ref-not-found inline on the ref input', async () => {
    const {fetchImpl} = createFetch({
      listing: jsonResponse({code: 'ref-not-found'}, {status: 404}),
    });
    renderDialog(fetchImpl);

    resolveRefToFileStep();

    const input = await screen.findByLabelText(REF_INPUT_LABEL);
    await waitFor(() =>
      expect(input).toHaveAccessibleDescription(
        'This branch or tag does not exist in the repository.',
      ),
    );
    expect(screen.getByRole('button', {name: 'Next'})).toBeDisabled();
  });

  test('shows an inline error when the ref blurs empty', () => {
    renderDialog(createFetch().fetchImpl);

    const input = screen.getByLabelText(REF_INPUT_LABEL);
    fireEvent.blur(input);

    expect(input).toHaveAccessibleDescription('Enter a branch or tag name to run from.');
    expect(screen.getByRole('button', {name: 'Next'})).toBeDisabled();
  });

  test('clears the resolution when the ref blurs empty after a resolve', async () => {
    renderDialog(createFetch().fetchImpl);

    resolveRefToFileStep();
    await screen.findByText('Resolved');

    const input = screen.getByLabelText(REF_INPUT_LABEL);
    fireEvent.change(input, {target: {value: ''}});
    fireEvent.blur(input);

    // The stale listing is gone: the ref step cannot proceed on the old ref.
    await waitFor(() => expect(screen.queryByText('Resolved')).not.toBeInTheDocument());
    expect(input).toHaveAccessibleDescription('Enter a branch or tag name to run from.');
    expect(screen.getByRole('button', {name: 'Next'})).toBeDisabled();
  });

  test('shows a step-level alert for non-inline listing errors', async () => {
    const {fetchImpl} = createFetch({
      listing: jsonResponse({code: 'source-unavailable'}, {status: 502}),
    });
    renderDialog(fetchImpl);

    resolveRefToFileStep();

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Source repository unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Next'})).toBeDisabled();
  });

  test('lists files with validation state: invalid files show errors and cannot be selected, warnings do not block', async () => {
    renderDialog(createFetch().fetchImpl);

    resolveRefToFileStep();
    await screen.findByText('Resolved');
    fireEvent.click(screen.getByRole('button', {name: 'Next'}));

    // Invalid file renders its errors inline and is not selectable.
    expect(await screen.findByText('Unknown job reference: deploy')).toBeInTheDocument();
    expect(screen.getByText('jobs.build')).toBeInTheDocument();
    const invalidRadio = screen.getByRole('radio', {name: BROKEN_FILE_NAME});
    expect(invalidRadio).toBeDisabled();
    // The valid file's warnings render but the file stays selectable.
    expect(screen.getByText('Workflow data is re-executed as shell code.')).toBeInTheDocument();
    const validRadio = screen.getByRole('radio', {name: TRIAGE_FILE_NAME});
    expect(validRadio).toBeEnabled();

    // Nothing selected yet: Next stays disabled.
    expect(screen.getByRole('button', {name: 'Next'})).toBeDisabled();
    selectFile('Triage Sentry');
    expect(screen.getByRole('button', {name: 'Next'})).toBeEnabled();
  });

  test('disables integration-sourced triggers with a later-release hint', async () => {
    renderDialog(createFetch().fetchImpl);

    resolveRefToFileStep();
    await screen.findByText('Resolved');
    fireEvent.click(screen.getByRole('button', {name: 'Next'}));
    selectFile('Triage Sentry');
    fireEvent.click(screen.getByRole('button', {name: 'Next'}));

    expect(await screen.findByRole('radio', {name: ON_ISSUE_TRIGGER_NAME})).toBeEnabled();
    expect(screen.getByRole('radio', {name: NIGHTLY_TRIGGER_NAME})).toBeEnabled();
    expect(screen.getByRole('radio', {name: SENTRY_TRIGGER_NAME})).toBeDisabled();
    expect(screen.getByText('Replay arrives in a later release.')).toBeInTheDocument();
  });

  test('prefills manual inputs from the trigger with block and submits them with the pinned commit', async () => {
    const {fetchImpl, getDevRunBodies} = createFetch();
    const onRunCreated = vi.fn();
    const onOpenChange = vi.fn();
    renderDialog(fetchImpl, {onRunCreated, onOpenChange});

    resolveRefToFileStep();
    await screen.findByText('Resolved');
    fireEvent.click(screen.getByRole('button', {name: 'Next'}));
    selectFile('Triage Sentry');
    fireEvent.click(screen.getByRole('button', {name: 'Next'}));
    selectTrigger('on_issue');
    fireEvent.click(screen.getByRole('button', {name: 'Next'}));

    const environmentInput = await screen.findByLabelText('Input 1 value');
    expect(environmentInput).toHaveValue('staging');
    expect(screen.getByLabelText('Input 2 value')).toHaveValue('us-east-1');

    fireEvent.change(environmentInput, {target: {value: 'production'}});
    fireEvent.click(screen.getByRole('button', {name: 'Start run'}));

    await waitFor(() => expect(onRunCreated).toHaveBeenCalledWith(RUN_ID));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(getDevRunBodies()).toEqual([
      {
        project_id: PROJECT_ID,
        ref: 'fix-triage-prompt',
        commit: COMMIT,
        config_path: '.shipfox/workflows/triage-sentry.yml',
        trigger: 'on_issue',
        inputs: {environment: 'production', region: 'us-east-1'},
      },
    ]);
  });

  test('submits without an inputs step for cron triggers', async () => {
    const {fetchImpl, getDevRunBodies} = createFetch();
    const onRunCreated = vi.fn();
    renderDialog(fetchImpl, {onRunCreated});

    resolveRefToFileStep();
    await screen.findByText('Resolved');
    fireEvent.click(screen.getByRole('button', {name: 'Next'}));
    selectFile('Triage Sentry');
    fireEvent.click(screen.getByRole('button', {name: 'Next'}));
    selectTrigger('nightly');

    // The trigger step is the last one for cron: the footer carries Start run.
    expect(screen.getByRole('button', {name: 'Start run'})).toBeEnabled();
    expect(screen.queryByLabelText('Input 1 value')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'Start run'}));

    await waitFor(() => expect(onRunCreated).toHaveBeenCalledWith(RUN_ID));
    expect(getDevRunBodies()).toEqual([
      {
        project_id: PROJECT_ID,
        ref: 'fix-triage-prompt',
        commit: COMMIT,
        config_path: '.shipfox/workflows/triage-sentry.yml',
        trigger: 'nightly',
      },
    ]);
  });

  test('adds and removes input rows', async () => {
    const {fetchImpl, getDevRunBodies} = createFetch();
    renderDialog(fetchImpl);

    resolveRefToFileStep();
    await screen.findByText('Resolved');
    fireEvent.click(screen.getByRole('button', {name: 'Next'}));
    selectFile('Triage Sentry');
    fireEvent.click(screen.getByRole('button', {name: 'Next'}));
    selectTrigger('on_issue');
    fireEvent.click(screen.getByRole('button', {name: 'Next'}));
    await screen.findByLabelText('Input 1 value');

    fireEvent.click(screen.getByRole('button', {name: 'Add input'}));
    fireEvent.change(screen.getByLabelText('Input 3 key'), {target: {value: 'canary'}});
    fireEvent.change(screen.getByLabelText('Input 3 value'), {target: {value: 'true'}});
    fireEvent.click(screen.getByRole('button', {name: 'Remove input 2'}));

    fireEvent.click(screen.getByRole('button', {name: 'Start run'}));
    await waitFor(() => {
      expect(getDevRunBodies()[0]?.inputs).toEqual({environment: 'staging', canary: true});
    });
  });

  test('re-lists the files and asks for confirmation on ref-moved', async () => {
    const {fetchImpl, getAtRefCalls, queueDevRun} = createFetch();
    const onRunCreated = vi.fn();
    renderDialog(fetchImpl, {onRunCreated});

    resolveRefToFileStep();
    await screen.findByText('Resolved');
    fireEvent.click(screen.getByRole('button', {name: 'Next'}));
    selectFile('Triage Sentry');
    fireEvent.click(screen.getByRole('button', {name: 'Next'}));
    selectTrigger('on_issue');
    fireEvent.click(screen.getByRole('button', {name: 'Next'}));
    await screen.findByLabelText('Input 1 value');

    // The ref moved between listing and submit: the server answers ref-moved.
    queueDevRun(jsonResponse({code: 'ref-moved'}, {status: 409}));
    const atRefCallsBeforeSubmit = getAtRefCalls();
    fireEvent.click(screen.getByRole('button', {name: 'Start run'}));

    // Back on the file step with the confirmation alert and a fresh listing.
    await screen.findByText('Ref moved');
    expect(screen.getByText(CONFIRM_AGAIN_TEXT)).toBeInTheDocument();
    await waitFor(() => expect(getAtRefCalls()).toBeGreaterThan(atRefCallsBeforeSubmit));
    expect(screen.getByRole('button', {name: 'Next'})).toBeDisabled();

    // Confirm again: the second submit succeeds.
    selectFile('Triage Sentry');
    fireEvent.click(screen.getByRole('button', {name: 'Next'}));
    selectTrigger('on_issue');
    fireEvent.click(screen.getByRole('button', {name: 'Next'}));
    fireEvent.click(screen.getByRole('button', {name: 'Start run'}));

    await waitFor(() => expect(onRunCreated).toHaveBeenCalledWith(RUN_ID));
    expect(onRunCreated).toHaveBeenCalledTimes(1);
  });

  test('shows submit errors on the step and stays open', async () => {
    const {fetchImpl, queueDevRun} = createFetch();
    const onRunCreated = vi.fn();
    const onOpenChange = vi.fn();
    renderDialog(fetchImpl, {onRunCreated, onOpenChange});

    resolveRefToFileStep();
    await screen.findByText('Resolved');
    fireEvent.click(screen.getByRole('button', {name: 'Next'}));
    selectFile('Triage Sentry');
    fireEvent.click(screen.getByRole('button', {name: 'Next'}));
    selectTrigger('on_issue');
    fireEvent.click(screen.getByRole('button', {name: 'Next'}));
    await screen.findByLabelText('Input 1 value');

    queueDevRun(
      jsonResponse({code: 'invalid-workflow-definition', details: {errors: []}}, {status: 422}),
    );
    fireEvent.click(screen.getByRole('button', {name: 'Start run'}));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Invalid workflow definition')).toBeInTheDocument();
    expect(
      within(alert).getByText(
        'The workflow file at this ref did not validate. Fix the errors on the branch and try again.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Start run'})).toBeEnabled();
    expect(onRunCreated).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  test('resets the wizard when reopened', async () => {
    const {fetchImpl} = createFetch();
    const onOpenChange = vi.fn();
    const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const {rerender} = render(
      <QueryClientProvider client={queryClient}>
        <RunFromBranchDialog projectId={PROJECT_ID} open onOpenChange={onOpenChange} />
      </QueryClientProvider>,
    );

    resolveRefToFileStep();
    await screen.findByText('Resolved');

    rerender(
      <QueryClientProvider client={queryClient}>
        <RunFromBranchDialog projectId={PROJECT_ID} open={false} onOpenChange={onOpenChange} />
      </QueryClientProvider>,
    );
    rerender(
      <QueryClientProvider client={queryClient}>
        <RunFromBranchDialog projectId={PROJECT_ID} open onOpenChange={onOpenChange} />
      </QueryClientProvider>,
    );

    expect(screen.getByLabelText(REF_INPUT_LABEL)).toHaveValue('');
    expect(screen.queryByText('Resolved')).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Next'})).toBeDisabled();
  });
});
