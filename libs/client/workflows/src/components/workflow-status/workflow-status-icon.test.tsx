import {render, screen} from '@testing-library/react';
import {WorkflowStatusIcon} from './workflow-status-icon.js';

describe('WorkflowStatusIcon', () => {
  test('keeps a running status as a dot', () => {
    const {container} = render(<WorkflowStatusIcon status="running" tooltip={false} />);

    expect(screen.getByRole('img', {name: 'Running'})).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeNull();
  });

  test('uses the pulse glyph for the listening status', () => {
    const {container} = render(<WorkflowStatusIcon status="listening" tooltip={false} />);

    expect(screen.getByRole('img', {name: 'Listening'})).toBeInTheDocument();
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
