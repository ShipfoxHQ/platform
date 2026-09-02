import type {AnnotationDto} from '@shipfox/annotations-dto';
import type {
  WorkflowRunDetailResponseDto,
  WorkflowRunJobOverviewDto,
  WorkflowRunOverviewResponseDto,
} from '@shipfox/api-workflows-dto';
import {configureApiClient} from '@shipfox/client-api';
import type {Decorator, Meta, StoryObj} from '@storybook/react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {type ReactNode, useEffect, useState} from 'react';
import {
  runAttemptsResponseDto,
  workflowJobDto,
  workflowJobExecutionDto,
  workflowRunDetailDto,
  workflowStepAttemptDto,
  workflowStepDto,
} from '#test/fixtures/workflow-run.js';
import {WorkflowRunView} from './workflow-run-view.js';

const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const RUN_STARTED_AT = '2026-06-26T11:57:00.000Z';
const RUN_FINISHED_AT = '2026-06-26T11:59:00.000Z';
const BUILD_JOB_ID = '44444444-4444-4444-8444-00000000000b';
const BUILD_EXECUTION_ID = '77777777-7777-4777-8777-00000000000b';
const BUILD_STEP_ID = '55555555-5555-4555-8555-00000000000b';
const BUILD_ATTEMPT_ID = '66666666-6666-4666-8666-00000000000b';

function responseForPath(
  path: string,
  annotations: readonly AnnotationDto[],
  workflowSize: 'complete' | 'large',
) {
  if (path === '/annotations') {
    return {body: {annotations, has_more: false, next_cursor: null}, status: 200};
  }
  if (path === `/workflows/runs/${RUN_ID}/attempts`) {
    return {body: RUN_ATTEMPTS_RESPONSE, status: 200};
  }
  if (path === `/workflows/runs/${RUN_ID}/head`) {
    return {
      body: {
        current_attempt: 1,
        latest_attempt: 1,
        current_status: 'succeeded',
        updated_at: RUN_FINISHED_AT,
      },
      status: 200,
    };
  }
  if (path === `/workflows/runs/${RUN_ID}/overview`) {
    return {
      body: workflowSize === 'large' ? RUN_LARGE_OVERVIEW_RESPONSE : RUN_OVERVIEW_RESPONSE,
      status: 200,
    };
  }
  if (path === `/workflows/runs/${RUN_ID}`) return {body: RUN_RESPONSE, status: 200};
  return {body: {code: 'not-found'}, status: 404};
}

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
      id: BUILD_JOB_ID,
      key: 'build',
      name: 'build',
      status: 'succeeded',
      position: 0,
      job_executions: [
        workflowJobExecutionDto({
          id: BUILD_EXECUTION_ID,
          job_id: BUILD_JOB_ID,
          status: 'succeeded',
          steps: [
            workflowStepDto({
              id: BUILD_STEP_ID,
              name: 'run smoke checks',
              status: 'succeeded',
              attempts: [
                workflowStepAttemptDto({
                  id: BUILD_ATTEMPT_ID,
                  step_id: BUILD_STEP_ID,
                  attempt: 1,
                  status: 'succeeded',
                }),
              ],
            }),
          ],
        }),
      ],
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
const BUILD_OVERVIEW_JOB = overviewJobDto({
  id: BUILD_JOB_ID,
  key: 'build',
  name: 'build',
  status: 'succeeded',
  position: 0,
});
const RUN_OVERVIEW_RESPONSE: WorkflowRunOverviewResponseDto = {
  run: {
    id: RUN_RESPONSE.id,
    project_id: RUN_RESPONSE.project_id,
    definition_id: RUN_RESPONSE.definition_id,
    number: RUN_RESPONSE.number,
    name: RUN_RESPONSE.name,
    workflow_name: RUN_RESPONSE.workflow_name,
    origin: RUN_RESPONSE.origin,
    dev_source: RUN_RESPONSE.dev_source,
    trigger_provider: RUN_RESPONSE.trigger_provider,
    trigger_source: RUN_RESPONSE.trigger_source,
    trigger_event: RUN_RESPONSE.trigger_event,
    trigger_reference: RUN_RESPONSE.trigger_reference,
    created_at: RUN_RESPONSE.created_at,
  },
  attempt: RUN_RESPONSE.run_attempt,
  has_started_job_execution: RUN_RESPONSE.has_started_job_execution,
  jobs: {
    kind: 'complete',
    total: 3,
    items: [
      BUILD_OVERVIEW_JOB,
      overviewJobDto({
        id: '44444444-4444-4444-8444-00000000000c',
        key: 'deploy',
        name: 'deploy',
        status: 'succeeded',
        position: 1,
        dependencies: ['build'],
      }),
      overviewJobDto({
        id: '44444444-4444-4444-8444-00000000000d',
        key: 'notify',
        name: 'notify',
        status: 'succeeded',
        position: 2,
        dependencies: ['deploy'],
      }),
    ],
  },
};
const {dependencies: _buildDependencies, ...BUILD_JOB_SUMMARY} = BUILD_OVERVIEW_JOB;
const RUN_LARGE_OVERVIEW_RESPONSE: WorkflowRunOverviewResponseDto = {
  ...RUN_OVERVIEW_RESPONSE,
  jobs: {
    kind: 'large',
    total: 101,
    status_counts: [{status: 'succeeded', count: 101}],
    first_page: {
      items: [BUILD_JOB_SUMMARY],
      next_cursor: null,
      total: 101,
    },
  },
};

