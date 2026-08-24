import {configureApiClient} from '@shipfox/client-api';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {definitionsAtRefQueryKeys} from '#hooks/api/definitions-at-ref.js';
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
const DUPLICATE_KEY_ERROR = /Duplicate input key/;

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
  devRun?: Response | Promise<Response>;
} = {}) {
  const devRunResponses: Array<Response | Promise<Response>> = [devRun];
  const devRunBodies: Array<Record<string, unknown>> = [];
  // The first `/definitions/at-ref` call answers with `listing`; queued
  // responses are served in order to later calls (mutation refresh, retries).
  const listingResponses: Response[] = [];
  let atRefCalls = 0;

  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request ? request.url : String(input));
    const method = init?.method ?? request?.method ?? 'GET';

    if (url.pathname === '/definitions/at-ref') {
      atRefCalls += 1;
      if (atRefCalls === 1) return listing.clone();
      const queued = listingResponses.shift();
      return (queued ?? listing).clone();
    }
    if (url.pathname === '/dev-runs' && method === 'POST') {
      const bodyText = request ? await request.text() : String(init?.body ?? '');
      devRunBodies.push(JSON.parse(bodyText) as Record<string, unknown>);
      const next = devRunResponses.shift();
      return (await (next ?? devRun)).clone();
    }
    return jsonResponse({code: 'not-found'}, {status: 404});
  });

  return {
    fetchImpl,
    getAtRefCalls: () => atRefCalls,
    getDevRunBodies: () => devRunBodies,
    /** Queue a response for the next `POST /dev-runs` call. */
    queueDevRun(response: Response | Promise<Response>) {
      devRunResponses.unshift(response);
    },
    /** Queue a response for the next `GET /definitions/at-ref` call. */
    queueListing(response: Response) {
      listingResponses.unshift(response);
    },
  };
}

