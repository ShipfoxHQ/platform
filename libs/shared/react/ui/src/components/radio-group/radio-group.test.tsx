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