function overviewJobDto(
  overrides: Partial<WorkflowRunJobOverviewDto> = {},
): WorkflowRunJobOverviewDto {
  return {
    id: BUILD_JOB_ID,
    key: 'build',
    name: 'build',
    position: 0,
    dependencies: [],
    status: 'pending',
    status_reason: null,
    mode: 'one_shot',
    listener_status: 'inactive',
    carried_over: false,
    execution_count: 0,
    execution_status_counts: {
      pending: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
    },
    default_execution: null,
    ...overrides,
  };
}

/** Stable identity: a fresh `[]` per render would retrigger the API-client effect every render. */
const NO_ANNOTATIONS: AnnotationDto[] = [];

const RUN_ANNOTATIONS: AnnotationDto[] = [
  annotationDto({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',
    context: 'smoke check',
    style: 'error',
    sequence: 3,
    body: 'Task nine failed the smoke check against `https://preview.example.com`.\n\n```sh\ncurl -sSf https://preview.example.com/healthz\n```',
  }),
  annotationDto({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002',
    context: 'flaky tests',
    style: 'warning',
    sequence: 2,
    body: '2 specs retried before passing.',
  }),
  annotationDto({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000003',
    context: 'deploy',
    style: 'success',
    sequence: 1,
    body: 'Deployed **v42** to staging.',
  }),
];

const withRunApi: Decorator = (Story, context) => (
  <RunWorkspaceStoryProviders
    annotations={(context.parameters.annotations ?? NO_ANNOTATIONS) as AnnotationDto[]}
    workflowSize={context.parameters.workflowSize === 'large' ? 'large' : 'complete'}
  >
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
      options: {
        wide: {
          name: 'Wide',
          styles: {width: '1440px', height: '720px'},
          type: 'desktop',
        },
      },
    },
    globals: {
      viewport: {value: 'wide'},
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
    runAttempt: 1,
  },
} satisfies Meta<typeof WorkflowRunView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WideViewport: Story = {};

/**
 * The annotations section in the page frame it actually ships in.
 *
 * The standalone `Workflows/RunAnnotations` stories capture the panel on its own, which cannot
 * show the two things that only exist here: the rail marking the section, and how the panel and
 * its rows sit against the run header and the frame gutters.
 */
export const Annotations: Story = {
  parameters: {annotations: RUN_ANNOTATIONS},
  args: {tab: 'annotations'},
};

export const LargeWorkflow: Story = {
  parameters: {workflowSize: 'large'},
};

function annotationDto(overrides: Partial<AnnotationDto> & {id: string}): AnnotationDto {
  return {
    job_id: BUILD_JOB_ID,
    job_execution_id: BUILD_EXECUTION_ID,
    origin_step_id: BUILD_STEP_ID,
    origin_step_attempt: 1,
    context: 'default',
    style: 'default',
    sequence: 1,
    body: 'Body',
    ...overrides,
  };
}

function RunWorkspaceStoryProviders({
  annotations,
  workflowSize,
  children,
}: {
  annotations: AnnotationDto[];
  workflowSize: 'complete' | 'large';
  children: ReactNode;
}) {
  const [queryClient] = useState(
    () => new QueryClient({defaultOptions: {queries: {retry: false}}}),
  );
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: (input) => {
        let url: string;
        if (input instanceof Request) url = input.url;
        else if (input instanceof URL) url = input.href;
        else url = String(input);
        const path = new URL(url, 'https://api.example.test').pathname;
        const response = responseForPath(path, annotations, workflowSize);
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
  }, [annotations, workflowSize]);

  if (!configured) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex h-[720px] min-w-[1440px] w-[1440px] bg-background-subtle-base">
        <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col px-frame py-frame">
          {children}
        </div>
      </div>
    </QueryClientProvider>
  );
}
