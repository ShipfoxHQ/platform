'use client';

import type {ComponentProps} from 'react';
import {cn} from '#utils/cn.js';
import {formatLogTimestamp} from './format-timestamp.js';
import {LogRowContextProvider, useLogRowsContext} from './log-context.js';

export interface LogRowFrameProps extends ComponentProps<'div'> {
  /** Gutter number; `null` renders a blank cell (used by markers and headers). */
  lineNumber?: number | null;
  /** Row time; the container's mode formats it. `null` renders a blank cell. */
  timestamp?: Date | null;
  /** Nesting depth level; resolved to px via the container's `indentStep`. */
  indent?: number;
  selected?: boolean;
  /** Override the container's soft-wrap for this row's body. */
  wrap?: boolean;
}

/**
 * The shared row chrome: the line-number gutter, the timestamp cell, and the
 * indented body, all driven by `LogRowsContext`. It is the single owner of that
 * layout so every row-shaped surface (`LogRow`, a disclosure header, a rail body)
 * stays pixel-aligned. It does not inspect or reshape its body children.
 */
export function LogRowFrame({
  className,
  children,
  lineNumber = null,
  timestamp = null,
  indent = 0,
  selected = false,
  wrap,
  ...props
}: LogRowFrameProps) {
  const context = useLogRowsContext();
  const onTimestampsClick = context.onTimestampsClick;
  const resolvedWrap = wrap ?? context.wrap;
  const showTime = context.timestamps !== 'off';
  const timeText = timestamp
    ? formatLogTimestamp(timestamp, {
        mode: context.timestamps,
        timestampOrigin: context.timestampOrigin,
      })
    : '';

  return (
    <LogRowContextProvider value={{wrap: resolvedWrap}}>
      <div
        data-slot="log-row"
        data-selected={selected || undefined}
        data-wrap={resolvedWrap}
        aria-current={selected || undefined}
        className={cn(
          'group/log-row flex items-start transition-colors',
          'hover:bg-neutral-500/[0.06]',
          // Caller styling (e.g. row tone) sits before `selected` so the cursor
          // row always wins the selected surface and edge affordance.
          className,
          selected &&
            'bg-background-contrast-pressed shadow-[inset_2px_0_0_var(--foreground-highlight-interactive)] hover:bg-background-contrast-pressed',
        )}
        {...props}
      >
        {context.showLineNumbers && (
          <span
            data-slot="log-row-gutter"
            aria-hidden="true"
            className={cn(
              'w-44 flex-none select-none px-12 text-right tabular-nums',
              selected ? 'text-foreground-contrast-primary' : 'text-foreground-contrast-secondary',
            )}
          >
            {lineNumber ?? ''}
          </span>
        )}
        {showTime &&
          (onTimestampsClick ? (
            // biome-ignore lint/a11y/noStaticElementInteractions: kept a span (not a button) so the timestamp stays part of a multi-line text selection; switching format is a pointer convenience.
            // biome-ignore lint/a11y/useKeyWithClickEvents: the accessible way to switch timestamp format is a toolbar control, not this inline cell.
            <span
              data-slot="log-row-time"
              onClick={() => {
                // Ignore the click that ends a drag-selection so timestamps stay copyable.
                if (window.getSelection()?.isCollapsed === false) return;
                onTimestampsClick();
              }}
              className="w-80 flex-none cursor-pointer px-4 text-foreground-contrast-secondary tabular-nums transition-colors hover:text-foreground-contrast-primary"
            >
              {timeText}
            </span>
          ) : (
            <span
              data-slot="log-row-time"
              className="w-80 flex-none px-4 text-foreground-contrast-secondary tabular-nums"
            >
              {timeText}
            </span>
          ))}
        <div
          data-slot="log-row-body"
          className="min-w-0 flex-1 overflow-hidden pr-12"
          style={{paddingLeft: 12 + indent * context.indentStep}}
        >
          {children}
        </div>
      </div>
    </LogRowContextProvider>
  );
}
