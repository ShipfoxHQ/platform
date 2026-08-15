import {useTimeTick} from '@shipfox/react-ui/time-ticker';
import type {JobExecutionTime} from '#core/workflow-run.js';
import {formatJobExecutionTimeLabel} from '../job-graph/job-duration-format.js';

export function JobExecutionTimeText({time}: {time: JobExecutionTime}) {
  useTimeTick();

  return formatJobExecutionTime(time);
}

export function formatJobExecutionTime(time: JobExecutionTime): string {
  return formatJobExecutionTimeLabel(time);
}
