import {render} from '@testing-library/react';
import {EmptyState} from './empty-state.js';

describe('EmptyState', () => {
  test('fills a panel body when using the panel variant', () => {
    const {container} = render(
      <EmptyState variant="panel" title="No runs yet" data-testid="empty-state" />,
    );

    const state = container.querySelector('[data-testid="empty-state"]');

    expect(state?.getAttribute('data-variant')).toBe('panel');
    expect(state?.classList.contains('min-h-120')).toBe(true);
    expect(state?.classList.contains('w-full')).toBe(true);
    expect(state?.classList.contains('p-panel')).toBe(true);
  });
});
