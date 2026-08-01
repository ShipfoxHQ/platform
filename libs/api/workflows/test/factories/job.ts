import {eq} from 'drizzle-orm';
import {Factory} from 'fishery';
import type {Job, JobCheckout, JobStatus} from '#core/entities/job.js';
import {db} from '#db/db.js';
import {jobs} from '#db/schema/jobs.js';
import {getJobsByWorkflowRunId} from '#db/workflow-runs.js';
import {workflowModel} from './workflow-model.js';
import {workflowRunFactory} from './workflow-run.js';

interface JobTransientParams {
  projectId?: string;
  status?: JobStatus;
  checkout?: Partial<JobCheckout>;
}

// Provisions a workflow run for `projectId` and returns its first job moved to
// `status` (default 'running'). A job cannot exist without its run (workflow_run_id is a
// NOT NULL FK), so this factory creates the enclosing run too. 'running' is the
// realistic precondition for the lease-authed checkout path: a runner only holds
// a lease for a job it has claimed and is executing.
export const jobFactory = Factory.define<Job, JobTransientParams>(({transientParams, onCreate}) => {
  onCreate(async () => {
    const {projectId = crypto.randomUUID(), status = 'running', checkout} = transientParams;
    const run = await workflowRunFactory.create(
      {projectId},
      checkout === undefined
        ? undefined
        : {
            transient: {
              model: workflowModel({
                jobs: {
                  build: {
                    checkout: {
                      permissions: checkout.permissions ?? {contents: 'read'},
                      persistCredentials: checkout.persistCredentials ?? true,
                    },
                    steps: [{run: 'echo hello'}],
                  },
                },
              }),
            },
          },
    );
    const [job] = await getJobsByWorkflowRunId(run.id);
    if (!job) throw new Error('jobFactory: run created no jobs');
    await db().update(jobs).set({status}).where(eq(jobs.id, job.id));
    return {...job, status, statusReason: null, carriedOver: false};
  });

  return {
    id: crypto.randomUUID(),
    workflowRunAttemptId: crypto.randomUUID(),
    key: 'build',
    name: null,
    mode: 'one_shot',
    status: 'running',
    statusReason: null,
    carriedOver: false,
    checkout: {
      permissions: {contents: 'read'},
      persistCredentials: true,
    },
    success: null,
    executionTimeoutMs: null,
    listeningTimeoutMs: null,
    maxExecutions: null,
    onResolve: null,
    batchDebounceMs: null,
    batchMaxSize: null,
    batchMaxWaitMs: null,
    listenerStatus: 'inactive',
    resolutionReason: null,
    listeningOn: null,
    listeningUntil: null,
    outputs: null,
    dependencies: [],
    runner: null,
    position: 0,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
});
