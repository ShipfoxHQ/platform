import type {Meta, StoryObj} from '@storybook/react';
import type {ReactNode} from 'react';
import {
  buildRunAnnotationList,
  type RunAnnotationRecord,
  type RunAnnotationStyle,
  summarizeRunAnnotations,
} from '#core/run-annotation.js';
import type {Job} from '#core/workflow-run.js';
import {
  workflowJob,
  workflowJobExecutionDto,
  workflowStepAttemptDto,
  workflowStepDto,
} from '#test/fixtures/workflow-run.js';
import {RunAnnotationCountChip} from './run-annotation-count-chip.js';
import {RunAnnotationList, type RunAnnotationListQuery} from './run-annotation-list.js';
import {RunAnnotationSummaryLine} from './run-annotation-summary-line.js';

const WORKSPACE_SLUG = 'acme';
const PROJECT_SLUG = 'platform';
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const BUILD_JOB_ID = '44444444-4444-4444-8444-00000000000b';
const TEST_JOB_ID = '44444444-4444-4444-8444-00000000000c';
const BUILD_EXECUTION_ID = '77777777-7777-4777-8777-00000000000b';
const TEST_EXECUTION_ID = '77777777-7777-4777-8777-00000000000c';
const BUILD_STEP_ID = '55555555-5555-4555-8555-00000000000b';
const TEST_STEP_ID = '55555555-5555-4555-8555-00000000000c';
const BUILD_ATTEMPT_ID = '66666666-6666-4666-8666-00000000000b';
const TEST_ATTEMPT_ID = '66666666-6666-4666-8666-00000000000c';

const LONG_BODY = [
  '### Failing specs',
  '',
  ...Array.from(
    {length: 40},
    (_unused, index) => `- \`packages/web/src/route-${index}.test.ts\` expected 200, received 503`,
  ),
].join('\n');

const meta = {
  title: 'Workflows/RunAnnotations',
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: () => {
    const annotations = [
      annotation({
        id: 'a1',
        context: 'smoke check',
        style: 'error',
        sequence: 3,
        body: 'Task nine failed the smoke check against `https://preview.example.com`.\n\n```sh\ncurl -sSf https://preview.example.com/healthz\n```',
      }),
      annotation({
        id: 'a2',
        context: 'flaky tests',
        style: 'warning',
        sequence: 1,
        jobId: TEST_JOB_ID,
        jobExecutionId: TEST_EXECUTION_ID,
        originStepId: TEST_STEP_ID,
        body: '2 specs retried before passing.\n\n| Spec | Retries |\n| --- | --- |\n| `checkout.spec.ts` | 1 |\n| `billing.spec.ts` | 2 |',
      }),
      annotation({
        id: 'a3',
        context: 'deploy',
        style: 'success',
        sequence: 2,
        body: 'Deployed **v42** to staging: [preview](https://preview.example.com)',
      }),
      annotation({
        id: 'a4',
        context: 'coverage',
        style: 'info',
        sequence: 4,
        body: 'Line coverage held at 87.4%.',
      }),
    ];

    return <AnnotationsFrame annotations={annotations} />;
  },
};

export const BoundedBody: Story = {
  // The only story in this package that earns a second Argos mode. The clamp's fade is the one
  // gradient in the client, and it blends a surface token that flips with the theme, so a
  // dark-only capture would never catch it breaking on a light card.
  parameters: {
    argos: {modes: {dark: {theme: 'dark'}, light: {theme: 'light'}}},
  },
  render: () => (
    <AnnotationsFrame
      annotations={[
        annotation({id: 'long', context: 'test results', style: 'error', body: LONG_BODY}),
      ]}
    />
  ),
};

export const DataStates: Story = {
  render: () => {
    const loaded = [annotation({id: 'a1', context: 'deploy', style: 'success'})];
    return (
      <div className="grid max-w-[1120px] gap-16 p-16 md:grid-cols-2">
        <StateExample label="Loading">
          <AnnotationsList annotations={[]} query={storyQuery({isPending: true})} />
        </StateExample>
        <StateExample label="Empty">
          <AnnotationsList annotations={[]} />
        </StateExample>
        <StateExample label="Error">
          <AnnotationsList
            annotations={[]}
            query={storyQuery({isError: true, data: undefined, error: new Error('Storybook')})}
          />
        </StateExample>
        <StateExample label="Stale">
          <AnnotationsList
            annotations={loaded}
            query={storyQuery({isError: true, error: new Error('Storybook')})}
          />
        </StateExample>
        <StateExample label="Filtered miss">
          <AnnotationsList annotations={[]} filtered filteredJobName="build" />
        </StateExample>
        <StateExample label="Truncated counts">
          <RunAnnotationSummaryLine
            summary={{...summarizeRunAnnotations(loaded), total: 500, error: 12, truncated: true}}
            workspaceSlug={WORKSPACE_SLUG}
            projectSlug={PROJECT_SLUG}
            workflowRunId={RUN_ID}
          />
        </StateExample>
      </div>
    );
  },
};

