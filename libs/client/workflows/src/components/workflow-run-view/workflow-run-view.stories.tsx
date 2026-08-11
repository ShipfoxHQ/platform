import type {WorkflowRunDetailResponseDto} from '@shipfox/api-workflows-dto';
import {configureApiClient} from '@shipfox/client-api';
import type {Decorator, Meta, StoryObj} from '@storybook/react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {type ReactNode, useEffect, useState} from 'react';
import {
  runAttemptsResponseDto,
  workflowJobDto,
  workflowRunDetailDto,
} from '#test/fixtures/workflow-run.js';
import {WorkflowRunView} from './workflow-run-view.js';

const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const RUN_STARTED_AT = '2026-06-26T11:57:00.000Z';
const RUN_FINISHED_AT = '2026-06-26T11:59:00.000Z';

const RUN_RESPONSE: WorkflowRunDetailResponseDto = workflowRunDetailDto({
  id: RUN_ID,
  project_id: PROJECT_ID,
  name: 'deploy-web',
  status: 'succeeded',
  started_at: RUN_STARTED_AT,
  finished_at: RUN_FINISHED_AT,
  has_started_job_execution: true,
  jobs: [
    workflowJobDto({
      key: 'build',
      name: 'build',
      status: 'succeeded',
      position: 0,
    }),
    workflowJobDto({
      key: 'deploy',
      name: 'deploy',
      status: 'succeeded',
      position: 1,
      dependencies: ['build'],
    }),
    workflowJobDto({
      key: 'notify',
      name: 'notify',
      status: 'succeeded',
      position: 2,
      dependencies: ['deploy'],
    }),
  ],
});
const RUN_ATTEMPTS_RESPONSE = runAttemptsResponseDto({attempts: []});

const withRunApi: Decorator = (Story) => (
  <RunWorkspaceStoryProviders>
    <Story />
  </RunWorkspaceStoryProviders>
);

const meta = {
  title: 'Workflows/WorkflowRunView',
  component: WorkflowRunView,
  parameters: {
    layout: 'fullscreen',
    viewport: {
      defaultViewport: 'wide',
      viewports: {
        wide: {
          name: 'Wide',
          styles: {width: '1440px', height: '720px'},
        },
      },
    },
    argos: {
      modes: {dark: {theme: 'dark'}},
      fitToContent: false,
    },
  },
  decorators: [withRunApi],
  args: {
    projectId: PROJECT_ID,
    workspaceSlug: 'acme',
    projectSlug: 'platform',
    workflowRunId: RUN_ID,
  },
} satisfies Meta<typeof WorkflowRunView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WideViewport: Story = {};

function RunWorkspaceStoryProviders({children}: {children: ReactNode}) {
  const [queryClient] = useState(
    () => new QueryClient({defaultOptions: {queries: {retry: false}}}),
  );
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: (input) => {
        const url =
          input instanceof Request ? input.url : input instanceof URL ? input.href : String(input);
        const path = new URL(url, 'https://api.example.test').pathname;
        const response =
          path === '/annotations'
            ? {
                body: {annotations: [], has_more: false, next_cursor: null},
                status: 200,
              }
            : path === `/workflows/runs/${RUN_ID}/attempts`
              ? {body: RUN_ATTEMPTS_RESPONSE, status: 200}
              : path === `/workflows/runs/${RUN_ID}`
                ? {body: RUN_RESPONSE, status: 200}
                : {body: {code: 'not-found'}, status: 404};
        return new Response(JSON.stringify(response.body), {
          status: response.status,
          headers: {'content-type': 'application/json'},
        });
      },
    });
    setConfigured(true);

    return () => {
      configureApiClient({baseUrl: '', fetchImpl: undefined});
    };
  }, []);

  if (!configured) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex h-[720px] min-w-[1440px] w-[1440px] bg-background-subtle-base">
        {children}
      </div>
    </QueryClientProvider>
  );
}
