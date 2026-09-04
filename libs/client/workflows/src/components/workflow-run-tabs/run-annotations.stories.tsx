import {Panel, PanelHeader} from '@shipfox/react-ui/panel';
import type {Meta, StoryObj} from '@storybook/react';
import type {ReactNode} from 'react';
import {
  buildRunAnnotationList,
  type RunAnnotationRecord,
  type RunAnnotationStyle,
  summarizeRunAnnotations,
} from '#core/run-annotation.js';
import {runAnnotationEntryFixture} from '#test/fixtures/workflow-run.js';
import {RunAnnotationCountChip} from './run-annotation-count-chip.js';
import {
  type DerivedRunAnnotation,
  RunAnnotationList,
  type RunAnnotationListQuery,
} from './run-annotation-list.js';
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

const LONG_BODY = [
  '### Failing specs',
  '',
  ...Array.from(
    {length: 40},
    (_unused, index) => `- \`packages/web/src/route-${index}.test.ts\` expected 200, received 503`,
  ),
].join('\n');

/**
 * An agent step with no `name` is labelled by its prompt, which the server has already cut.
 * The row must hold that to one line rather than letting a severed sentence sprawl.
 */
const UNNAMED_AGENT_STEP = 'claude-fable-5 · Reply to this prompt with exactly "Hello world". Then';

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
      // No context of its own: the server minted the key from the failing step, so the row falls
      // back to naming its job.
      annotation({
        id: 'a5',
        context: `failure:step:${BUILD_STEP_ID}`,
        style: 'error',
        sequence: 5,
        body: '**Step failed**\n\nReason: `agent_config_invalid`\nExit code: `none`\n\nHarness "claude" only supports provider "anthropic"; received "shipfox".',
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

    return (
      <AnnotationsFrame
        annotations={annotations}
        derivedAnnotations={[
          {
            id: 'derived-deploy',
            jobId: '44444444-4444-4444-8444-00000000000d',
            jobPosition: 2,
            style: 'default',
            statusLabel: 'Skipped',
            jobName: 'deploy production',
            body: 'A required job did not succeed, so this job did not run.',
          },
        ]}
      />
    );
  },
};

export const BoundedBody: Story = {
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
        {/* A filtered miss while a page is still unread says so, and offers the fetch that could
            still find a match. The two states share a panel and must not read as the same one. */}
        <StateExample label="Filtered miss, page unread">
          <AnnotationsList
            annotations={[]}
            filtered
            filteredSeverity="error"
            query={storyQuery({hasNextPage: true})}
          />
        </StateExample>
        {/* The footer band against the last row: `border-t` meeting `last:border-b-0` is one
            hairline or two, and only a capture with rows above it shows which.
            The sibling "Show N more of M" band is the same chrome with a different label, and its
            counting is pinned by a unit test, so it is not captured here at 25 rows. */}
        <StateExample label="Another page to load">
          <AnnotationsList
            annotations={[
              annotation({id: 'p1', context: 'deploy', style: 'success'}),
              annotation({id: 'p2', context: 'coverage', style: 'info', sequence: 2}),
            ]}
            query={storyQuery({hasNextPage: true})}
          />
        </StateExample>
        {/* `default` carries no severity, so it is the one style with a neutral glyph and nothing
            announced to a screen reader. */}
        <StateExample label="No severity">
          <AnnotationsList
            annotations={[annotation({id: 'plain', context: 'release notes', style: 'default'})]}
          />
        </StateExample>
        <StateExample label="Unnamed agent step">
          <AnnotationsList
            annotations={[
              annotation({
                id: 'unnamed',
                context: `failure:step:${TEST_STEP_ID}`,
                style: 'error',
                jobId: TEST_JOB_ID,
                jobExecutionId: TEST_EXECUTION_ID,
                originStepId: TEST_STEP_ID,
                body: 'Reason: `agent_config_invalid`',
              }),
            ]}
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

function AnnotationsFrame({
  annotations,
  derivedAnnotations,
}: {
  annotations: RunAnnotationRecord[];
  derivedAnnotations?: readonly DerivedRunAnnotation[];
}) {
  return (
    <div className="min-h-screen bg-background-subtle-base py-16">
      <div className="mx-auto flex w-full max-w-[1120px] flex-col px-24">
        <AnnotationsList
          annotations={annotations}
          derivedAnnotations={derivedAnnotations}
          summary={summarizeRunAnnotations(annotations)}
        />
      </div>
    </div>
  );
}

/**
 * The list is the body of a panel, so every story renders it inside one. Capturing it loose on
 * the canvas would hide the thing most likely to break: whether its rows read as cells of the
 * panel or as tiles floating inside it.
 */
function AnnotationsList({
  annotations,
  derivedAnnotations = [],
  query = storyQuery(),
  jobExplanationsQuery = storyQuery(),
  filtered = false,
  filteredJobName,
  filteredSeverity,
  summary,
}: {
  annotations: RunAnnotationRecord[];
  derivedAnnotations?: readonly DerivedRunAnnotation[];
  query?: RunAnnotationListQuery;
  jobExplanationsQuery?: RunAnnotationListQuery;
  filtered?: boolean;
  filteredJobName?: string;
  filteredSeverity?: string;
  summary?: ReturnType<typeof summarizeRunAnnotations>;
}) {
  return (
    <Panel>
      {summary ? (
        <PanelHeader className="flex-wrap">
          <RunAnnotationSummaryLine
            summary={summary}
            workspaceSlug={WORKSPACE_SLUG}
            projectSlug={PROJECT_SLUG}
            workflowRunId={RUN_ID}
          />
        </PanelHeader>
      ) : null}
      <RunAnnotationList
        query={query}
        jobExplanationsQuery={jobExplanationsQuery}
        entries={
          query.data === undefined
            ? undefined
            : buildRunAnnotationList({entries: annotations.map(annotationEntry)})
        }
        derivedAnnotations={derivedAnnotations}
        workspaceSlug={WORKSPACE_SLUG}
        projectSlug={PROJECT_SLUG}
        workflowRunId={RUN_ID}
        runAttempt={1}
        filtered={filtered}
        filteredJobName={filteredJobName}
        filteredSeverity={filteredSeverity}
        onClearFilters={() => undefined}
      />
    </Panel>
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

function annotationEntry(annotation: RunAnnotationRecord) {
  const testJob = annotation.jobId === TEST_JOB_ID;
  let jobName = testJob ? 'test' : 'build';
  let stepLabel = testJob ? 'vitest' : 'run smoke checks';
  if (annotation.id === 'unnamed') {
    jobName = 'Hello world on Anthropic models with Claude';
    stepLabel = UNNAMED_AGENT_STEP;
  }
  return runAnnotationEntryFixture(annotation, {
    jobName,
    jobPosition: testJob ? 1 : 0,
    stepLabel,
    origin: {
      stepAttemptId: testJob ? '66666666-6666-4666-8666-00000000000c' : BUILD_ATTEMPT_ID,
    },
  });
}
