import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {RunAnnotation} from '#core/run-annotation.js';
import {AnnotationCardBlock} from './annotation-card-block.js';

const VISIBLE_BODY_PATTERN = /visible/;
const HIDDEN_TAIL_PATTERN = /hidden tail/;

describe('AnnotationCardBlock', () => {
  it('truncates large annotation bodies before expanding on demand', async () => {
    const user = userEvent.setup();
    const annotation = runAnnotation({
      body: `${'visible '.repeat(1_500)}hidden tail`,
    });

    render(<AnnotationCardBlock annotation={annotation} />);

    expect(screen.getByText(VISIBLE_BODY_PATTERN)).toBeInTheDocument();
    expect(screen.queryByText(HIDDEN_TAIL_PATTERN)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', {name: 'Show more'}));

    expect(screen.getByText(HIDDEN_TAIL_PATTERN)).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Show less'})).toBeInTheDocument();
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
