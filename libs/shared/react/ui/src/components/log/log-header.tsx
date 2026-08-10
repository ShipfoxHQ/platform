import type {ComponentProps, ReactNode} from 'react';
import {cn} from '#utils/cn.js';

export interface LogHeaderProps extends ComponentProps<'div'> {
  /** Right-aligned metadata slot, such as usage, model name, or duration. */
  end?: ReactNode;
}

/**
 * Optional header line inside a row body. Omit it for plain output lines.
 */
export function LogHeader({className, children, end, ...props}: LogHeaderProps) {
  return (
    <div
      data-slot="log-header"
      className={cn('flex items-center gap-8 leading-20', className)}
      {...props}
    >
      <div className="flex min-w-0 items-center gap-6">{children}</div>
      {end != null && (
        <div className="ml-auto flex items-center gap-8 text-foreground-contrast-secondary tabular-nums">
          {end}
        </div>
      )}
    </div>
  );
}
