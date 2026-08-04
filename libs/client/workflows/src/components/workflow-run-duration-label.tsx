import {Icon} from '@shipfox/react-ui/icon';
import {useTimeTick} from '@shipfox/react-ui/time-ticker';
import {Code} from '@shipfox/react-ui/typography';
import {cn, humanDuration} from '@shipfox/react-ui/utils';
import type {WorkflowRunAttemptDisplayDuration} from '#core/workflow-run.js';

export function WorkflowRunDurationLabel({
  duration,
  className,
}: {
  duration: WorkflowRunAttemptDisplayDuration | null;
  className?: string | undefined;
}) {
  if (duration === null) return null;

  switch (duration.state) {
    case 'fixed': {
      const display = formatFixedDurationLabel(duration.elapsed);
      return (
        <DurationText className={className} ariaLabel={`ran ${display}`}>
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
  duration: WorkflowRunAttemptDisplayDuration | null,
): string | undefined {
  useTimeTick();
  return workflowRunDurationAccessibleLabel(duration);
}

export function workflowRunDurationAccessibleLabel(
  duration: WorkflowRunAttemptDisplayDuration | null,
): string | undefined {
  if (duration === null) return undefined;

  switch (duration.state) {
    case 'live':
      return `running ${humanDuration(duration.fromIso)}`;
    case 'fixed':
      return `ran ${formatFixedDurationLabel(duration.elapsed)}`;
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
  duration: Extract<WorkflowRunAttemptDisplayDuration, {state: 'live'}>;
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
        'inline-flex shrink-0 items-center gap-4 tabular-nums text-foreground-neutral-subtle',
        className,
      )}
    >
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
}: Extract<WorkflowRunAttemptDisplayDuration, {state: 'fixed'}>['elapsed']): string {
  const totalDays = years * 365 + months * 30 + weeks * 7 + days;
  const totalHours = totalDays * 24 + hours;

  if (totalHours > 0) return `${totalHours}h ${pad2(minutes)}m`;
  if (minutes > 0) return `${minutes}m ${pad2(seconds)}s`;
  return `${seconds}s`;
}

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}
