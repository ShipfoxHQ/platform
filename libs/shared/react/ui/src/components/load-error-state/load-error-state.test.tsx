import {render} from '@testing-library/react';
import {LoadErrorState} from './load-error-state.js';

describe('LoadErrorState', () => {
  test('passes the panel variant to its empty-state body', () => {
    const {container} = render(
      <LoadErrorState variant="panel" title="Could not load runs" onRetry={() => undefined} />,
    );

    const state = container.querySelector('[data-slot="empty-state"]');

    expect(state?.getAttribute('data-variant')).toBe('panel');
    expect(state?.classList.contains('min-h-120')).toBe(true);
  });
});
