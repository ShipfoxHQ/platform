'use client';

import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import type {ComponentProps} from 'react';
import {cn} from '#utils/cn.js';
import {Skeleton} from '../skeleton/index.js';

/**
 * The resting surface shared by an item and its skeleton, so a loading grid
 * never re-derives the box.
 */
const ITEM_SURFACE_CLASS =
  'flex min-w-0 items-center gap-cluster rounded-8 border border-border-neutral-base bg-background-neutral-base px-row py-row text-left text-foreground-neutral-base shadow-button-neutral';

const INDICATOR_CLASS =
  'flex size-16 shrink-0 items-center justify-center rounded-full border border-border-neutral-base';

export function RadioGroup({className, ...props}: ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root className={cn('flex flex-col gap-inline', className)} {...props} />
  );
}

export function RadioGroupItem({
  className,
  children,
  ...props
}: ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      className={cn(
        ITEM_SURFACE_CLASS,
        'group/radio cursor-pointer outline-none transition-[background-color,border-color,box-shadow]',
        'hover:bg-background-neutral-hover',
        // Selection is carried by the border and the indicator dot, never by the
        // shadow. That leaves `box-shadow` free to mean focus and only focus, so
        // tabbing onto the already-checked item still shows a ring.
        'data-[state=checked]:border-border-highlights-interactive',
        'focus-visible:shadow-button-neutral-focus',
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
}

export function RadioGroupItemSkeleton({
  className,
  labelClassName,
  ...props
}: RadioGroupItemSkeletonProps) {
  return (
    <div aria-hidden="true" className={cn(ITEM_SURFACE_CLASS, className)} {...props}>
      <span data-slot="radio-indicator" className={INDICATOR_CLASS} />
      <Skeleton className={cn('h-16 flex-1', labelClassName)} />
    </div>
  );
}
