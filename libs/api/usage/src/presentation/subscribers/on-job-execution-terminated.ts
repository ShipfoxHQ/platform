import type {WorkflowsJobExecutionTerminatedEventDto} from '@shipfox/api-workflows-dto';
import {recordJobExecutionTerminated} from '#db/job-executions.js';
import {addUsageMetric, usageJobExecutionRecorded} from '#metrics/instance.js';

export async function onJobExecutionTerminated(
  payload: WorkflowsJobExecutionTerminatedEventDto,
): Promise<void> {
  const result = await recordJobExecutionTerminated(payload);
  if (!result.deferred) {
    addUsageMetric(usageJobExecutionRecorded, 1, result.published ? 'recorded' : 'duplicate');
  }
}
