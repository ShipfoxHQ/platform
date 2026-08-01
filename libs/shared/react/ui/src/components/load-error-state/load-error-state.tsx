import type {ReactNode} from 'react';
import {Button} from '../button/index.js';
import {EmptyState} from '../empty-state/index.js';
import type {IconName} from '../icon/index.js';

export interface LoadErrorStateProps {
  /** Defaults to the shared "load failed" glyph so every surface reads the same. */
  icon?: IconName;
  title: string;
  description?: ReactNode;
  onRetry: () => void;
  /** Drives the Retry spinner + disabled state while a refetch is in flight. */
  retrying?: boolean;
  /** Accessible label for the Retry button, e.g. "Retry loading integrations". */
  retryLabel?: string;
  variant?: 'default' | 'compact';
}

/**
 * Calm placeholder for a section that failed to load: an error-toned EmptyState
 * with a single Retry action. Announced via `role="status"` (polite): a section
 * load failure is recoverable, not an assertive `role="alert"`. Presentational
 * only: the caller owns `onRetry`/`retrying`, so this stays free of data-layer deps.
 */
export function LoadErrorState({
  icon = 'errorWarningLine',
  title,
  description,
  onRetry,
  retrying = false,
  retryLabel,
  variant = 'default',
}: LoadErrorStateProps) {
  return (
    <EmptyState
      role="status"
      aria-live="polite"
      tone="error"
      icon={icon}
      title={title}
      description={description}
      variant={variant}
      action={
        <Button
          size="sm"
          variant="secondary"
          isLoading={retrying}
          onClick={onRetry}
          aria-label={retryLabel}
        >
          Retry
        </Button>
      }
    />
  );
}
