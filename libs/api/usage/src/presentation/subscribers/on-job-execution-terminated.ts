import type {WorkflowsJobExecutionTerminatedEventDto} from '@shipfox/api-workflows-dto';
import {recordJobExecutionTerminated} from '#db/job-executions.js';
import {usageJobExecutionRecorded} from '#metrics/instance.js';

export async function onJobExecutionTerminated(
  payload: WorkflowsJobExecutionTerminatedEventDto,
): Promise<void> {
  const result = await recordJobExecutionTerminated(payload);
  usageJobExecutionRecorded.add(1, {outcome: result.published ? 'recorded' : 'duplicate'});
}
