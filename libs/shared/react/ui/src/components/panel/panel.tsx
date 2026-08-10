import type {ComponentProps} from 'react';
import {cn} from '#utils/cn.js';
import {Header} from '../typography/index.js';

/** A bordered data region. A panel never contains another panel. */
export interface PanelProps extends ComponentProps<'div'> {}

export function Panel({className, ...props}: PanelProps) {
  return (
    <div
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
          ? 'min-h-48 border-b border-border-neutral-base bg-background-subtle-base px-row py-row'
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

export interface PanelBodyProps extends ComponentProps<'div'> {}

export function PanelBody({className, ...props}: PanelBodyProps) {
  return (
    <div
      data-slot="panel-body"
      className={cn('flex min-w-0 flex-col bg-background-neutral-base', className)}
      {...props}
    />
  );
}

export interface PanelRowProps extends ComponentProps<'div'> {}

export function PanelRow({className, ...props}: PanelRowProps) {
  return (
    <div
      data-slot="panel-row"
      className={cn(
        'flex min-h-44 min-w-0 items-center justify-between gap-group border-b border-border-neutral-base bg-background-neutral-base px-row py-row text-foreground-neutral-base transition-colors last:border-b-0 hover:bg-background-neutral-hover',
        className,
      )}
      {...props}
    />
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
