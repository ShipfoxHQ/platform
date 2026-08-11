import {render} from '@testing-library/react';
import {EmptyState} from './empty-state.js';

describe('EmptyState', () => {
  test('fills a panel body when using the panel variant', () => {
    const {container} = render(
      <EmptyState variant="panel" title="No runs yet" data-testid="empty-state" />,
    );

    const state = container.querySelector('[data-testid="empty-state"]');

    expect(state?.getAttribute('data-variant')).toBe('panel');
    for (const className of [
      'min-h-120',
      'w-full',
      'flex-1',
      'flex-col',
      'items-center',
      'justify-center',
      'gap-12',
      'p-panel',
    ]) {
      expect(state?.classList.contains(className)).toBe(true);
    }
    expect(state?.querySelector('.space-y-4')).not.toBeNull();
  });

  test('keeps the default layout when no variant is provided', () => {
    const {container} = render(<EmptyState title="No runs yet" data-testid="empty-state" />);

    const state = container.querySelector('[data-testid="empty-state"]');

    expect(state?.getAttribute('data-variant')).toBe('default');
    expect(state?.classList.contains('min-h-120')).toBe(false);
    expect(state?.classList.contains('p-panel')).toBe(false);
  });
});
