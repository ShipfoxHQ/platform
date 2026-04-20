import type {JobPayloadDto} from '@shipfox/api-runners-dto';
import {Factory} from 'fishery';
import {enqueueJob} from '#db/jobs.js';

interface PendingJobAttrs {
  workspaceId: string;
  jobId: string;
  runId: string;
  payload: JobPayloadDto;
}

export const pendingJobFactory = Factory.define<PendingJobAttrs>(({sequence, onCreate}) => {
  const jobId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();

  onCreate(async (attrs) => {
    await enqueueJob({
      workspaceId: attrs.workspaceId,
      jobId: attrs.jobId,
      runId: attrs.runId,
      payload: attrs.payload,
    });
    return attrs;
  });

  return {
    workspaceId,
    jobId,
    runId,
    payload: {
      job_id: jobId,
      run_id: runId,
      job_name: `test-job-${sequence}`,
      steps: [
        {
          id: crypto.randomUUID(),
          name: 'hello',
          type: 'run',
          config: {run: 'echo hello'},
          position: 0,
        },
      ],
    },
  };
});
