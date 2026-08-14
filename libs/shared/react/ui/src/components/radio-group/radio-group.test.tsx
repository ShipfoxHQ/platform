import {fireEvent, render, screen} from '@testing-library/react';
import {RadioGroup, RadioGroupItem, RadioGroupItemSkeleton} from './radio-group.js';

function renderGroup(defaultValue: string) {
  return render(
    <RadioGroup defaultValue={defaultValue}>
      <RadioGroupItem value="default">Default</RadioGroupItem>
      <RadioGroupItem value="selected">Selected</RadioGroupItem>
    </RadioGroup>,
  );
}

describe('RadioGroupItem', () => {
  test('rests on an opaque surface so the fill does not shift with the parent', () => {
    renderGroup('selected');

    const item = screen.getByRole('radio', {name: 'Default'});

    expect(item.classList.contains('bg-background-neutral-base')).toBe(true);
    expect(item.classList.contains('hover:bg-background-neutral-hover')).toBe(true);
    expect(item.classList.contains('shadow-button-neutral')).toBe(true);
  });

  test('keeps the focus ring reachable on the checked item', () => {
    renderGroup('selected');

    const checked = screen.getByRole('radio', {name: 'Selected'});

    // Radix uses a roving tabindex, so the checked item is the first thing a
    // keyboard user lands on. Selection must not consume `box-shadow`, or that
    // tab stop would render no focus indicator at all.
    expect(checked.classList.contains('focus-visible:shadow-button-neutral-focus')).toBe(true);
    expect(
      [...checked.classList].some((token) => token.startsWith('data-[state=checked]:shadow-')),
    ).toBe(false);
    expect(checked.classList.contains('shadow-button-neutral')).toBe(true);
  });

  test('marks selection with a border and an indicator dot, not colour alone', () => {
    renderGroup('selected');

    const unselected = screen.getByRole('radio', {name: 'Default'});
    const selected = screen.getByRole('radio', {name: 'Selected'});

    expect(
      selected.classList.contains('data-[state=checked]:border-border-highlights-interactive'),
    ).toBe(true);
    expect(
      selected
        .querySelector('[data-slot="radio-indicator"]')
        ?.classList.contains(
          'group-data-[state=checked]/radio:border-border-highlights-interactive',
        ),
    ).toBe(true);
    expect(selected.querySelector('[data-slot="radio-indicator-dot"]')).not.toBeNull();
    expect(unselected.querySelector('[data-slot="radio-indicator-dot"]')).toBeNull();
  });

  test('moves the indicator dot when another item is chosen', () => {
    renderGroup('default');

    const target = screen.getByRole('radio', {name: 'Selected'});
    const previous = screen.getByRole('radio', {name: 'Default'});

    fireEvent.click(target);

    expect(target.getAttribute('data-state')).toBe('checked');
    expect(target.querySelector('[data-slot="radio-indicator-dot"]')).not.toBeNull();
    expect(previous.getAttribute('data-state')).toBe('unchecked');
    expect(previous.querySelector('[data-slot="radio-indicator-dot"]')).toBeNull();
  });
});

// The resting box a loading placeholder has to match. Listing it here is what
// makes a change to the item's padding or fill fail the suite instead of
// silently desynchronising the skeleton.
const SURFACE_TOKENS = [
  'rounded-8',
  'border',
  'border-border-neutral-base',
  'bg-background-neutral-base',
  'px-row',
  'py-row',
  'shadow-button-neutral',
  'gap-cluster',
];

