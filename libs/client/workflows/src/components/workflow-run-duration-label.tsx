import {Icon} from '@shipfox/react-ui/icon';
import {useTimeTick} from '@shipfox/react-ui/time-ticker';
import {Code} from '@shipfox/react-ui/typography';
import {cn, humanDuration} from '@shipfox/react-ui/utils';
import type {WorkflowRunAttemptDisplayDuration} from '#core/workflow-run.js';

/**
 * A run reports one span: how long its attempt has been under way. Queueing is a job
 * execution's own affair, and the job surfaces report it there.
 */
export type WorkflowRunDurationDisplay = WorkflowRunAttemptDisplayDuration;

export function WorkflowRunDurationLabel({
  duration,
  hasStarted,
  className,
}: {
  duration: WorkflowRunDurationDisplay | null;
  hasStarted: boolean;
  className?: string | undefined;
}) {
  if (duration === null) return null;

  switch (duration.state) {
    case 'fixed': {
      const display = formatFixedDurationLabel(duration.elapsed);
      const verb = hasStarted ? 'ran' : 'lasted';
      return (
        <DurationText className={className} ariaLabel={`${verb} ${display}`}>
          {display}
        </DurationText>
      );
    }
    case 'live':
      return <LiveDurationText duration={duration} className={className} />;
    default: {
      const exhaustive: never = duration;
      return exhaustive;
    }
  }
}

export function useWorkflowRunDurationAccessibleLabel(
  duration: WorkflowRunDurationDisplay | null,
  hasStarted: boolean,
): string | undefined {
  useTimeTick();
  return workflowRunDurationAccessibleLabel(duration, hasStarted);
}

export function workflowRunDurationAccessibleLabel(
  duration: WorkflowRunDurationDisplay | null,
  hasStarted: boolean,
): string | undefined {
  if (duration === null) return undefined;

  switch (duration.state) {
    case 'live':
      return `running ${humanDuration(duration.fromIso)}`;
    case 'fixed': {
      const verb = hasStarted ? 'ran' : 'lasted';
      return `${verb} ${formatFixedDurationLabel(duration.elapsed)}`;
    }
    default: {
      const exhaustive: never = duration;
      return exhaustive;
    }
  }
}

function LiveDurationText({
  duration,
  className,
}: {
  duration: Extract<WorkflowRunDurationDisplay, {state: 'live'}>;
  className?: string | undefined;
}) {
  useTimeTick();
  const display = humanDuration(duration.fromIso);
  return (
    <DurationText className={className} ariaLabel={`running ${display}`}>
      {display}
    </DurationText>
  );
}

function DurationText({
  children,
  className,
  ariaLabel,
}: {
  children: string;
  className?: string | undefined;
  ariaLabel?: string | undefined;
}) {
  return (
    <Code
      as="span"
      variant="label"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex shrink-0 items-center gap-tight tabular-nums text-foreground-neutral-subtle',
        className,
      )}
    >
      {/* The verb rides the accessible name: the numeric columns are fixed width and the
          status badge already says whether the run is still going. */}
      <Icon name="timerLine" className="size-12 shrink-0" aria-hidden="true" />
      {children}
    </Code>
  );
}

function formatFixedDurationLabel({
  years = 0,
  months = 0,
  weeks = 0,
  days = 0,
  hours = 0,
  minutes = 0,
  seconds = 0,
}: Extract<WorkflowRunDurationDisplay, {state: 'fixed'}>['elapsed']): string {
  const totalDays = years * 365 + months * 30 + weeks * 7 + days;
  const totalHours = totalDays * 24 + hours;

  if (totalHours > 0) return `${totalHours}h ${pad2(minutes)}m`;
  if (minutes > 0) return `${minutes}m ${pad2(seconds)}s`;
  return `${seconds}s`;
}

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}
