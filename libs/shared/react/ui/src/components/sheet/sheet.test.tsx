import {render, screen} from '@testing-library/react';
import {Sheet, SheetContent, SheetHeader, SheetTitle} from './sheet.js';

describe('Sheet', () => {
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  test('names the close control and uses the canonical neutral focus treatment', () => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }) as unknown as typeof window.matchMedia;

    render(
      <Sheet open>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Filters</SheetTitle>
          </SheetHeader>
        </SheetContent>
      </Sheet>,
    );

    const close = screen.getByRole('button', {name: 'Close'});

    expect(close.classList.contains('focus-visible:shadow-button-neutral-focus')).toBe(true);
  });
});
