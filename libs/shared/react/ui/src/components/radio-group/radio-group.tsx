'use client';

import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import type {ComponentProps} from 'react';
import {cn} from '#utils/cn.js';

export function RadioGroup({className, ...props}: ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return <RadioGroupPrimitive.Root className={cn('flex flex-col gap-8', className)} {...props} />;
}

export function RadioGroupItem({
  className,
  children,
  ...props
}: ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      className={cn(
        'flex min-w-0 items-center gap-inline rounded-8 border border-border-neutral-base bg-background-button-neutral-default p-14 text-left text-foreground-neutral-base shadow-button-neutral transition-colors outline-none cursor-pointer',
        'hover:bg-background-button-neutral-hover active:bg-background-button-neutral-pressed',
        'data-[state=checked]:border-border-highlights-interactive data-[state=checked]:shadow-border-interactive-with-active',
        'focus-visible:shadow-border-interactive-with-active',
        'disabled:cursor-not-allowed disabled:bg-background-neutral-disabled disabled:text-foreground-neutral-disabled disabled:shadow-none',
        className,
      )}
      {...props}
    >
      <div
        aria-hidden="true"
        className="flex size-16 shrink-0 items-center justify-center rounded-full border border-border-neutral-base"
      >
        <RadioGroupPrimitive.Indicator className="size-8 rounded-full bg-background-highlight-interactive" />
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </RadioGroupPrimitive.Item>
  );
}
