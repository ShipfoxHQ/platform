import {Icon} from '@shipfox/react-ui/icon';
import {useTimeTick} from '@shipfox/react-ui/time-ticker';
import {Code} from '@shipfox/react-ui/typography';
import {cn, humanDuration} from '@shipfox/react-ui/utils';
import type {
  WorkflowRunAttemptDisplayDuration,
  WorkflowRunDisplayDuration,
} from '#core/workflow-run.js';

/**
 * The run list reads an attempt's own marks and cannot tell queue from run, so an unkinded
 * duration still renders as run time. Only surfaces holding the run's jobs pass a kind.
 */
export type WorkflowRunDurationDisplay =
  | WorkflowRunAttemptDisplayDuration
  | WorkflowRunDisplayDuration;

type DurationKind = 'queue' | 'run';

const GLYPH_BY_KIND = {queue: 'hourglassLine', run: 'timerLine'} as const;
const LIVE_VERB_BY_KIND = {queue: 'queued', run: 'running'} as const;
const FIXED_VERB_BY_KIND = {queue: 'queued', run: 'ran'} as const;

export function WorkflowRunDurationLabel({
  duration,
  className,
}: {
  duration: WorkflowRunDurationDisplay | null;
  className?: string | undefined;
}) {
  if (duration === null) return null;
  const kind = durationKind(duration);

  switch (duration.state) {
    case 'fixed': {
      const display = formatFixedDurationLabel(duration.elapsed);
      return (
        <DurationText
          className={className}
          kind={kind}
          ariaLabel={`${FIXED_VERB_BY_KIND[kind]} ${display}`}
        >
          {display}
        </DurationText>
      );
    }
    case 'live':
      return <LiveDurationText duration={duration} kind={kind} className={className} />;
    default: {
      const exhaustive: never = duration;
      return exhaustive;
    }
  }
}

export function useWorkflowRunDurationAccessibleLabel(
  duration: WorkflowRunDurationDisplay | null,
): string | undefined {
  useTimeTick();
  return workflowRunDurationAccessibleLabel(duration);
}

export function workflowRunDurationAccessibleLabel(
  duration: WorkflowRunDurationDisplay | null,
): string | undefined {
  if (duration === null) return undefined;
  const kind = durationKind(duration);

  switch (duration.state) {
    case 'live':
      return `${LIVE_VERB_BY_KIND[kind]} ${humanDuration(duration.fromIso)}`;
    case 'fixed':
      return `${FIXED_VERB_BY_KIND[kind]} ${formatFixedDurationLabel(duration.elapsed)}`;
    default: {
      const exhaustive: never = duration;
      return exhaustive;
    }
  }
}

function durationKind(duration: WorkflowRunDurationDisplay): DurationKind {
  return 'kind' in duration ? duration.kind : 'run';
}

function LiveDurationText({
  duration,
  kind,
  className,
}: {
  duration: Extract<WorkflowRunDurationDisplay, {state: 'live'}>;
  kind: DurationKind;
  className?: string | undefined;
}) {
  useTimeTick();
  const display = humanDuration(duration.fromIso);
  return (
    <DurationText
      className={className}
      kind={kind}
      ariaLabel={`${LIVE_VERB_BY_KIND[kind]} ${display}`}
    >
      {display}
    </DurationText>
  );
}

function DurationText({
  children,
  className,
  kind,
  ariaLabel,
}: {
  children: string;
  className?: string | undefined;
  kind: DurationKind;
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
      {/* The glyph is the only visible mark of queue vs run: the status badge already writes
          "Queued", and the numeric columns are fixed width. The verb rides the accessible
          name instead. */}
      <Icon name={GLYPH_BY_KIND[kind]} className="size-12 shrink-0" aria-hidden="true" />
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
