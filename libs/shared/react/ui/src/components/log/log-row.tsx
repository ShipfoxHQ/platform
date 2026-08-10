'use client';

import {cva, type VariantProps} from 'class-variance-authority';
import type {ComponentProps} from 'react';
import {cn} from '#utils/cn.js';
import {LogRowFrame} from './log-row-frame.js';

const logRowTone = cva('', {
  variants: {
    tone: {
      default: '',
      // Keep status on the semantic edge; full-row status fills break log rhythm
      // and violate the Shape-Not-Just-Color Rule in DESIGN.md.
      error: 'shadow-[inset_2px_0_0_var(--tag-error-icon)]',
      warning: 'shadow-[inset_2px_0_0_var(--tag-warning-icon)]',
      success: 'shadow-[inset_2px_0_0_var(--tag-success-icon)]',
      info: 'shadow-[inset_2px_0_0_var(--tag-blue-icon)]',
      // Reserve brand orange for the `selected` affordance; the agent/highlight
      // tone reads violet, matching the agent mock and staying clear of warning.
      accent: 'shadow-[inset_2px_0_0_var(--tag-purple-icon)]',
    },
  },
  defaultVariants: {tone: 'default'},
});

export type LogRowTone = NonNullable<VariantProps<typeof logRowTone>['tone']>;

export interface LogRowProps extends ComponentProps<'div'> {
  /** Gutter number; `null` renders a blank cell (used by markers). */
  lineNumber?: number | null;
  /** Row time; the container's mode formats it. `null` renders a blank cell. */
  timestamp?: Date | null;
  tone?: LogRowTone;
  /** Nesting depth level; resolved to px via the container's `indentStep`. */
  indent?: number;
  selected?: boolean;
  /** Override the container's soft-wrap for this row. */
  wrap?: boolean;
}

/**
 * Primitive output-line renderer. It layers a row `tone` on top of the shared
 * `LogRowFrame` (gutter, timestamp, indent, selected, wrap context) but does not
 * inspect or reshape its children.
 */
export function LogRow({className, children, tone = 'default', ...props}: LogRowProps) {
  return (
    <LogRowFrame className={cn(logRowTone({tone}), className)} {...props}>
      {children}
    </LogRowFrame>
  );
}
