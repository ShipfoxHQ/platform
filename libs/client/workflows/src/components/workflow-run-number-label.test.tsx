import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {formatWorkflowRunNumberLabel, WorkflowRunNumberLabel} from './workflow-run-number-label.js';

describe('WorkflowRunNumberLabel', () => {
  test('formats the workflow name and run number together', () => {
    expect(formatWorkflowRunNumberLabel({workflowName: 'CI', number: 5184})).toBe('CI #5184');
  });

  test('shows the bare number when the run name already says the workflow name', () => {
    render(<WorkflowRunNumberLabel run={{name: 'CI', workflowName: 'CI', number: 5184}} />);

    expect(screen.getByText('#5184')).toBeInTheDocument();
    expect(screen.queryByText('CI #5184')).not.toBeInTheDocument();
  });

  test('keeps the workflow name when the run carries a different one', () => {
    render(
      <WorkflowRunNumberLabel
        run={{name: 'Deploy production', workflowName: 'CI', number: 5184}}
      />,
    );

    expect(screen.getByText('CI #5184')).toBeInTheDocument();
  });

  test('does not render before a server run number is available', () => {
    const {container} = render(<WorkflowRunNumberLabel run={{workflowName: 'CI', number: null}} />);

    expect(container.firstChild).toBeNull();
  });

  test('provides a tooltip for long workflow labels', async () => {
    const user = userEvent.setup();
    const label = 'release-production-multi-region-with-canary-and-smoke-tests #5184';
    render(<WorkflowRunNumberLabel run={{workflowName: label.slice(0, -6), number: 5184}} />);

    const visibleLabel = screen.getByText(label);
    expect(visibleLabel).toHaveClass('max-w-[240px]', 'truncate');

    await user.hover(visibleLabel);

    expect(await screen.findByRole('tooltip')).toHaveTextContent(label);
  });
});
