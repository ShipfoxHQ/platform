import type {WorkflowsJobExecutionQueuedEventDto} from '@shipfox/api-workflows-dto';
import {recordJobExecutionQueued} from '#db/job-executions.js';

export function onJobExecutionQueued(payload: WorkflowsJobExecutionQueuedEventDto): Promise<void> {
  return recordJobExecutionQueued(payload);
}