describe('RadioGroup variant="cell"', () => {
  test('drops the tile frame so it does not repeat the panel it sits in', () => {
    render(
      <RadioGroup variant="cell" defaultValue="a">
        <RadioGroupItem value="a">One</RadioGroupItem>
        <RadioGroupItem value="b">Two</RadioGroupItem>
      </RadioGroup>,
    );

    const item = screen.getByRole('radio', {name: 'One'});

    // Panel already owns these four; repeating them is a frame inside a frame.
    expect(item.classList.contains('rounded-8')).toBe(false);
    expect(item.classList.contains('border')).toBe(false);
    expect(item.classList.contains('shadow-button-neutral')).toBe(false);
    expect(item.classList.contains('bg-background-neutral-base')).toBe(true);
  });

  test('marks selection with an outline, leaving box-shadow to mean focus', () => {
    render(
      <RadioGroup variant="cell" defaultValue="a">
        <RadioGroupItem value="a">One</RadioGroupItem>
      </RadioGroup>,
    );

    const item = screen.getByRole('radio', {name: 'One'});

    expect(
      item.classList.contains('data-[state=checked]:outline-border-highlights-interactive'),
    ).toBe(true);
    expect(item.classList.contains('focus-visible:shadow-focus-inset')).toBe(true);
    expect(
      [...item.classList].some((token) => token.startsWith('data-[state=checked]:shadow-')),
    ).toBe(false);
  });

  test('keeps its dividers when a form makes Radix add hidden bubble inputs', () => {
    // Radix's bubble input measures itself, which jsdom cannot do.
    const originalResizeObserver = window.ResizeObserver;
    window.ResizeObserver = class {
      observe() {
        return undefined;
      }
      unobserve() {
        return undefined;
      }
      disconnect() {
        return undefined;
      }
    } as unknown as typeof ResizeObserver;

    const {container} = render(
      <form>
        <RadioGroup variant="cell" defaultValue="a">
          <RadioGroupItem value="a">One</RadioGroupItem>
          <RadioGroupItem value="b">Two</RadioGroupItem>
        </RadioGroup>
      </form>,
    );

    const grid = container.querySelector('[data-slot="panel-grid"]');

    // Inside a form each item renders a button plus a hidden input, so the DOM
    // children are BUTTON,INPUT,BUTTON,INPUT. A plain `nth-child(2n)` would put
    // the column divider on the invisible inputs and the second cell would show
    // no separator at all.
    expect([...(grid?.children ?? [])].map((child) => child.tagName)).toEqual([
      'BUTTON',
      'INPUT',
      'BUTTON',
      'INPUT',
    ]);
    expect(
      grid?.classList.contains('min-[760px]:[&>*:nth-child(2n_of_:not(input))]:border-l'),
    ).toBe(true);

    window.ResizeObserver = originalResizeObserver;
  });

  test('is the grid itself, so the radio buttons are the cells', () => {
    const {container} = render(
      <RadioGroup variant="cell" defaultValue="a">
        <RadioGroupItem value="a">One</RadioGroupItem>
        <RadioGroupItem value="b">Two</RadioGroupItem>
        <RadioGroupItem value="c">Three</RadioGroupItem>
      </RadioGroup>,
    );

    const grid = container.querySelector('[data-slot="panel-grid"]');

    // A Radix item is a button, which cannot be a child of a `ul`.
    expect(grid?.tagName).toBe('DIV');
    expect(grid?.getAttribute('role')).toBe('radiogroup');
    // The odd count is padded, as in any other panel grid.
    expect(grid?.querySelector('[data-slot="panel-cell-filler"]')?.tagName).toBe('DIV');
  });
});

describe('RadioGroupItemSkeleton', () => {
  test('mirrors the item surface so a loading grid cannot drift from it', () => {
    const {container} = render(<RadioGroupItemSkeleton labelClassName="w-64" />);
    const skeleton = container.firstElementChild;

    renderGroup('default');
    const item = screen.getByRole('radio', {name: 'Default'});

    for (const token of SURFACE_TOKENS) {
      expect(item.classList.contains(token)).toBe(true);
      expect(skeleton?.classList.contains(token)).toBe(true);
    }

    expect(skeleton?.getAttribute('aria-hidden')).toBe('true');
    expect(skeleton?.querySelector('[data-slot="radio-indicator"]')).not.toBeNull();
  });

  test('lets the caller vary the bar width across a loading grid', () => {
    const {container} = render(
      <>
        <RadioGroupItemSkeleton labelClassName="w-64" />
        <RadioGroupItemSkeleton labelClassName="w-112" />
      </>,
    );

    const bars = container.querySelectorAll('[data-slot="skeleton"]');

    // A `flex-1` basis would collapse every supplied width to the same length.
    expect(bars[0]?.classList.contains('w-64')).toBe(true);
    expect(bars[1]?.classList.contains('w-112')).toBe(true);
    for (const bar of bars) {
      expect(bar.classList.contains('flex-1')).toBe(false);
    }
  });
});
