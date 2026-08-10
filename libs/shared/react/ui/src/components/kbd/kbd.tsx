import type {ComponentProps} from 'react';
import {cn} from '#utils/cn.js';

type KbdProps = ComponentProps<'kbd'>;

export function Kbd({className, ...props}: KbdProps) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        'pointer-events-none inline-flex h-20 w-fit min-w-20 items-center justify-center gap-1 rounded-4 px-4 font-display text-xs font-medium select-none',
        'bg-background-components-base text-foreground-neutral-subtle border border-border-neutral-base shadow-button-neutral',
        '[&_svg:not([class*="size-"])]:size-12',
        'in-data-[slot=tooltip-content]:bg-background-kbd-tooltip in-data-[slot=tooltip-content]:text-background',
        className,
      )}
      {...props}
    />
  );
}

type KbdGroupProps = ComponentProps<'div'>;

export function KbdGroup({className, ...props}: KbdGroupProps) {
  return (
    <div
      data-slot="kbd-group"
      className={cn('inline-flex items-center gap-4', className)}
      {...props}
    />
  );
}