export const CountChips: Story = {
  render: () => (
    <div className="flex max-w-[1120px] flex-wrap items-center gap-12 p-16">
      {(['error', 'warning', 'info', 'success'] as const).map((style) => (
        <RunAnnotationCountChip
          key={style}
          summary={summarizeRunAnnotations([annotation({id: style, context: style, style})])}
          workspaceSlug={WORKSPACE_SLUG}
          projectSlug={PROJECT_SLUG}
          workflowRunId={RUN_ID}
          jobId={BUILD_JOB_ID}
        />
      ))}
      <RunAnnotationCountChip
        summary={{total: 500, error: 12, warning: 3, info: 0, success: 0, truncated: true}}
        workspaceSlug={WORKSPACE_SLUG}
        projectSlug={PROJECT_SLUG}
        workflowRunId={RUN_ID}
      />
    </div>
  ),
};

function AnnotationsFrame({annotations}: {annotations: RunAnnotationRecord[]}) {
  return (
    <div className="min-h-screen bg-background-neutral-base py-16">
      <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-16 px-24">
        <RunAnnotationSummaryLine
          summary={summarizeRunAnnotations(annotations)}
          workspaceSlug={WORKSPACE_SLUG}
          projectSlug={PROJECT_SLUG}
          workflowRunId={RUN_ID}
        />
        <AnnotationsList annotations={annotations} />
      </div>
    </div>
  );
}

function AnnotationsList({
  annotations,
  query = storyQuery(),
  filtered = false,
  filteredJobName,
}: {
  annotations: RunAnnotationRecord[];
  query?: RunAnnotationListQuery;
  filtered?: boolean;
  filteredJobName?: string;
}) {
  return (
    <RunAnnotationList
      query={query}
      entries={query.data === undefined ? undefined : buildRunAnnotationList({annotations, jobs})}
      workspaceSlug={WORKSPACE_SLUG}
      projectSlug={PROJECT_SLUG}
      workflowRunId={RUN_ID}
      runAttempt={1}
      filtered={filtered}
      filteredJobName={filteredJobName}
      onClearFilters={() => undefined}
    />
  );
}

function StateExample({label, children}: {label: string; children: ReactNode}) {
  return (
    <div className="flex flex-col gap-8">
      <span className="text-xs font-medium text-foreground-neutral-muted">{label}</span>
      {children}
    </div>
  );
}

function storyQuery(overrides: Partial<RunAnnotationListQuery> = {}): RunAnnotationListQuery {
  return {
    isPending: false,
    isError: false,
    isFetching: false,
    data: {pages: []},
    error: null,
    refetch: () => undefined,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: () => undefined,
    ...overrides,
  };
}

function annotation(
  overrides: Partial<RunAnnotationRecord> & {id: string; style: RunAnnotationStyle},
): RunAnnotationRecord {
  return {
    jobId: BUILD_JOB_ID,
    jobExecutionId: BUILD_EXECUTION_ID,
    originStepId: BUILD_STEP_ID,
    originStepAttempt: 1,
    context: 'default',
    sequence: 1,
    body: 'Body',
    ...overrides,
  };
}

const jobs: Job[] = [
  workflowJob({
    id: BUILD_JOB_ID,
    key: 'build',
    name: 'build',
    position: 0,
    job_executions: [
      workflowJobExecutionDto({
        id: BUILD_EXECUTION_ID,
        job_id: BUILD_JOB_ID,
        steps: [
          workflowStepDto({
            id: BUILD_STEP_ID,
            name: 'run smoke checks',
            attempts: [
              workflowStepAttemptDto({id: BUILD_ATTEMPT_ID, step_id: BUILD_STEP_ID, attempt: 1}),
            ],
          }),
        ],
      }),
    ],
  }),
  workflowJob({
    id: TEST_JOB_ID,
    key: 'test',
    name: 'test',
    position: 1,
    job_executions: [
      workflowJobExecutionDto({
        id: TEST_EXECUTION_ID,
        job_id: TEST_JOB_ID,
        steps: [
          workflowStepDto({
            id: TEST_STEP_ID,
            name: 'vitest',
            attempts: [
              workflowStepAttemptDto({id: TEST_ATTEMPT_ID, step_id: TEST_STEP_ID, attempt: 1}),
            ],
          }),
        ],
      }),
    ],
  }),
];
