import {humanDuration} from '@shipfox/react-ui/utils';
import type {
  JobDisplayDuration,
  JobExecutionDisplayStatus,
  JobExecutionTime,
} from '#core/workflow-run.js';

export function formatJobExecutionTimeLabel(time: JobExecutionTime): string {
  switch (time.state) {
    case 'live':
      return humanDuration(time.fromIso);
    case 'fixed':
      return formatFixedDurationLabel(time.elapsed);
    default: {
      const exhaustive: never = time;
      return exhaustive;
    }
  }
}

export function formatJobDurationAccessibleLabel(
  duration: JobDisplayDuration | null,
  displayStatus?: JobExecutionDisplayStatus,
): string | undefined {
  if (duration === null) return undefined;

  const label = formatJobExecutionTimeLabel(duration);
  switch (duration.kind) {
    case 'queue':
      return duration.state === 'live' ? `queueing ${label}` : `queued ${label}`;
    case 'run':
      if (duration.state !== 'live') return `ran ${label}`;
      if (displayStatus === 'running') return `running ${label}`;
      return displayStatus === 'pending'
        ? `runner assigned ${label}`
        : `execution elapsed ${label}`;
    default: {
      const exhaustive: never = duration;
      return exhaustive;
    }
  }
}

function formatFixedDurationLabel({
  years = 0,
  months = 0,
  weeks = 0,
  days = 0,
  hours = 0,
  minutes = 0,
  seconds = 0,
}: Extract<JobExecutionTime, {state: 'fixed'}>['elapsed']): string {
  const totalDays = years * 365 + months * 30 + weeks * 7 + days;
  const totalHours = totalDays * 24 + hours;

  if (totalHours > 0) return `${totalHours}h ${pad2(minutes)}m`;
  if (minutes > 0) return `${minutes}m ${pad2(seconds)}s`;
  return `${seconds}s`;
}

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}
