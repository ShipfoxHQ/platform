import type {WorkflowSpec} from '@shipfox/api-definitions';
import {WORKFLOW_RUN_CREATED} from '@shipfox/api-workflows-dto';
import {eq, sql} from 'drizzle-orm';
import {db} from './db.js';
import {workflowsOutbox} from './schema/outbox.js';
import {
  bulkUpdateStepStatuses,
  createWorkflowRun,
  getJobsByRunId,
  getStepsByJobId,
  getWorkflowRunById,
  listWorkflowRunsByProject,
  updateJobStatus,
  updateWorkflowRunStatus,
} from './workflow-runs.js';

function spec(overrides?: Partial<WorkflowSpec>): WorkflowSpec {
  return {
    name: 'Test Workflow',
    jobs: {
      build: {
        steps: [{run: 'echo hello'}],
      },
    },
    ...overrides,
  };
}

describe('workflow run queries', () => {
  let workspaceId: string;
  let projectId: string;
  let definitionId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    projectId = crypto.randomUUID();
    definitionId = crypto.randomUUID();
  });

  describe('createWorkflowRun', () => {
    test('inserts run, jobs, and steps atomically', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        definition: spec(),
        triggerContext: {type: 'manual'},
      });

      expect(run.id).toBeDefined();
      expect(run.projectId).toBe(projectId);
      expect(run.definitionId).toBe(definitionId);
      expect(run.status).toBe('pending');
      expect(run.triggerContext).toEqual({type: 'manual'});
      expect(run.inputs).toBeNull();
      expect(run.version).toBe(1);
      expect(run.createdAt).toBeInstanceOf(Date);
      expect(run.updatedAt).toBeInstanceOf(Date);

      const runJobs = await getJobsByRunId(run.id);
      expect(runJobs).toHaveLength(1);
      expect(runJobs[0]?.name).toBe('build');

      const jobSteps = await getStepsByJobId(runJobs[0]?.id as string);
      expect(jobSteps).toHaveLength(1);
      expect(jobSteps[0]?.config).toEqual({run: 'echo hello'});
    });

    test('writes workflows.run.created outbox event in same transaction', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        definition: spec(),
        triggerContext: {type: 'manual'},
      });

      const outboxRows = await db()
        .select()
        .from(workflowsOutbox)
        .where(eq(workflowsOutbox.eventType, WORKFLOW_RUN_CREATED));

      const matchingRow = outboxRows.find(
        (row) => (row.payload as Record<string, unknown>).runId === run.id,
      );

      expect(matchingRow).toBeDefined();
      expect(matchingRow?.payload).toEqual({
        runId: run.id,
        workspaceId: run.workspaceId,
        projectId: run.projectId,
        definitionId: run.definitionId,
      });
      expect(matchingRow?.dispatchedAt).toBeNull();
    });

    test('rolls back outbox event when transaction fails', async () => {
      const marker = crypto.randomUUID();

      try {
        await db().transaction(async (tx) => {
          await tx.insert(workflowsOutbox).values({
            eventType: WORKFLOW_RUN_CREATED,
            payload: {runId: marker, projectId, definitionId},
          });
          throw new Error('Simulated failure');
        });
      } catch {
        // expected
      }

      const leaked = await db()
        .select()
        .from(workflowsOutbox)
        .where(sql`${workflowsOutbox.payload}->>'runId' = ${marker}`);

      expect(leaked).toHaveLength(0);
    });

    test('normalizes needs string to array', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        definition: spec({
          jobs: {
            build: {steps: [{run: 'echo build'}]},
            test: {needs: 'build', steps: [{run: 'echo test'}]},
          },
        }),
        triggerContext: {type: 'manual'},
      });

      const runJobs = await getJobsByRunId(run.id);
      const testJob = runJobs.find((j) => j.name === 'test');

      expect(testJob?.dependencies).toEqual(['build']);
    });

    test('normalizes needs undefined to empty array', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        definition: spec(),
        triggerContext: {type: 'manual'},
      });

      const runJobs = await getJobsByRunId(run.id);

      expect(runJobs[0]?.dependencies).toEqual([]);
    });

    test('handles multi-job definitions with correct positions', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        definition: spec({
          jobs: {
            lint: {steps: [{run: 'echo lint'}]},
            build: {steps: [{run: 'echo build'}]},
            test: {needs: ['lint', 'build'], steps: [{run: 'echo test'}]},
          },
        }),
        triggerContext: {type: 'manual'},
      });

      const runJobs = await getJobsByRunId(run.id);

      expect(runJobs).toHaveLength(3);
      expect(runJobs[0]?.position).toBe(0);
      expect(runJobs[1]?.position).toBe(1);
      expect(runJobs[2]?.position).toBe(2);
    });

    test('handles definition with empty jobs object', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        definition: spec({jobs: {}}),
        triggerContext: {type: 'manual'},
      });

      expect(run.id).toBeDefined();

      const runJobs = await getJobsByRunId(run.id);

      expect(runJobs).toHaveLength(0);
    });

    test('handles job with zero steps', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        definition: spec({
          jobs: {
            empty: {steps: []},
          },
        }),
        triggerContext: {type: 'manual'},
      });

      const runJobs = await getJobsByRunId(run.id);
      expect(runJobs).toHaveLength(1);

      const jobSteps = await getStepsByJobId(runJobs[0]?.id as string);

      expect(jobSteps).toHaveLength(0);
    });

    test('stores step with optional name', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        definition: spec({
          jobs: {
            build: {
              steps: [{name: 'Install deps', run: 'npm install'}, {run: 'npm build'}],
            },
          },
        }),
        triggerContext: {type: 'manual'},
      });

      const runJobs = await getJobsByRunId(run.id);
      const jobSteps = await getStepsByJobId(runJobs[0]?.id as string);

      expect(jobSteps[0]?.name).toBe('Install deps');
      expect(jobSteps[1]?.name).toBeNull();
    });

    test('stores frozen step config', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        definition: spec({
          jobs: {
            build: {steps: [{run: 'make build'}]},
          },
        }),
        triggerContext: {type: 'manual'},
      });

      const runJobs = await getJobsByRunId(run.id);
      const jobSteps = await getStepsByJobId(runJobs[0]?.id as string);

      expect(jobSteps[0]?.type).toBe('run');
      expect(jobSteps[0]?.config).toEqual({run: 'make build'});
    });

    test('stores inputs when provided', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        definition: spec(),
        triggerContext: {type: 'manual'},
        inputs: {env: 'staging', verbose: true},
      });

      expect(run.inputs).toEqual({env: 'staging', verbose: true});
    });
  });

  describe('getWorkflowRunById', () => {
    test('returns the run when found', async () => {
      const created = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        definition: spec(),
        triggerContext: {type: 'manual'},
      });

      const found = await getWorkflowRunById(created.id);

      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
      expect(found?.status).toBe('pending');
    });

    test('returns undefined when not found', async () => {
      const found = await getWorkflowRunById(crypto.randomUUID());

      expect(found).toBeUndefined();
    });
  });

  describe('listWorkflowRunsByProject', () => {
    test('returns runs ordered by creation descending', async () => {
      await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        definition: spec({name: 'First'}),
        triggerContext: {type: 'manual'},
      });
      await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        definition: spec({name: 'Second'}),
        triggerContext: {type: 'manual'},
      });

      const runs = await listWorkflowRunsByProject(projectId);

      expect(runs).toHaveLength(2);
      expect(runs[0]?.createdAt.getTime()).toBeGreaterThanOrEqual(
        runs[1]?.createdAt.getTime() as number,
      );
    });

    test('returns empty array for unknown project', async () => {
      const runs = await listWorkflowRunsByProject(crypto.randomUUID());

      expect(runs).toEqual([]);
    });
  });

  describe('getJobsByRunId', () => {
    test('returns jobs for a run ordered by position', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        definition: spec({
          jobs: {
            lint: {steps: [{run: 'lint'}]},
            build: {steps: [{run: 'build'}]},
          },
        }),
        triggerContext: {type: 'manual'},
      });

      const runJobs = await getJobsByRunId(run.id);

      expect(runJobs).toHaveLength(2);
      expect(runJobs[0]?.position).toBe(0);
      expect(runJobs[1]?.position).toBe(1);
    });
  });

  describe('getStepsByJobId', () => {
    test('returns steps for a job ordered by position', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        definition: spec({
          jobs: {
            build: {
              steps: [{run: 'step1'}, {run: 'step2'}, {run: 'step3'}],
            },
          },
        }),
        triggerContext: {type: 'manual'},
      });

      const runJobs = await getJobsByRunId(run.id);
      const jobSteps = await getStepsByJobId(runJobs[0]?.id as string);

      expect(jobSteps).toHaveLength(3);
      expect(jobSteps[0]?.position).toBe(0);
      expect(jobSteps[1]?.position).toBe(1);
      expect(jobSteps[2]?.position).toBe(2);
    });
  });

  describe('updateWorkflowRunStatus', () => {
    test('updates status and increments version', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        definition: spec(),
        triggerContext: {type: 'manual'},
      });

      const updated = await updateWorkflowRunStatus({
        runId: run.id,
        status: 'running',
        expectedVersion: 1,
      });

      expect(updated.status).toBe('running');
      expect(updated.version).toBe(2);
    });

    test('throws on version mismatch', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        definition: spec(),
        triggerContext: {type: 'manual'},
      });

      await expect(
        updateWorkflowRunStatus({runId: run.id, status: 'running', expectedVersion: 99}),
      ).rejects.toThrow('Optimistic lock failure');
    });

    test('throws when run not found', async () => {
      await expect(
        updateWorkflowRunStatus({
          runId: crypto.randomUUID(),
          status: 'running',
          expectedVersion: 1,
        }),
      ).rejects.toThrow('Optimistic lock failure');
    });
  });

  describe('updateJobStatus', () => {
    test('updates status and increments version', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        definition: spec(),
        triggerContext: {type: 'manual'},
      });
      const runJobs = await getJobsByRunId(run.id);
      const job = runJobs[0];
      expect(job).toBeDefined();

      const updated = await updateJobStatus({
        jobId: job?.id as string,
        status: 'running',
        expectedVersion: 1,
      });

      expect(updated.status).toBe('running');
      expect(updated.version).toBe(2);
    });

    test('throws on version mismatch', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        definition: spec(),
        triggerContext: {type: 'manual'},
      });
      const runJobs = await getJobsByRunId(run.id);

      await expect(
        updateJobStatus({jobId: runJobs[0]?.id ?? '', status: 'running', expectedVersion: 99}),
      ).rejects.toThrow('Optimistic lock failure');
    });
  });

  describe('bulkUpdateStepStatuses', () => {
    test('updates all steps for a job to the given status', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        definition: spec({
          jobs: {
            build: {steps: [{run: 'step1'}, {run: 'step2'}, {run: 'step3'}]},
          },
        }),
        triggerContext: {type: 'manual'},
      });
      const runJobs = await getJobsByRunId(run.id);

      const jobId = runJobs[0]?.id ?? '';
      await bulkUpdateStepStatuses({jobId, status: 'succeeded'});

      const jobSteps = await getStepsByJobId(jobId);
      expect(jobSteps).toHaveLength(3);
      for (const step of jobSteps) {
        expect(step.status).toBe('succeeded');
      }
    });
  });
});
