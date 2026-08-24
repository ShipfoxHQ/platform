import {configureApiClient} from '@shipfox/client-api';
import {Button} from '@shipfox/react-ui/button';
import type {Meta, StoryObj} from '@storybook/react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {type ReactNode, useEffect, useState} from 'react';
import {expect} from 'storybook/test';
import {RunFromBranchDialog} from './run-from-branch-dialog.js';

const PROJECT_ID = '44444444-4444-4444-8444-444444444444';
const COMMIT = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';
const RUN_ID = '66666666-6666-4666-8666-666666666666';

const OPEN_DIALOG_BUTTON_NAME = 'Open dialog';
const REF_INPUT_LABEL = 'Branch or tag';
const NEXT_BUTTON_NAME = 'Next';
const BROKEN_FILE_NAME = /Broken/;
const TRIAGE_FILE_NAME = /Triage Sentry/;
const ON_ISSUE_TRIGGER_NAME = /on_issue/;

function atRefListingDto() {
  return {
    ref: 'fix-triage-prompt',
    commit: COMMIT,
    files: [
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

function storyFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = input instanceof Request ? input : null;
  const url = new URL(request ? request.url : String(input));
  const method = init?.method ?? request?.method ?? 'GET';
  const response =
    url.pathname === '/definitions/at-ref'
      ? {body: atRefListingDto(), status: 200}
      : url.pathname === '/dev-runs' && method === 'POST'
        ? {body: {workflow_run_id: RUN_ID, commit: COMMIT}, status: 201}
        : {body: {code: 'not-found'}, status: 404};
  return Promise.resolve(
    new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: {'content-type': 'application/json'},
    }),
  );
}

function RunFromBranchStoryProviders({children}: {children: ReactNode}) {
  const [queryClient] = useState(
    () => new QueryClient({defaultOptions: {queries: {retry: false}}}),
  );
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl: storyFetch});
    setConfigured(true);

    return () => {
      configureApiClient({baseUrl: '', fetchImpl: undefined});
    };
  }, []);

  if (!configured) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex h-[640px] w-[720px] items-center justify-center bg-background-subtle-base p-24">
        {children}
      </div>
    </QueryClientProvider>
  );
}

/** The dialog starts closed and opens on demand, so the stories also capture the closed state. */
function RunFromBranchStoryDialog() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>{OPEN_DIALOG_BUTTON_NAME}</Button>
      <RunFromBranchDialog projectId={PROJECT_ID} open={open} onOpenChange={setOpen} />
    </>
  );
}

const meta = {
  title: 'Workflows/RunFromBranchDialog',
  component: RunFromBranchDialog,
  parameters: {layout: 'centered'},
  decorators: [
    (Story) => (
      <RunFromBranchStoryProviders>
        <Story />
      </RunFromBranchStoryProviders>
    ),
  ],
} satisfies Meta<typeof RunFromBranchDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

async function openDialog() {
  await userEvent.setup().click(screen.getByRole('button', {name: OPEN_DIALOG_BUTTON_NAME}));
  await screen.findByRole('dialog', {name: 'Run from branch'});
}

async function resolveRef() {
  const user = userEvent.setup();
  const input = await screen.findByLabelText(REF_INPUT_LABEL);
  await user.type(input, 'fix-triage-prompt');
  await user.tab();
  await waitFor(() => expect(screen.getByText('Resolved')).toBeInTheDocument());
}

async function goToFileStep() {
  await resolveRef();
  await userEvent.setup().click(screen.getByRole('button', {name: NEXT_BUTTON_NAME}));
  await screen.findByRole('radio', {name: BROKEN_FILE_NAME});
}

async function goToTriggerStep() {
  await goToFileStep();
  await userEvent.setup().click(screen.getByRole('radio', {name: TRIAGE_FILE_NAME}));
  await userEvent.setup().click(screen.getByRole('button', {name: NEXT_BUTTON_NAME}));
  await screen.findByRole('radio', {name: ON_ISSUE_TRIGGER_NAME});
}

async function goToInputsStep() {
  await goToTriggerStep();
  await userEvent.setup().click(screen.getByRole('radio', {name: ON_ISSUE_TRIGGER_NAME}));
  await userEvent.setup().click(screen.getByRole('button', {name: NEXT_BUTTON_NAME}));
  await screen.findByLabelText('Input 1 value');
}

/** The closed dialog with its trigger button, for exploration. */
export const Playground: Story = {
  render: () => <RunFromBranchStoryDialog />,
};

/** The ref step after resolution: the input, the pinned commit, and the file count. */
export const RefStep: Story = {
  render: () => <RunFromBranchStoryDialog />,
  play: async () => {
    await openDialog();
    await resolveRef();
  },
};

/** The file step: valid and invalid files with inline errors and warnings. */
export const FileStep: Story = {
  render: () => <RunFromBranchStoryDialog />,
  play: async () => {
    await openDialog();
    await goToFileStep();
  },
};

/** The trigger step: manual and cron selectable, integration-sourced disabled with a hint. */
export const TriggerStep: Story = {
  render: () => <RunFromBranchStoryDialog />,
  play: async () => {
    await openDialog();
    await goToTriggerStep();
  },
};

/** The inputs step: the manual trigger's `with` block prefilled as editable rows. */
export const InputsStep: Story = {
  render: () => <RunFromBranchStoryDialog />,
  play: async () => {
    await openDialog();
    await goToInputsStep();
  },
};
