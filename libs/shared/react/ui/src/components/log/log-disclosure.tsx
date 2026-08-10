'use client';

import {type ComponentProps, createContext, type ReactNode, useContext} from 'react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '#components/collapsible/index.js';
import {Icon} from '#components/icon/index.js';
import {cn} from '#utils/cn.js';
import {LogRowFrame} from './log-row-frame.js';

/**
 * The disclosure's nesting depth, published by the root so the header and the
 * rail body stay aligned without the caller threading `indent` into each. It is
 * absolute per node (the app computes depth from `parent_group_id`), not
 * cumulative across nesting.
 */
const LogDisclosureIndentContext = createContext(0);

export interface LogDisclosureProps extends ComponentProps<typeof Collapsible> {
  /** Nesting depth level for the header + rail; resolved via the container's `indentStep`. */
  indent?: number;
}

/**
 * Root of one collapsible section, built on `Collapsible`. Controlled via `open`
 * or uncontrolled via `defaultOpen` (default closed). `onOpenChange` is Radix's
 * own callback. Used with a rail body it is a disclosure (agent thinking, tool
 * result); used with `rail={false}` around nested `LogRow`s it is a log group.
 */
export function LogDisclosure({indent = 0, children, ...props}: LogDisclosureProps) {
  return (
    <LogDisclosureIndentContext.Provider value={indent}>
      <Collapsible {...props}>{children}</Collapsible>
    </LogDisclosureIndentContext.Provider>
  );
}

/**
 * Requires either `children` or an explicit `aria-label`. `NonNullable` rejects
 * omitted/`null`/`undefined` children so a bare trigger forces `aria-label`; the
 * type still cannot catch children that render no text (icon-only), which need it too.
 */
type AccessibleName =
  | {children: NonNullable<ReactNode>; 'aria-label'?: string}
  | {children?: undefined; 'aria-label': string};

export type LogDisclosureTriggerProps = AccessibleName & {
  /** Disclosure affordance placement. `'none'` hides the glyph; supply another open/closed cue. */
  chevron?: 'leading' | 'none';
  /** Shown only while collapsed (e.g. "47 words"). */
  summary?: ReactNode;
  /** Right-aligned slot (duration, status, actions). Rendered outside the toggle button. */
  trailing?: ReactNode;
  /** Renders the j/k cursor highlight, matching `LogRow`'s `selected`. */
  selected?: boolean;
  lineNumber?: number | null;
  timestamp?: Date | null;
  className?: string;
};

/**
 * The header row. The toggle is a `CollapsibleTrigger` button filling all
 * non-`trailing` space; the row background itself is not interactive, and
 * `trailing` sits outside the button so it can host its own controls. Aligns
 * with surrounding `LogRow`s through the shared `LogRowFrame`.
 */
export function LogDisclosureTrigger({
  children,
  chevron = 'leading',
  summary,
  trailing,
  selected = false,
  lineNumber = null,
  timestamp = null,
  className,
  'aria-label': ariaLabel,
}: LogDisclosureTriggerProps) {
  const indent = useContext(LogDisclosureIndentContext);

  return (
    <LogRowFrame lineNumber={lineNumber} timestamp={timestamp} indent={indent} selected={selected}>
      <div className="flex items-center gap-8">
        <CollapsibleTrigger
          aria-label={ariaLabel}
          className={cn(
            'group/disc flex min-w-0 flex-1 items-center gap-6 text-left',
            // The row body clips with `overflow-hidden`, which crops the default
            // outset focus ring top and bottom. Draw it inset (never clipped) and
            // force it: tailwind-merge can't strip the base `shadow-button-neutral-focus`
            // (it misreads the token as a shadow color), so `!` wins the cascade.
            'focus-visible:shadow-[inset_0_0_0_2px_var(--color-primary-500)]!',
            className,
          )}
        >
          {chevron === 'leading' && (
            <Icon
              name="chevronRight"
              className="size-16 flex-none text-foreground-contrast-secondary motion-safe:transition-transform group-data-[state=open]/disc:rotate-90"
            />
          )}
          {children != null && <span className="min-w-0 truncate font-medium">{children}</span>}
          {summary != null && (
            <span className="min-w-0 truncate text-foreground-contrast-secondary group-data-[state=open]/disc:hidden">
              {summary}
            </span>
          )}
        </CollapsibleTrigger>
        {trailing != null && (
          <span className="flex-none tabular-nums text-foreground-contrast-secondary">
            {trailing}
          </span>
        )}
      </div>
    </LogRowFrame>
  );
}

export interface LogDisclosureContentProps extends ComponentProps<typeof CollapsibleContent> {
  /**
   * `true` (default) draws the left rail + small indent around arbitrary content
   * (a disclosure). `false` renders children bare for a log group whose body is
   * nested `LogRow`s carrying their own gutter and indent.
   */
  rail?: boolean;
}

/**
 * The collapsible body. Inherits no `forceMount`, so a closed section keeps its
 * subtree out of the DOM. Any overlay (popover, tooltip, dropdown) rendered
 * inside must portal, since `CollapsibleContent` is `overflow-hidden`.
 *
 * In rail mode (`rail` default `true`), `className` styles the visible rail body,
 * not the outer `overflow-hidden` `CollapsibleContent`.
 */
export function LogDisclosureContent({
  rail = true,
  className,
  children,
  ...props
}: LogDisclosureContentProps) {
  const indent = useContext(LogDisclosureIndentContext);

  if (!rail) {
    return (
      <CollapsibleContent className={className} {...props}>
        {children}
      </CollapsibleContent>
    );
  }

  return (
    <CollapsibleContent {...props}>
      <LogRowFrame indent={indent}>
        <div className={cn('border-l border-border-neutral-base pl-8', className)}>{children}</div>
      </LogRowFrame>
    </CollapsibleContent>
  );
}
