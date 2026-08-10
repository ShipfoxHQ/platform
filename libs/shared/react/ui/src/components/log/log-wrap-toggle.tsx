'use client';

import type {ComponentProps} from 'react';
import {cn} from '#utils/cn.js';
import {Icon} from '../icon/index.js';

export interface LogWrapToggleProps extends Omit<ComponentProps<'button'>, 'aria-pressed'> {
  /** Current row wrap state; drives `aria-pressed`, the label, and the chevron. */
  wrapped: boolean;
  /** Whether this line overrides the container's wrap, pinning the control on. */
  overridden?: boolean;
}

/**
 * Per-line wrap affordance. It reads the `group/log-row` set by `LogRow`, stays
 * pinned for overridden lines, and holds no wrap state of its own.
 */
export function LogWrapToggle({
  className,
  wrapped,
  overridden = false,
  ...props
}: LogWrapToggleProps) {
  return (
    <button
      data-slot="log-wrap-toggle"
      aria-pressed={wrapped}
      aria-label={wrapped ? 'Collapse line' : 'Wrap line'}
      className={cn(
        'flex h-20 w-20 flex-none items-center justify-center rounded-4 transition',
        'opacity-0 group-hover/log-row:opacity-100 focus-visible:opacity-100',
        overridden
          ? 'text-foreground-highlight-interactive opacity-100'
          : 'text-foreground-contrast-secondary hover:text-foreground-contrast-primary',
        className,
      )}
      {...props}
      type="button"
    >
      <Icon
        name="chevronRight"
        className={cn('size-16 transition-transform', wrapped && 'rotate-90')}
      />
    </button>
  );
}
