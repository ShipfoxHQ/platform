'use client';

import type {ComponentProps} from 'react';
import {cn} from '#utils/cn.js';
import type {LogTimestampMode} from './format-timestamp.js';
import {LogRowsContextProvider} from './log-context.js';

export interface LogRowsProps extends ComponentProps<'div'> {
  timestamps?: LogTimestampMode;
  wrap?: boolean;
  showLineNumbers?: boolean;
  /** Pixels of body inset per nesting depth level; a row at level `n` insets `n * indentStep`. */
  indentStep?: number;
  /** Baseline for relative timestamps; without one, relative mode falls back to absolute time. */
  timestampOrigin?: Date;
  /** Adds a pointer shortcut to each timestamp cell, commonly used to switch rel/abs for all rows. */
  onTimestampsClick?: () => void;
}

/**
 * The scroll surface that wraps the rows. It owns nothing about what a row
 * contains; it only provides the shared defaults every `LogRow` reads
 * (timestamp mode, wrap, line numbers) and the code-surface chrome.
 */
export function LogRows({
  className,
  children,
  timestamps = 'off',
  wrap = false,
  showLineNumbers = true,
  indentStep = 16,
  timestampOrigin,
  onTimestampsClick,
  ...props
}: LogRowsProps) {
  return (
    <LogRowsContextProvider
      value={{timestamps, wrap, showLineNumbers, indentStep, timestampOrigin, onTimestampsClick}}
    >
      <div
        data-slot="log-rows"
        role="log"
        aria-live="polite"
        className={cn(
          'overflow-y-auto rounded-12 border border-border-contrast-bottom shadow-button-neutral',
          'bg-background-contrast-subtle',
          'py-8 font-code text-xs leading-20 text-foreground-contrast-primary',
          'scrollbar',
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </LogRowsContextProvider>
  );
}