function renderDialog(
  fetchImpl: typeof fetch,
  {
    onRunCreated = vi.fn(),
    onOpenChange = vi.fn(),
    fixedEvent,
  }: {
    onRunCreated?: (workflowRunId: string) => void;
    onOpenChange?: (open: boolean) => void;
    fixedEvent?: {id: string; source: string; event: string};
  } = {},
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
        fixedEvent={fixedEvent}
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

    // Invalid file renders its errors inline and is not selectable: it is no
    // radio at all, so the diagnostics stay in the accessibility tree.
    expect(await screen.findByText('Unknown job reference: deploy')).toBeInTheDocument();
    expect(screen.getByText('jobs.build')).toBeInTheDocument();
    expect(screen.queryByRole('radio', {name: BROKEN_FILE_NAME})).not.toBeInTheDocument();
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
    // The integration trigger is no radio at all, so the hint stays readable.
    expect(screen.queryByRole('radio', {name: SENTRY_TRIGGER_NAME})).not.toBeInTheDocument();
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

  test('re-lists the files and confirms the new commit on ref-moved', async () => {
    const {fetchImpl, getAtRefCalls, getDevRunBodies, queueDevRun, queueListing} = createFetch();
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

    // The ref moved between listing and submit: the server answers ref-moved,
    // and the mutation's pre-POST refresh re-lists the ref at a new commit.
    const NEW_COMMIT = 'bbbbbbbbccccccccddddddddeeeeeeeeffffffff';
    queueListing(jsonResponse(atRefListingDto({commit: NEW_COMMIT})));
    queueListing(jsonResponse(atRefListingDto({commit: NEW_COMMIT})));
    queueDevRun(jsonResponse({code: 'ref-moved'}, {status: 409}));
    const atRefCallsBeforeSubmit = getAtRefCalls();
    fireEvent.click(screen.getByRole('button', {name: 'Start run'}));

    // Back on the file step with the confirmation alert and a fresh listing.
    await screen.findByText('Ref moved');
    expect(screen.getByText(CONFIRM_AGAIN_TEXT)).toBeInTheDocument();
    await waitFor(() => expect(getAtRefCalls()).toBeGreaterThan(atRefCallsBeforeSubmit));
    expect(screen.getByRole('button', {name: 'Next'})).toBeDisabled();

    // Confirm again: the second submit carries the NEW commit, never the
    // stale one the server just rejected.
    selectFile('Triage Sentry');
    fireEvent.click(screen.getByRole('button', {name: 'Next'}));
    selectTrigger('on_issue');
    fireEvent.click(screen.getByRole('button', {name: 'Next'}));
    fireEvent.click(screen.getByRole('button', {name: 'Start run'}));

    await waitFor(() => expect(onRunCreated).toHaveBeenCalledWith(RUN_ID));
    expect(onRunCreated).toHaveBeenCalledTimes(1);
    expect(getDevRunBodies()[1]?.commit).toBe(NEW_COMMIT);
  });

  test('surfaces a failed re-list instead of re-confirming a stale commit', async () => {
    const {fetchImpl, queueDevRun, queueListing} = createFetch();
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

    // The pre-POST refresh fails while the server answers ref-moved: the
    // stale listing must not be confirmable and the failure must surface.
    queueListing(jsonResponse({code: 'source-unavailable'}, {status: 502}));
    queueDevRun(jsonResponse({code: 'ref-moved'}, {status: 409}));
    fireEvent.click(screen.getByRole('button', {name: 'Start run'}));

    await screen.findByText('Could not re-list the workflow files');
    expect(screen.getByText('Ref moved')).toBeInTheDocument();
    // Selecting a file cannot re-enable the stale confirmation.
    selectFile('Triage Sentry');
    expect(screen.getByRole('button', {name: 'Next'})).toBeDisabled();
    expect(onRunCreated).not.toHaveBeenCalled();
  });

  test('retries a failed resolution when the ref blurs again', async () => {
    const {fetchImpl, queueListing} = createFetch({
      listing: jsonResponse({code: 'ref-invalid'}, {status: 400}),
    });
    renderDialog(fetchImpl);

    queueListing(jsonResponse(atRefListingDto()));
    const input = screen.getByLabelText(REF_INPUT_LABEL);
    fireEvent.change(input, {target: {value: 'fix-triage-prompt'}});
    fireEvent.blur(input);

    await waitFor(() =>
      expect(input).toHaveAccessibleDescription('Enter a branch or tag name in this repository.'),
    );
    expect(screen.queryByText('Resolved')).not.toBeInTheDocument();

    // Re-blurring the same ref retries the resolution and lands on the listing.
    fireEvent.blur(input);
    await screen.findByText('Resolved');
    expect(screen.getByRole('button', {name: 'Next'})).toBeEnabled();
  });

  test('renders the no-files fallback and disables Next', async () => {
    const {fetchImpl} = createFetch({
      listing: jsonResponse(atRefListingDto({files: []})),
    });
    renderDialog(fetchImpl);

    resolveRefToFileStep();
    await screen.findByText('Resolved');
    fireEvent.click(screen.getByRole('button', {name: 'Next'}));

    expect(screen.getByText('No workflow files found at this ref.')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Next'})).toBeDisabled();
  });

  test('renders the no-triggers fallback and disables Next', async () => {
    const {fetchImpl} = createFetch({
      listing: jsonResponse(
        atRefListingDto({
          files: [
            {
              config_path: '.shipfox/workflows/quiet.yml',
              name: 'Quiet',
              valid: true,
              errors: [],
              warnings: [],
              triggers: {},
            },
          ],
        }),
      ),
    });
    renderDialog(fetchImpl);

    resolveRefToFileStep();
    await screen.findByText('Resolved');
    fireEvent.click(screen.getByRole('button', {name: 'Next'}));
    selectFile('Quiet');
    fireEvent.click(screen.getByRole('button', {name: 'Next'}));

    expect(screen.getByText('This file declares no triggers.')).toBeInTheDocument();
    // The trigger step is the last one for an unselected trigger, so the
    // primary carries the submit label and stays disabled.
    expect(screen.getByRole('button', {name: 'Start run'})).toBeDisabled();
  });

  test('submits an empty inputs object for a manual trigger without a with block', async () => {
    const {fetchImpl, getDevRunBodies} = createFetch({
      listing: jsonResponse(
        atRefListingDto({
          files: [
            {
              config_path: '.shipfox/workflows/plain.yml',
              name: 'Plain',
              valid: true,
              errors: [],
              warnings: [],
              triggers: {on_demand: {source: 'manual', event: 'fire'}},
            },
          ],
        }),
      ),
    });
    const onRunCreated = vi.fn();
    renderDialog(fetchImpl, {onRunCreated});

    resolveRefToFileStep();
    await screen.findByText('Resolved');
    fireEvent.click(screen.getByRole('button', {name: 'Next'}));
    selectFile('Plain');
    fireEvent.click(screen.getByRole('button', {name: 'Next'}));
    selectTrigger('on_demand');
    fireEvent.click(screen.getByRole('button', {name: 'Next'}));

    expect(screen.getByText('This trigger takes no inputs.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'Start run'}));

    await waitFor(() => expect(onRunCreated).toHaveBeenCalledWith(RUN_ID));
    expect(getDevRunBodies()[0]?.inputs).toEqual({});
  });

  test('shows a dead-end fallback when the selected trigger disappears on the inputs step', async () => {
    const {fetchImpl, queueListing} = createFetch();
    const {queryClient} = renderDialog(fetchImpl);

    resolveRefToFileStep();
    await screen.findByText('Resolved');
    fireEvent.click(screen.getByRole('button', {name: 'Next'}));
    selectFile('Triage Sentry');
    fireEvent.click(screen.getByRole('button', {name: 'Next'}));
    selectTrigger('on_issue');
    fireEvent.click(screen.getByRole('button', {name: 'Next'}));
    await screen.findByLabelText('Input 1 value');

    // A listing refresh drops the selected file's triggers mid-flow.
    queueListing(
      jsonResponse(
        atRefListingDto({
          files: [
            {
              config_path: '.shipfox/workflows/triage-sentry.yml',
              name: 'Triage Sentry',
              valid: true,
              errors: [],
              warnings: [],
              triggers: {},
            },
          ],
        }),
      ),
    );
    await queryClient.refetchQueries({
      queryKey: definitionsAtRefQueryKeys.atRef(PROJECT_ID, 'fix-triage-prompt'),
    });

    // The inputs step cannot dead-end silently: the fallback renders and the
    // primary action is disabled.
    await screen.findByText('The selected trigger is no longer available at this ref.');
    expect(screen.getByRole('button', {name: 'Start run'})).toBeDisabled();
  });

  test('flags duplicate input keys and disables Start run', async () => {
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

    // A second row reuses the environment key: the run must not start with
    // the first value silently discarded.
    fireEvent.click(screen.getByRole('button', {name: 'Add input'}));
    fireEvent.change(screen.getByLabelText('Input 3 key'), {target: {value: 'environment'}});
    fireEvent.change(screen.getByLabelText('Input 3 value'), {target: {value: 'override'}});

    expect(
      screen.getByText('Duplicate input key: environment. Each key must be unique.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Start run'})).toBeDisabled();
    expect(getDevRunBodies()).toEqual([]);

    // Renaming the row clears the duplicate and re-enables the submit.
    fireEvent.change(screen.getByLabelText('Input 3 key'), {target: {value: 'canary'}});
    expect(screen.queryByText(DUPLICATE_KEY_ERROR)).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Start run'})).toBeEnabled();
  });

  test('blocks dismissal while the dev-run POST is in flight', async () => {
    const {fetchImpl, queueDevRun} = createFetch();
    const onOpenChange = vi.fn();
    renderDialog(fetchImpl, {onOpenChange});

    resolveRefToFileStep();
    await screen.findByText('Resolved');
    fireEvent.click(screen.getByRole('button', {name: 'Next'}));
    selectFile('Triage Sentry');
    fireEvent.click(screen.getByRole('button', {name: 'Next'}));
    selectTrigger('on_issue');
    fireEvent.click(screen.getByRole('button', {name: 'Next'}));
    await screen.findByLabelText('Input 1 value');

    // The POST never settles: the dialog must stay up and keep its state.
    queueDevRun(
      new Promise<Response>(() => {
        /* intentionally never settles */
      }),
    );
    fireEvent.click(screen.getByRole('button', {name: 'Start run'}));
    await waitFor(() => expect(screen.getByRole('button', {name: 'Back'})).toBeDisabled());

    fireEvent.keyDown(document, {key: 'Escape'});
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', {name: 'Run from branch'})).toBeInTheDocument();
  });

  test('with a fixed event only matching triggers are selectable and the replay id is submitted', async () => {
    const {fetchImpl, getDevRunBodies} = createFetch();
    const onRunCreated = vi.fn();
    renderDialog(fetchImpl, {
      onRunCreated,
      fixedEvent: {id: 'journaled-event-1', source: 'github_acme', event: 'issue.created'},
    });

    resolveRefToFileStep();
    await screen.findByText('Resolved');
    fireEvent.click(screen.getByRole('button', {name: 'Next'}));
    selectFile('Triage Sentry');
    fireEvent.click(screen.getByRole('button', {name: 'Next'}));

    // Only the matching integration trigger is a selectable radio; the manual
    // and cron triggers render as unavailable cards with the mismatch hint.
    expect(await screen.findByRole('radio', {name: SENTRY_TRIGGER_NAME})).toBeEnabled();
    expect(screen.queryByRole('radio', {name: ON_ISSUE_TRIGGER_NAME})).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', {name: NIGHTLY_TRIGGER_NAME})).not.toBeInTheDocument();
    expect(screen.getAllByText('Does not match the selected event.')).toHaveLength(2);

    // The integration trigger submits from the trigger step with the replay id.
    selectTrigger('sentry_issue');
    expect(screen.getByRole('button', {name: 'Start run'})).toBeEnabled();
    fireEvent.click(screen.getByRole('button', {name: 'Start run'}));

    await waitFor(() => expect(onRunCreated).toHaveBeenCalledWith(RUN_ID));
    expect(getDevRunBodies()[0]).toMatchObject({
      trigger: 'sentry_issue',
      replay_event_id: 'journaled-event-1',
    });
    expect(getDevRunBodies()[0]?.inputs).toBeUndefined();
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
