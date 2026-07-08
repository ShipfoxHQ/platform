import {render, screen} from '@testing-library/react';
import type {RunAnnotation} from '#core/run-annotation.js';
import {StepAnnotations} from './step-annotations.js';

describe('StepAnnotations', () => {
  it('renders annotations for the selected step attempt', () => {
    render(
      <StepAnnotations
        stepId="step-1"
        attempt={2}
        annotations={[
          runAnnotation({originStepId: 'step-1', originStepAttempt: 2, body: 'Step note'}),
          runAnnotation({
            id: 'other',
            originStepId: 'step-1',
            originStepAttempt: 1,
            body: 'Other attempt note',
          }),
        ]}
      />,
    );

    expect(screen.getByRole('region', {name: 'Step annotations'})).toBeInTheDocument();
    expect(screen.getByRole('heading', {name: 'Step annotations'})).toBeInTheDocument();
    expect(screen.getByText('Step note')).toBeInTheDocument();
    expect(screen.queryByText('Other attempt note')).not.toBeInTheDocument();
  });

  it('renders nothing when the selected step attempt has no annotations', () => {
    const {container} = render(
      <StepAnnotations
        stepId="step-1"
        attempt={1}
        annotations={[runAnnotation({originStepId: 'step-2'})]}
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
