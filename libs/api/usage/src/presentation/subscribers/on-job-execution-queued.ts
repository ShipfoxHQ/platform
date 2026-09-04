import type {WorkflowsJobExecutionQueuedEventDto} from '@shipfox/api-workflows-dto';
import {recordJobExecutionQueued} from '#db/job-executions.js';
import {addUsageMetric, usageJobExecutionRecorded} from '#metrics/instance.js';

export async function onJobExecutionQueued(
  payload: WorkflowsJobExecutionQueuedEventDto,
): Promise<void> {
  const result = await recordJobExecutionQueued(payload);
  if (result.published) {
    addUsageMetric(usageJobExecutionRecorded, 1, 'recorded');
  }
}
