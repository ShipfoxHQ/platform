import {
  isMissingStepLogStreamError,
  LogView,
  LogViewSkeleton,
  useStepAttemptLogsQuery,
} from '@shipfox/client-logs';
import {Button} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {Text} from '@shipfox/react-ui/typography';
import {type RefObject, useEffect, useRef} from 'react';
import {JobExecutionTimeText} from './job-execution-time-text.js';

const TAIL_FOLLOW_THRESHOLD_PX = 24;
const INITIAL_LOG_ERROR_RETRY_COUNT = 5;
const INITIAL_LOG_ERROR_RETRY_DELAY_MS = 1_500;
const defaultLogSurfaceClasses = 'rounded-8';

export interface StepAttemptLogPanelProps {
  stepId: string;
  attempt: number;
  attemptStatus: string;
  /** The start time used by the page's quiet waiting-for-output state. */
  attemptStartedAt?: string | undefined;
  /** The page scroll column used by the uncapped job-detail log surface. */
  pageScrollRef: RefObject<HTMLElement | null>;
  surfaceClassName?: string | undefined;
  initialErrorRetryCount?: number | undefined;
  initialErrorRetryDelayMs?: number | undefined;
}

export function StepAttemptLogPanel({
  stepId,
  attempt,
  attemptStatus,
  attemptStartedAt,
  pageScrollRef,
  surfaceClassName = defaultLogSurfaceClasses,
  initialErrorRetryCount = INITIAL_LOG_ERROR_RETRY_COUNT,
  initialErrorRetryDelayMs = INITIAL_LOG_ERROR_RETRY_DELAY_MS,
}: StepAttemptLogPanelProps) {
  const shouldFollowTailRef = useRef(true);
  const missingStreamRetryCount = attemptStatus === 'running' ? undefined : initialErrorRetryCount;
  const retryMissingStream = attemptStatus === 'running' || isTerminalAttemptStatus(attemptStatus);
  const query = useStepAttemptLogsQuery(stepId, attempt, {
    retryMissingStream,
    missingStreamRetryCount,
    missingStreamRetryDelayMs: initialErrorRetryDelayMs,
    initialErrorRetryCount,
    initialErrorRetryDelayMs,
  });
  const records = query.data?.records ?? [];
  const recordCount = records.length;
  const anchorToFailure = attemptStatus === 'failed';
  const missingActiveStream =
    retryMissingStream && query.data === undefined && isMissingStepLogStreamError(query.error);
  const initialError = query.isError && query.data === undefined && !missingActiveStream;
  const staleError = query.isError && query.data !== undefined;

  useEffect(() => {
    const scrollElement = pageScrollRef.current;
    if (!scrollElement) return undefined;

    const onScroll = () => {
      shouldFollowTailRef.current = isNearPageBottom(scrollElement);
    };
    scrollElement.addEventListener('scroll', onScroll, {passive: true});
    onScroll();
    return () => scrollElement.removeEventListener('scroll', onScroll);
  }, [pageScrollRef]);

  useEffect(() => {
    if (recordCount === 0) return undefined;
    if (anchorToFailure) return undefined;
    if (!shouldFollowTailRef.current) return undefined;

    const frame = scheduleAnimationFrame(() => {
      const scrollElement = pageScrollRef.current;
      if (!scrollElement) return;
      scrollElement.scrollTop = scrollElement.scrollHeight;
    });

    return () => {
      cancelScheduledFrame(frame);
    };
  }, [anchorToFailure, pageScrollRef, recordCount]);

  if (query.isPending) {
    return <StepLogsLoadingSurface label="Loading logs" className={surfaceClassName} />;
  }

  if (missingActiveStream) {
    if (attemptStatus === 'running' && attemptStartedAt) {
      return <StepLogsWaitingSurface startedAt={attemptStartedAt} className={surfaceClassName} />;
    }
    return <StepLogsLoadingSurface label="Waiting for logs" className={surfaceClassName} />;
  }

  if (initialError) {
    return <StepLogsError retrying={query.isFetching} onRetry={() => void query.refetch()} />;
  }

  return (
    <div className="flex min-w-0 flex-col gap-inline">
      {staleError ? (
        <Callout
          role="alert"
          type="warning"
          variant="secondary"
          className="rounded-none border-b border-border-neutral-base px-0 py-row shadow-none"
        >
          <div className="flex min-w-0 flex-1 items-center justify-between gap-inline">
            <Text size="xs">Could not refresh logs.</Text>
            <Button
              type="button"
              size="2xs"
              variant="secondary"
              isLoading={query.isFetching}
              onClick={() => void query.refetch()}
            >
              Retry
            </Button>
          </div>
        </Callout>
      ) : null}
      <LogView
        records={records}
        emptyState={query.data?.complete ? 'complete' : 'pending'}
        anchorToFailure={anchorToFailure}
        ariaLive={attemptStatus === 'running' ? 'polite' : 'off'}
        className={surfaceClassName}
      />
    </div>
  );
}

function StepLogsLoadingSurface({label, className}: {label: string; className: string}) {
  return (
    <div role="status" aria-label={label}>
      <LogViewSkeleton className={className} />
    </div>
  );
}

function StepLogsWaitingSurface({startedAt, className}: {startedAt: string; className: string}) {
  return (
    <div role="status" aria-label="Waiting for logs" className={className}>
      <Text size="xs" className="px-tight py-row text-foreground-neutral-muted">
        Waiting for output ·{' '}
        <span className="font-code tabular-nums" aria-hidden="true">
          <JobExecutionTimeText time={{state: 'live', fromIso: startedAt}} />
        </span>
      </Text>
    </div>
  );
}

function scheduleAnimationFrame(callback: FrameRequestCallback): number {
  if (typeof globalThis.requestAnimationFrame === 'function') {
    return globalThis.requestAnimationFrame(callback);
  }
  return window.setTimeout(() => callback(Date.now()), 0);
}

function cancelScheduledFrame(frame: number) {
  if (typeof globalThis.cancelAnimationFrame === 'function') {
    globalThis.cancelAnimationFrame(frame);
    return;
  }
  window.clearTimeout(frame);
}

function isNearPageBottom(element: HTMLElement): boolean {
  const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
  return distanceFromBottom <= TAIL_FOLLOW_THRESHOLD_PX;
}

function isTerminalAttemptStatus(status: string): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled';
}

function StepLogsError({retrying, onRetry}: {retrying: boolean; onRetry: () => void}) {
  return (
    <Callout
      role="alert"
      type="error"
      variant="secondary"
      className="rounded-none border-b border-border-neutral-base px-0 py-row shadow-none"
    >
      <div className="flex min-w-0 flex-1 items-center justify-between gap-inline">
        <Text size="xs">Could not load logs.</Text>
        <Button type="button" size="2xs" variant="secondary" isLoading={retrying} onClick={onRetry}>
          Retry
        </Button>
      </div>
    </Callout>
  );
}
