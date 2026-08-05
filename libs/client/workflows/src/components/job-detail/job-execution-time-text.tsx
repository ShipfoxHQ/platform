import {useTimeTick} from '@shipfox/react-ui/time-ticker';
import {formatDuration} from '@shipfox/react-ui/utils';
import type {JobExecutionTime} from '#core/workflow-run.js';

export function JobExecutionTimeText({time}: {time: JobExecutionTime}) {
  useTimeTick();

  return formatJobExecutionTime(time);
}

export function formatJobExecutionTime(time: JobExecutionTime): string {
  if (time.state === 'live') {
    return formatDuration(Date.now() - Date.parse(time.fromIso));
  }

  return formatElapsedDuration(time.elapsed);
}

function formatElapsedDuration(duration: {
  days?: number | undefined;
  hours?: number | undefined;
  minutes?: number | undefined;
  seconds?: number | undefined;
}): string {
  const days = duration.days ?? 0;
  const hours = duration.hours ?? 0;
  const minutes = duration.minutes ?? 0;
  const seconds = duration.seconds ?? 0;

  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  return `${seconds}s`;
}
