import {render, screen} from '@testing-library/react';
import type {RunAnnotation} from '#core/run-annotation.js';
import {JobAnnotations} from './job-annotations.js';

describe('JobAnnotations', () => {
  it('renders annotations for the selected job execution', () => {
    render(
      <JobAnnotations
        jobExecutionId="execution-1"
        annotations={[
          runAnnotation({jobExecutionId: 'execution-1', body: 'Selected job note'}),
          runAnnotation({id: 'other', jobExecutionId: 'execution-2', body: 'Other job note'}),
        ]}
      />,
    );

    expect(screen.getByRole('region', {name: 'Job annotations'})).toBeInTheDocument();
    expect(screen.getByRole('heading', {name: 'Job annotations'})).toBeInTheDocument();
    expect(screen.getByText('Selected job note')).toBeInTheDocument();
    expect(screen.queryByText('Other job note')).not.toBeInTheDocument();
  });

  it('renders nothing when the selected job execution has no annotations', () => {
    const {container} = render(
      <JobAnnotations
        jobExecutionId="execution-1"
        annotations={[runAnnotation({jobExecutionId: 'execution-2'})]}
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
