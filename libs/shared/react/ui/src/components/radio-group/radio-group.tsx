'use client';

import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import {type ComponentProps, createContext, useContext} from 'react';
import {cn} from '#utils/cn.js';
import {PanelGrid} from '../panel/index.js';
import {Skeleton} from '../skeleton/index.js';

/**
 * `card` stands on its own surface, for a picker on the canvas. `cell` drops the
 * frame for a picker inside a panel, where a bordered tile would repeat the
 * panel's own border, fill, radius, and shadow.
 */
export type RadioGroupVariant = 'card' | 'cell';

const RadioGroupVariantContext = createContext<RadioGroupVariant>('card');

/** The resting box shared by an item and its skeleton, per variant. */
const ITEM_SURFACE_CLASS: Record<RadioGroupVariant, string> = {
  card: 'flex min-w-0 items-center gap-cluster rounded-8 border border-border-neutral-base bg-background-neutral-base px-row py-row text-left text-foreground-neutral-base shadow-button-neutral',
  cell: 'flex min-w-0 items-center gap-cluster bg-background-neutral-base px-row py-row text-left text-foreground-neutral-base',
};

const INDICATOR_CLASS =
  'flex size-16 shrink-0 items-center justify-center rounded-full border border-border-neutral-base';

export interface RadioGroupProps extends ComponentProps<typeof RadioGroupPrimitive.Root> {
  variant?: RadioGroupVariant;
}

export function RadioGroup({className, variant = 'card', children, ...props}: RadioGroupProps) {
  if (variant === 'cell') {
    return (
      <RadioGroupVariantContext.Provider value={variant}>
        {/* The grid is the radio group itself: a Radix item is a button, which
            cannot be a child of the `ul` a plain PanelGrid renders. */}
        <RadioGroupPrimitive.Root asChild {...props}>
          <PanelGrid as="div" className={className}>
            {children}
          </PanelGrid>
        </RadioGroupPrimitive.Root>
      </RadioGroupVariantContext.Provider>
    );
  }

  return (
    <RadioGroupVariantContext.Provider value={variant}>
      <RadioGroupPrimitive.Root className={cn('flex flex-col gap-inline', className)} {...props}>
        {children}
      </RadioGroupPrimitive.Root>
    </RadioGroupVariantContext.Provider>
  );
}

export function RadioGroupItem({
  className,
  children,
  ...props
}: ComponentProps<typeof RadioGroupPrimitive.Item>) {
  const variant = useContext(RadioGroupVariantContext);

  return (
    <RadioGroupPrimitive.Item
      className={cn(
        ITEM_SURFACE_CLASS[variant],
        'group/radio cursor-pointer outline-none transition-[background-color,border-color,box-shadow,outline-color]',
        'hover:bg-background-neutral-hover',
        // Selection is carried by the border and the indicator dot, never by the
        // shadow. That leaves `box-shadow` free to mean focus and only focus, so
        // tabbing onto the already-checked item still shows a ring.
        variant === 'card'
          ? 'data-[state=checked]:border-border-highlights-interactive'
          : // A cell has no resting frame, so selection draws an outline, which
            // is layout-neutral and does not fight the grid's own hairlines.
            'data-[state=checked]:outline data-[state=checked]:-outline-offset-1 data-[state=checked]:outline-border-highlights-interactive data-[state=checked]:focus-visible:outline data-[state=checked]:focus-visible:outline-border-highlights-interactive',
        variant === 'card'
          ? 'focus-visible:shadow-button-neutral-focus'
          : // Cells run edge to edge inside the panel, whose `overflow-hidden`
            // crops an outset ring.
            'focus-visible:shadow-focus-inset focus-visible:outline-none',
        'data-[disabled]:cursor-not-allowed data-[disabled]:border-border-neutral-base data-[disabled]:bg-background-neutral-disabled data-[disabled]:text-foreground-neutral-disabled data-[disabled]:shadow-none',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        data-slot="radio-indicator"
        className={cn(
          INDICATOR_CLASS,
          'transition-colors group-data-[state=checked]/radio:border-border-highlights-interactive',
        )}
      >
        <RadioGroupPrimitive.Indicator
          data-slot="radio-indicator-dot"
          className="size-8 rounded-full bg-background-highlight-interactive data-[disabled]:bg-foreground-neutral-disabled"
        />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">{children}</span>
    </RadioGroupPrimitive.Item>
  );
}

export interface RadioGroupItemSkeletonProps extends ComponentProps<'div'> {
  /** Vary this across a loading grid so the placeholders do not read as a stencil. */
  labelClassName?: string;
  variant?: RadioGroupVariant;
}

export function RadioGroupItemSkeleton({
  className,
  labelClassName,
  variant = 'card',
  ...props
}: RadioGroupItemSkeletonProps) {
  return (
    <div aria-hidden="true" className={cn(ITEM_SURFACE_CLASS[variant], className)} {...props}>
      <span data-slot="radio-indicator" className={INDICATOR_CLASS} />
      {/* `w-full`, not `flex-1`: a flex basis of 0 would beat any width passed in
          and every placeholder would come out the same length. */}
      <Skeleton className={cn('h-16 w-full', labelClassName)} />
    </div>
  );
}
