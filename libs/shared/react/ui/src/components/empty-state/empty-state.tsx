import type {ComponentProps, ReactNode} from 'react';
import {cn} from '#utils/cn.js';
import {Icon, type IconName} from '../icon/index.js';
import {PanelEmpty} from '../panel/index.js';
import {Text} from '../typography/index.js';

export type EmptyStateVariant = 'default' | 'compact' | 'panel';

export interface EmptyStateProps extends ComponentProps<'div'> {
  icon?: IconName;
  /** Tints the icon only: neutral for "no content", error for a failed load. */
  tone?: 'neutral' | 'error';
  title?: string;
  description?: ReactNode;
  /** Single primary action (a Button/Link) rendered below the text. */
  action?: ReactNode;
  /** Fills the body of a bordered data-region panel. */
  variant?: EmptyStateVariant;
}

export function EmptyState({
  icon = 'fileDamageLine',
  tone = 'neutral',
  title,
  description,
  action,
  variant = 'default',
  className,
  ...props
}: EmptyStateProps) {
  let containerClasses = 'flex flex-col items-center justify-center gap-12 py-48';
  if (variant === 'compact') containerClasses = 'flex flex-col items-center justify-center gap-10';
  else if (variant === 'panel') containerClasses = 'w-full flex-1 flex-col gap-12';

  const iconContainerClasses =
    variant === 'compact'
      ? 'flex size-32 items-center justify-center rounded-6 border border-border-neutral-strong bg-background-neutral-base p-8'
      : 'flex size-32 items-center justify-center rounded-6 border border-border-neutral-strong';

  const EmptyStateContainer = variant === 'panel' ? PanelEmpty : 'div';

  return (
    <EmptyStateContainer
      data-slot="empty-state"
      data-variant={variant}
      className={cn(containerClasses, className)}
      {...props}
    >
      <div className={iconContainerClasses}>
        <Icon
          name={icon}
          className={cn(
            variant === 'compact' ? 'size-20' : 'size-16',
            // Only the glyph carries the status color (DESIGN.md §10.1 / §13);
            // the surface and border stay neutral so the placeholder reads calm.
            tone === 'error' ? 'text-tag-error-icon' : 'text-foreground-neutral-subtle',
          )}
        />
      </div>
      <div className={cn('text-center', variant !== 'compact' && 'space-y-4')}>
        {title ? (
          <Text
            size="sm"
            className={
              variant === 'compact'
                ? 'text-foreground-neutral-subtle'
                : 'text-foreground-neutral-base'
            }
          >
            {title}
          </Text>
        ) : null}
        {description ? (
          <Text size="xs" className="text-foreground-neutral-muted">
            {description}
          </Text>
        ) : null}
      </div>
      {action ? <div>{action}</div> : null}
    </EmptyStateContainer>
  );
}
