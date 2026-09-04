import type {RunnerJobClaimedEvent} from '@shipfox/api-runners-dto';
import {recordJobExecutionClaimed} from '#db/job-executions.js';

export function onJobClaimed(payload: RunnerJobClaimedEvent): Promise<void> {
  return recordJobExecutionClaimed(payload);
}
