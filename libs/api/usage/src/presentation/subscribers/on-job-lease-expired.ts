import type {RunnerJobLeaseExpiredEvent} from '@shipfox/api-runners-dto';
import {recordJobExecutionLeaseExpired} from '#db/job-executions.js';

export function onJobLeaseExpired(payload: RunnerJobLeaseExpiredEvent): Promise<void> {
  return recordJobExecutionLeaseExpired(payload);
}
