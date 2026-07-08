import {Text} from '@shipfox/react-ui/typography';
import type {Meta, StoryObj} from '@storybook/react';
import type {ReactNode} from 'react';
import {userEvent, within} from 'storybook/test';
import type {RunAnnotation} from '#core/run-annotation.js';
import {workflowJob, workflowJobExecutionDto} from '#test/fixtures/workflow-run.js';
import {AnnotationCardBlock} from './annotation-card-block.js';
import {JobAnnotations} from './job-annotations.js';
import {RunAnnotationsPanel} from './run-annotations-panel.js';
import {StepAnnotations} from './step-annotations.js';

const BUILD_JOB_ID = 'job-build';
const BUILD_EXECUTION_ID = 'exec-build';
const DEPLOY_JOB_ID = 'job-deploy';
const DEPLOY_EXECUTION_ID = 'exec-deploy';
const TEST_STEP_ID = 'step-test';
const DEPLOY_STEP_ID = 'step-deploy';

const jobs = [
  workflowJob({
    id: BUILD_JOB_ID,
    name: 'build',
    status: 'succeeded',
    job_executions: [
      workflowJobExecutionDto({
        id: BUILD_EXECUTION_ID,
        job_id: BUILD_JOB_ID,
        sequence: 1,
        status: 'succeeded',
      }),
    ],
  }),
  workflowJob({
    id: DEPLOY_JOB_ID,
    name: 'deploy-production',
    status: 'failed',
    job_executions: [
      workflowJobExecutionDto({
        id: DEPLOY_EXECUTION_ID,
        job_id: DEPLOY_JOB_ID,
        sequence: 1,
        status: 'failed',
      }),
    ],
  }),
];

const annotations = [
  runAnnotation({
    id: 'annotation-build-summary',
    jobId: BUILD_JOB_ID,
    jobExecutionId: BUILD_EXECUTION_ID,
    originStepId: TEST_STEP_ID,
    context: 'test-summary',
    style: 'success',
    sequence: 1,
    body: '### Test summary\n\n- 128 passed\n- 0 failed\n- Coverage: **94.2%**',
  }),
  runAnnotation({
    id: 'annotation-deploy-warning',
    jobId: DEPLOY_JOB_ID,
    jobExecutionId: DEPLOY_EXECUTION_ID,
    originStepId: DEPLOY_STEP_ID,
    context: 'canary',
    style: 'warning',
    sequence: 1,
    body: 'Canary latency exceeded the configured threshold in `us-east-1`.',
  }),
  runAnnotation({
    id: 'annotation-deploy-error',
    jobId: DEPLOY_JOB_ID,
    jobExecutionId: DEPLOY_EXECUTION_ID,
    originStepId: DEPLOY_STEP_ID,
    context: 'rollback',
    style: 'error',
    sequence: 2,
    body: 'Rollback was triggered after the production health check failed.',
  }),
];

const meta = {
  title: 'Workflows/RunView/Annotations',
  component: RunAnnotationsPanel,
  parameters: {
    layout: 'centered',
  },
  decorators: [
    (Story) => (
      <div className="w-760 bg-background-neutral-base p-16">
        <Story />
      </div>
    ),
  ],
  args: {
    annotations,
    jobs,
  },
} satisfies Meta<typeof RunAnnotationsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: () => <RunAnnotationsPanel annotations={annotations} jobs={jobs} />,
};

export const Surfaces: Story = {
  render: () => (
    <div className="flex flex-col gap-16">
      <StorySection label="run">
        <RunAnnotationsPanel annotations={annotations} jobs={jobs} />
      </StorySection>
      <StorySection label="job">
        <div className="rounded-8 border border-border-neutral-base bg-background-components-base">
          <JobAnnotations annotations={annotations} jobExecutionId={DEPLOY_EXECUTION_ID} />
        </div>
      </StorySection>
      <StorySection label="step">
        <StepAnnotations annotations={annotations} stepId={DEPLOY_STEP_ID} attempt={1} />
      </StorySection>
    </div>
  ),
};

export const Content: Story = {
  render: () => (
    <div className="flex flex-col gap-16">
      <StorySection label="styles">
        <div className="flex flex-col gap-8">
          {(['default', 'info', 'success', 'warning', 'error'] as const).map((style) => (
            <AnnotationCardBlock
              key={style}
              annotation={runAnnotation({
                id: `annotation-${style}`,
                style,
                body: `### ${style}\n\nAnnotation body rendered with the ${style} style.`,
              })}
            />
          ))}
        </div>
      </StorySection>
      <StorySection label="long body">
        <AnnotationCardBlock annotation={longAnnotation()} />
      </StorySection>
    </div>
  ),
};

export const TestExpandedLongBody: Story = {
  render: () => <AnnotationCardBlock annotation={longAnnotation()} />,
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByRole('button', {name: 'Show more'}));
    await canvas.findByRole('button', {name: 'Show less', expanded: true});
  },
};

function StorySection({label, children}: {label: string; children: ReactNode}) {
  return (
    <div className="flex min-w-0 flex-col gap-8">
      <Text size="xs" className="font-code text-foreground-neutral-muted">
        {label}
      </Text>
      {children}
    </div>
  );
}

function longAnnotation(): RunAnnotation {
  return runAnnotation({
    id: 'annotation-long-body',
    style: 'info',
    body: `${'Long annotation output with deployment diagnostics. '.repeat(240)}Final line.`,
  });
}

function runAnnotation(overrides: Partial<RunAnnotation> = {}): RunAnnotation {
  return {
    id: 'annotation-1',
    jobId: BUILD_JOB_ID,
    jobExecutionId: BUILD_EXECUTION_ID,
    originStepId: TEST_STEP_ID,
    originStepAttempt: 1,
    context: 'summary',
    style: 'default',
    sequence: 1,
    body: 'Annotation body',
    ...overrides,
  };
}
