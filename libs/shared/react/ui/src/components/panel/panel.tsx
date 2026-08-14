import {Slot, Slottable} from '@radix-ui/react-slot';
import type {ComponentProps, ReactNode} from 'react';
import {cn} from '#utils/cn.js';
import {Icon} from '../icon/index.js';
import {Header, Text} from '../typography/index.js';

/** A bordered data region. A panel never contains another panel. */
export interface PanelProps extends ComponentProps<'div'> {
  /** Render as the child element, for a panel that is an `aside` or a `section`. */
  asChild?: boolean;
}

export function Panel({className, asChild = false, ...props}: PanelProps) {
  const Component = asChild ? Slot : 'div';

  return (
    <Component
      data-slot="panel"
      className={cn(
        'flex min-w-0 flex-col overflow-hidden rounded-8 border border-border-neutral-base bg-background-neutral-base text-foreground-neutral-base shadow-button-neutral',
        className,
      )}
      {...props}
    />
  );
}

export type PanelHeaderVariant = 'strip' | 'plain';

export interface PanelHeaderProps extends ComponentProps<'div'> {
  /** Use `plain` for a titled block on a focused surface without a header strip. */
  variant?: PanelHeaderVariant;
}

export function PanelHeader({className, variant = 'strip', ...props}: PanelHeaderProps) {
  return (
    <div
      data-slot="panel-header"
      data-variant={variant}
      className={cn(
        'flex min-w-0 items-center justify-between gap-group',
        variant === 'strip'
          ? 'min-h-48 border-b border-border-neutral-base bg-background-neutral-base px-row py-row'
          : 'bg-background-neutral-base p-panel',
        className,
      )}
      {...props}
    />
  );
}

export interface PanelTitleProps extends ComponentProps<typeof Header> {}

export function PanelTitle({className, children, variant = 'h3', ...props}: PanelTitleProps) {
  return (
    <Header
      data-slot="panel-title"
      variant={variant}
      className={cn('min-w-0 truncate text-foreground-neutral-base', className)}
      {...props}
    >
      {children}
    </Header>
  );
}

export interface PanelActionsProps extends ComponentProps<'div'> {}

export function PanelActions({className, ...props}: PanelActionsProps) {
  return (
    <div
      data-slot="panel-actions"
      className={cn('ml-auto flex shrink-0 items-center gap-inline', className)}
      {...props}
    />
  );
}

export interface PanelBodyProps extends ComponentProps<'div'> {
  /** Render as the child element, so a row list can keep `ul` semantics. */
  asChild?: boolean;
}

export function PanelBody({className, asChild = false, ...props}: PanelBodyProps) {
  const Component = asChild ? Slot : 'div';

  return (
    <Component
      data-slot="panel-body"
      className={cn('flex min-w-0 flex-col bg-background-neutral-base', className)}
      {...props}
    />
  );
}

export interface PanelRowProps extends ComponentProps<'div'> {
  /** Render as the child element, so a row can keep `li` semantics. */
  asChild?: boolean;
}

export function PanelRow({className, asChild = false, ...props}: PanelRowProps) {
  const Component = asChild ? Slot : 'div';

  return (
    <Component
      data-slot="panel-row"
      className={cn(
        'flex min-h-44 min-w-0 items-center justify-between gap-group border-b border-border-neutral-base bg-background-neutral-base px-row py-row text-foreground-neutral-base transition-colors last:border-b-0 hover:bg-background-neutral-hover',
        className,
      )}
      {...props}
    />
  );
}

/**
 * A grid of cells inside a panel body, divided by hairlines rather than gaps,
 * because a bordered tile inside a panel would be two frames around one thing.
 * Two columns, collapsing to one at the 760px breakpoint the product's other
 * grids already use.
 */
// `max-[760px]` compiles to `width<760` and `min-[760px]` to `width>=760`, so the
// two halves meet exactly. Pairing it with `min-[761px]` would leave 760px itself
// matching neither rule, and the row of cells would lose its dividers.
const PANEL_GRID_CLASS = [
  'grid grid-cols-2 max-[760px]:grid-cols-1',
  '[&>*]:border-border-neutral-base',
  'min-[760px]:[&>*:nth-child(n+3)]:border-t min-[760px]:[&>*:nth-child(even)]:border-l',
  'max-[760px]:[&>*:nth-child(n+2)]:border-t',
].join(' ');

export interface PanelGridProps extends ComponentProps<'ul'> {}

export function PanelGrid({className, ...props}: PanelGridProps) {
  return <ul data-slot="panel-grid" className={cn(PANEL_GRID_CLASS, className)} {...props} />;
}

export interface PanelCellProps extends ComponentProps<'li'> {}

export function PanelCell({className, ...props}: PanelCellProps) {
  return (
    <li
      data-slot="panel-cell"
      className={cn('flex min-w-0 flex-col bg-background-neutral-base', className)}
      {...props}
    />
  );
}

export interface PanelCellActionProps extends ComponentProps<'button'> {
  /** Render as the child element, for a router `Link` that fills the cell. */
  asChild?: boolean;
  /**
   * The verb for the trailing affordance, such as `Install` or `Configure`.
   * This is what separates a cell you open from a choice you select, so pass it
   * on anything that navigates.
   */
  action?: ReactNode;
}

export function PanelCellAction({
  className,
  asChild = false,
  action,
  children,
  ...props
}: PanelCellActionProps) {
  const Component = asChild ? Slot : 'button';

  return (
    <Component
      data-slot="panel-cell-action"
      className={cn(
        'group flex min-w-0 flex-1 items-center gap-cluster px-row py-row text-left transition-colors',
        'hover:bg-background-neutral-hover',
        // Cells run edge to edge inside the panel, whose `overflow-hidden` crops
        // an outset ring, so this one is drawn inset per the focus-ring rule.
        'focus-visible:shadow-focus-inset focus-visible:outline-none',
        action === undefined ? undefined : 'justify-between',
        className,
      )}
      {...(asChild ? {} : {type: 'button' as const})}
      {...props}
    >
      <Slottable>{children}</Slottable>
      {action === undefined ? null : (
        <span
          data-slot="panel-cell-verb"
          className="flex shrink-0 items-center gap-tight text-foreground-neutral-muted transition-colors group-hover:text-foreground-highlight-interactive"
        >
          <Text as="span" size="sm">
            {action}
          </Text>
          <Icon name="chevronRight" className="size-16" aria-hidden />
        </span>
      )}
    </Component>
  );
}

export interface PanelEmptyProps extends ComponentProps<'div'> {
  /** Use compact padding when the empty content is already visually dense. */
  compact?: boolean;
}

export function PanelEmpty({className, compact = false, ...props}: PanelEmptyProps) {
  return (
    <div
      data-slot="panel-empty"
      className={cn(
        'flex min-h-120 items-center justify-center text-center',
        compact ? 'p-panel-compact' : 'p-panel',
        className,
      )}
      {...props}
    />
  );
}
