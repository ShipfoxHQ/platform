import {render, screen, within} from '@testing-library/react';
import type {RunAnnotation} from '#core/run-annotation.js';
import {workflowJob, workflowJobExecutionDto} from '#test/fixtures/workflow-run.js';
import {RunAnnotationsPanel} from './run-annotations-panel.js';

describe('RunAnnotationsPanel', () => {
  it('renders a counted run annotation panel grouped by job execution', () => {
    const firstExecution = workflowJobExecutionDto({
      id: 'execution-1',
      job_id: 'job-1',
      sequence: 1,
      status: 'succeeded',
    });
    const secondExecution = workflowJobExecutionDto({
      id: 'execution-2',
      job_id: 'job-1',
      sequence: 2,
      status: 'failed',
    });
    const jobs = [
      workflowJob({
        id: 'job-1',
        name: 'build',
        job_executions: [firstExecution, secondExecution],
      }),
    ];

    render(
      <RunAnnotationsPanel
        jobs={jobs}
        annotations={[
          runAnnotation({id: 'second', jobExecutionId: 'execution-2', body: 'Second note'}),
          runAnnotation({id: 'first', jobExecutionId: 'execution-1', body: 'First note'}),
        ]}
      />,
    );

    const region = screen.getByRole('region', {name: 'Run annotations'});
    expect(within(region).getByRole('heading', {name: 'Run annotations'})).toBeInTheDocument();
    expect(within(region).getByText('2')).toBeInTheDocument();
    expect(within(region).getByText('build #1')).toBeInTheDocument();
    expect(within(region).getByText('build #2')).toBeInTheDocument();
    expect(within(region).getByText('First note')).toBeInTheDocument();
    expect(within(region).getByText('Second note')).toBeInTheDocument();
  });

  it('renders nothing when there are no grouped annotations', () => {
    const {container} = render(
      <RunAnnotationsPanel
        jobs={[workflowJob({id: 'job-1', job_executions: []})]}
        annotations={[runAnnotation({jobExecutionId: 'unknown-execution'})]}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});

function runAnnotation(overrides: Partial<RunAnnotation> = {}): RunAnnotation {
  return {
    id: 'annotation-1',
    jobId: 'job-1',
    jobExecutionId: 'execution-1',
    originStepId: 'step-1',
    originStepAttempt: 1,
    context: 'summary',
    style: 'default',
    sequence: 1,
    body: 'Annotation body',
    ...overrides,
  };
}
