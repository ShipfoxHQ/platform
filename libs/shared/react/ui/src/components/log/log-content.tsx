'use client';

import {cva, type VariantProps} from 'class-variance-authority';
import type {ComponentProps, ReactNode} from 'react';
import {cn} from '#utils/cn.js';
import {parseAnsi} from './ansi.js';
import {useLogRowContext, useLogRowsContext} from './log-context.js';

const logContentVariants = cva('block leading-20', {
  variants: {
    variant: {
      text: 'font-display whitespace-normal break-words',
      code: 'font-code',
    },
  },
  defaultVariants: {variant: 'text'},
});

export interface LogContentProps
  extends Omit<ComponentProps<'span'>, 'children'>,
    VariantProps<typeof logContentVariants> {
  children?: ReactNode;
  /** Only string children are parsed; custom elements pass through unchanged. */
  ansi?: boolean;
  /** Override soft-wrap for this content. */
  wrap?: boolean;
}

/**
 * Body content for prose or terminal-style output. The code variant preserves
 * whitespace and can parse ANSI SGR escapes when `ansi` is enabled.
 *
 * When the code variant soft-wraps, continuation lines get a hanging indent so
 * a wrapped line reads as one logical line rather than a blank-gutter marker
 * row. When it does not wrap, the line scrolls horizontally and a right-edge
 * fade marks any line that runs past the edge, so a truncated line is never
 * silently clipped. Both cues are pure CSS and self-revealing: a line that
 * fits, or does not wrap, is left untouched.
 */
export function LogContent({
  className,
  children,
  variant = 'text',
  ansi = false,
  wrap,
  ...props
}: LogContentProps) {
  const rowsContext = useLogRowsContext();
  const rowContext = useLogRowContext();
  const resolvedWrap = wrap ?? rowContext?.wrap ?? rowsContext.wrap;

  let codeStyling = '';
  if (variant === 'code') {
    codeStyling = resolvedWrap
      ? 'whitespace-pre-wrap break-words pl-[2ch] [text-indent:-2ch]'
      : 'w-full overflow-x-auto scrollbar whitespace-pre [mask-image:linear-gradient(to_right,#000_calc(100%_-_1.5rem),transparent)]';
  }

  const body =
    ansi && typeof children === 'string'
      ? parseAnsi(children).map((span) => (
          <span key={span.start} className={span.className || undefined}>
            {span.text}
          </span>
        ))
      : children;

  return (
    <span
      data-slot="log-content"
      className={cn(logContentVariants({variant}), codeStyling, className)}
      {...props}
    >
      {body}
    </span>
  );
}
