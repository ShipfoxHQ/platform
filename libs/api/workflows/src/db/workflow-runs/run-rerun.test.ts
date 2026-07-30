import {eq, inArray} from 'drizzle-orm';
import type {AgentDefaultsResolver} from '#core/agent-defaults.js';
import type {AgentToolMaterializationSnapshot} from '#core/agent-tools.js';
import {NoFailedJobsError, RunNotTerminalError, SourceRunNotFoundError} from '#core/errors.js';
import {nextStepForJob, recordStepResult} from '#core/job-execution.js';
import {stripSetupStep} from '#test/fixtures/strip-setup-step.js';
import {
  buildModel,
  runAttemptCreatedEvents,
  stepOutputField,
  template,
} from '#test/helpers/workflow-runs.js';
import {db} from '../db.js';
import {jobExecutions} from '../schema/job-executions.js';
import {jobs} from '../schema/jobs.js';
import {steps as stepsTable} from '../schema/steps.js';
import {workflowRunAttempts} from '../schema/workflow-run-attempts.js';
import {
  createRerunWorkflowRun,
  createWorkflowRun,
  getJobExecutionsByJobId,
  getJobsByWorkflowRunId,
  getStepAttempts,
  getStepsByJobId,
  getWorkflowRunAttemptById,
  getWorkflowRunById,
  listRunAttempts,
  updateWorkflowRunStatus,
} from '../workflow-runs.js';

describe('workflow run queries', () => {
  let workspaceId: string;
  let projectId: string;
  let definitionId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    projectId = crypto.randomUUID();
    definitionId = crypto.randomUUID();
  });

  describe('createRerunWorkflowRun', () => {
    function rerunModel() {
      return buildModel({
        runName: `Run ${template('inputs.env')}`,
        jobs: {
          build: {steps: [{run: 'echo build'}]},
          test: {needs: 'build', steps: [{run: 'echo test'}]},
          deploy: {needs: 'test', steps: [{run: 'echo deploy'}]},
          notify: {steps: [{run: 'echo notify'}]},
        },
      });
    }

    async function createTerminalSourceRun() {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: rerunModel(),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
        inputs: {env: 'staging'},
        sourceSnapshot: {content: 'name: Original\njobs: {}\n', format: 'yaml'},
      });
      const runJobs = await getJobsByWorkflowRunId(run.id);
      await Promise.all([
        markJob(runJobs, 'build', 'succeeded'),
        markJob(runJobs, 'test', 'failed'),
        markJob(runJobs, 'deploy', 'skipped'),
        markJob(runJobs, 'notify', 'cancelled'),
      ]);
      await updateWorkflowRunStatus({workflowRunId: run.id, status: 'failed', expectedVersion: 1});

      return run;
    }

    async function markJob(
      runJobs: Awaited<ReturnType<typeof getJobsByWorkflowRunId>>,
      key: string,
      status: 'succeeded' | 'failed' | 'cancelled' | 'skipped',
    ) {
      const job = runJobs.find((candidate) => candidate.key === key);
      if (!job) throw new Error(`Missing job ${key}`);
      await db().update(jobs).set({status}).where(eq(jobs.id, job.id));
      const jobSteps = await getStepsByJobId(job.id);
      await db()
        .update(stepsTable)
        .set({
          status: status === 'skipped' ? 'cancelled' : status,
          error: status === 'failed' ? {message: 'failed'} : null,
        })
        .where(
          inArray(
            stepsTable.id,
            jobSteps.map((step) => step.id),
          ),
        );
    }

    test('all mode resets every job and step to pending', async () => {
      const source = await createTerminalSourceRun();

      const rerun = await createRerunWorkflowRun({
        workflowRunId: source.id,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });

      expect(rerun).toMatchObject({
        id: source.id,
        name: 'Run staging',
        workflowName: 'Test Workflow',
        nameOverride: 'Run staging',
        inputs: {env: 'staging'},
        sourceSnapshot: {content: 'name: Original\njobs: {}\n', format: 'yaml'},
      });
      const sourceAfter = await getWorkflowRunById(source.id);
      expect(sourceAfter?.currentAttempt).toBe(2);
      const attempts = await listRunAttempts({workflowRunId: source.id, projectId});
      expect(attempts.map((attempt) => attempt.attempt).sort()).toEqual([1, 2]);

      const rerunJobs = await getJobsByWorkflowRunId(rerun.id);
      expect(rerunJobs.every((job) => job.status === 'pending' && !job.carriedOver)).toBe(true);
      for (const job of rerunJobs) {
        const jobSteps = await getStepsByJobId(job.id);
        expect(jobSteps.every((step) => step.status === 'pending')).toBe(true);
        expect(jobSteps.every((step) => step.error === null)).toBe(true);
      }
    });

    test('reruns clone the parsed model onto the new attempt', async () => {
      const source = await createTerminalSourceRun();

      await createRerunWorkflowRun({
        workflowRunId: source.id,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });

      const attempts = await listRunAttempts({workflowRunId: source.id, projectId});
      const sourceAttempt = attempts.find((attempt) => attempt.attempt === 1);
      const rerunAttempt = attempts.find((attempt) => attempt.attempt === 2);
      const reloadedRerunAttempt = await getWorkflowRunAttemptById(rerunAttempt?.id as string);
      expect(reloadedRerunAttempt?.model).toEqual(sourceAttempt?.model);
    });

    test('reruns clone the frozen agent tool materialization snapshot', async () => {
      const source = await createTerminalSourceRun();
      const [sourceAttempt] = await listRunAttempts({workflowRunId: source.id, projectId});
      const snapshot: AgentToolMaterializationSnapshot = {
        steps: [
          {
            jobKey: 'test',
            stepId: 'test-step-1',
            integrations: [
              {
                connectionId: crypto.randomUUID(),
                connectionSlug: 'github',
                provider: 'github',
                requiredScope: [{permission: 'issues', access: 'read'}],
                tools: [
                  {
                    id: 'issue_read',
                    sensitivity: 'read',
                    sensitive: false,
                    requiredScope: [{permission: 'issues', access: 'read'}],
                    inputSchema: {type: 'object'},
                    methods: [
                      {
                        id: 'get',
                        token: 'issue_read.get',
                        sensitivity: 'read',
                        sensitive: false,
                        requiredScope: [{permission: 'issues', access: 'read'}],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };
      await db()
        .update(workflowRunAttempts)
        .set({agentToolMaterialization: snapshot})
        .where(eq(workflowRunAttempts.id, sourceAttempt?.id as string));

      await createRerunWorkflowRun({
        workflowRunId: source.id,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });

      const attempts = await listRunAttempts({workflowRunId: source.id, projectId});
      const rerunAttempt = attempts.find((attempt) => attempt.attempt === 2);
      expect(rerunAttempt?.agentToolMaterialization).toEqual(snapshot);
    });

    test('reruns preserve each source job checkout policy', async () => {
      const source = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            build: {
              checkout: {
                permissions: {contents: 'write'},
                persistCredentials: false,
              },
              steps: [{run: 'echo build'}],
            },
          },
        }),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });
      const sourceJobs = await getJobsByWorkflowRunId(source.id);
      await markJob(sourceJobs, 'build', 'failed');
      await updateWorkflowRunStatus({
        workflowRunId: source.id,
        status: 'failed',
        expectedVersion: 1,
      });

      const rerun = await createRerunWorkflowRun({
        workflowRunId: source.id,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });

      const rerunJobs = await getJobsByWorkflowRunId(rerun.id);
      expect(rerunJobs[0]?.checkout).toEqual({
        permissions: {contents: 'write'},
        persistCredentials: false,
      });
    });

    test('reruns preserve the original resolved agent step config', async () => {
      const resolveAgentDefaults = vi.fn<AgentDefaultsResolver>().mockReturnValue({
        harness: 'pi',
        provider: 'openai',
        model: 'gpt-5.5-pro',
        thinking: 'medium',
      });
      const source = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            fix: {
              steps: [
                {
                  harness: 'pi',
                  tools: ['read', 'web_search'],
                  prompt: 'Fix the failing tests.',
                },
              ],
            },
          },
        }),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
        resolveAgentDefaults,
      });
      const sourceJobs = await getJobsByWorkflowRunId(source.id);
      await markJob(sourceJobs, 'fix', 'failed');
      await updateWorkflowRunStatus({
        workflowRunId: source.id,
        status: 'failed',
        expectedVersion: 1,
      });

      const rerun = await createRerunWorkflowRun({
        workflowRunId: source.id,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });

      const rerunJobs = await getJobsByWorkflowRunId(rerun.id);
      const rerunSteps = await getStepsByJobId(rerunJobs[0]?.id as string);
      const agentStep = rerunSteps.find((step) => step.type === 'agent');
      expect(resolveAgentDefaults).toHaveBeenCalledTimes(1);
      expect(agentStep?.config).toEqual({
        harness: 'pi',
        model: 'gpt-5.5-pro',
        provider: 'openai',
        thinking: 'medium',
        tools: ['read', 'web_search'],
        prompt: 'Fix the failing tests.',
      });
    });

    test('reruns clone authored step config', async () => {
      const source = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({jobs: {build: {steps: [{run: `echo "${template('run.id')}"`}]}}}),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });
      await updateWorkflowRunStatus({
        workflowRunId: source.id,
        status: 'failed',
        expectedVersion: 1,
      });

      const rerun = await createRerunWorkflowRun({
        workflowRunId: source.id,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });
      const rerunJobs = await getJobsByWorkflowRunId(rerun.id);
      const userStep = (await getStepsByJobId(rerunJobs[0]?.id as string))[1];

      expect(userStep?.authoredConfig).toEqual({run: `echo "${template('run.id')}"`});
    });

    test('reruns dispatch from the preserved step config plan', async () => {
      const source = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({jobs: {build: {steps: [{run: 'build'}, {run: 'deploy'}]}}}),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });
      const sourceJobs = await getJobsByWorkflowRunId(source.id);
      const sourceJob = sourceJobs[0];
      if (!sourceJob) throw new Error('Expected source job');
      await stripSetupStep(sourceJob.id);
      const sourceSteps = await getStepsByJobId(sourceJob.id);
      const sourceProducer = sourceSteps[0];
      const sourceConsumer = sourceSteps[1];
      if (!sourceProducer || !sourceConsumer) throw new Error('Expected source steps');
      const shaPlan = stepOutputField('build', 'sha');
      await db().update(stepsTable).set({key: 'build'}).where(eq(stepsTable.id, sourceProducer.id));
      await db()
        .update(stepsTable)
        .set({
          key: 'deploy',
          config: {run: 'deploy', env: {SHA: 'old-snapshot'}},
          configPlan: {env: {SHA: shaPlan}},
        })
        .where(eq(stepsTable.id, sourceConsumer.id));
      await updateWorkflowRunStatus({
        workflowRunId: source.id,
        status: 'failed',
        expectedVersion: 1,
      });
      const rerun = await createRerunWorkflowRun({
        workflowRunId: source.id,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });
      const rerunJobs = await getJobsByWorkflowRunId(rerun.id);
      const rerunJob = rerunJobs[0];
      if (!rerunJob) throw new Error('Expected rerun job');
      const producer = await nextStepForJob(rerunJob.id);
      if (producer.kind !== 'step') throw new Error('Expected producer step');
      await recordStepResult({
        jobExecutionId: producer.step.jobExecutionId,
        stepId: producer.step.id,
        status: 'succeeded',
        output: {sha: 'new-snapshot'},
      });

      const consumer = await nextStepForJob(rerunJob.id);

      expect(consumer).toEqual({
        kind: 'step',
        step: expect.objectContaining({
          key: 'deploy',
          config: {run: 'deploy', env: {SHA: 'new-snapshot'}},
          configPlan: {env: {SHA: shaPlan}},
        }),
        dispatched: true,
      });
      const attempts = await getStepAttempts(rerunJob.id);
      expect(attempts.find((attempt) => attempt.stepId === sourceConsumer.id)).toBeUndefined();
      expect(attempts.find((attempt) => attempt.stepId !== producer.step.id)).toMatchObject({
        config: {run: 'deploy', env: {SHA: 'new-snapshot'}},
      });
    });

    test('reruns copy the source job execution name', async () => {
      const source = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            deploy: {
              executionName: `Deploy ${template('inputs.environment')}`,
              steps: [{run: 'echo deploy'}],
            },
          },
        }),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
        inputs: {environment: 'prod'},
      });
      const [sourceJob] = await getJobsByWorkflowRunId(source.id);
      if (!sourceJob) throw new Error('Missing deploy job');
      await markJob([sourceJob], 'deploy', 'failed');
      const [sourceExecution] = await getJobExecutionsByJobId(sourceJob.id);
      if (!sourceExecution) throw new Error('Missing deploy execution');
      await db()
        .update(jobExecutions)
        .set({name: 'Deploy prod (attempt 1)'})
        .where(eq(jobExecutions.id, sourceExecution.id));
      await updateWorkflowRunStatus({
        workflowRunId: source.id,
        status: 'failed',
        expectedVersion: 1,
      });

      const rerun = await createRerunWorkflowRun({
        workflowRunId: source.id,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });

      const [rerunJob] = await getJobsByWorkflowRunId(rerun.id);
      if (!rerunJob) throw new Error('Missing rerun deploy job');
      const [rerunExecution] = await getJobExecutionsByJobId(rerunJob.id);
      expect(rerunExecution?.name).toBe('Deploy prod (attempt 1)');
    });

    test('reruns preserve a null name override instead of copying the fallback', async () => {
      const source = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            deploy: {name: 'Deploy', steps: [{run: 'echo deploy'}]},
          },
        }),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });
      const [sourceJob] = await getJobsByWorkflowRunId(source.id);
      if (!sourceJob) throw new Error('Missing deploy job');
      await markJob([sourceJob], 'deploy', 'failed');
      const [sourceExecution] = await getJobExecutionsByJobId(sourceJob.id);
      if (!sourceExecution) throw new Error('Missing deploy execution');
      expect(sourceExecution.nameOverride).toBeNull();
      expect(sourceExecution.name).toBe('Deploy');
      await updateWorkflowRunStatus({
        workflowRunId: source.id,
        status: 'failed',
        expectedVersion: 1,
      });

      const rerun = await createRerunWorkflowRun({
        workflowRunId: source.id,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });

      const [rerunJob] = await getJobsByWorkflowRunId(rerun.id);
      if (!rerunJob) throw new Error('Missing rerun deploy job');
      const [rerunExecution] = await getJobExecutionsByJobId(rerunJob.id);
      expect(rerunExecution?.nameOverride).toBeNull();
      expect(rerunExecution?.name).toBe('Deploy');
      const [storedRerunExecution] = await db()
        .select({name: jobExecutions.name})
        .from(jobExecutions)
        .where(eq(jobExecutions.jobId, rerunJob.id));
      expect(storedRerunExecution?.name).toBeNull();
    });

    test('writes one run-attempt-created outbox event for the rerun', async () => {
      const source = await createTerminalSourceRun();

      const rerun = await createRerunWorkflowRun({
        workflowRunId: source.id,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });

      const events = await runAttemptCreatedEvents(rerun.id);
      expect(events.find((event) => event.attempt === 2)).toEqual(
        expect.objectContaining({
          workflowRunId: rerun.id,
          attempt: 2,
          workspaceId: rerun.workspaceId,
          projectId: rerun.projectId,
          definitionId: rerun.definitionId,
        }),
      );
    });

    test('failed mode carries succeeded jobs and resets every non-succeeded job', async () => {
      const source = await createTerminalSourceRun();
      const sourceJobs = await getJobsByWorkflowRunId(source.id);
      for (const job of sourceJobs) {
        await db()
          .update(jobs)
          .set({outputs: {source: job.key}})
          .where(eq(jobs.id, job.id));
      }

      const rerun = await createRerunWorkflowRun({
        workflowRunId: source.id,
        mode: 'failed',
        actorUserId: crypto.randomUUID(),
      });

      const rerunJobs = await getJobsByWorkflowRunId(rerun.id);
      const build = rerunJobs.find((job) => job.key === 'build');
      const test = rerunJobs.find((job) => job.key === 'test');
      const deploy = rerunJobs.find((job) => job.key === 'deploy');
      const notify = rerunJobs.find((job) => job.key === 'notify');
      expect(build).toMatchObject({
        status: 'succeeded',
        carriedOver: true,
        outputs: {source: 'build'},
      });
      expect(test).toMatchObject({status: 'pending', carriedOver: false, outputs: null});
      expect(deploy).toMatchObject({status: 'pending', carriedOver: false, outputs: null});
      expect(notify).toMatchObject({status: 'pending', carriedOver: false, outputs: null});

      const buildSteps = await getStepsByJobId(build?.id as string);
      expect(buildSteps.every((step) => step.status === 'succeeded')).toBe(true);
      expect(buildSteps.every((step) => step.currentAttempt === 1)).toBe(true);
      expect(await getStepAttempts(build?.id as string)).toEqual([]);
      const buildExecutions = await getJobExecutionsByJobId(build?.id as string);
      expect(buildExecutions).toHaveLength(1);
      expect(buildExecutions[0]).toMatchObject({
        jobId: build?.id,
        status: 'succeeded',
      });
      expect(buildExecutions[0]?.finishedAt).toBeInstanceOf(Date);

      for (const job of [test, deploy, notify]) {
        const jobSteps = await getStepsByJobId(job?.id as string);
        expect(jobSteps.every((step) => step.status === 'pending')).toBe(true);
        expect(jobSteps.every((step) => step.error === null)).toBe(true);
      }
    });

    test('increments attempts across a lineage', async () => {
      const source = await createTerminalSourceRun();

      const second = await createRerunWorkflowRun({
        workflowRunId: source.id,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });
      await updateWorkflowRunStatus({
        workflowRunId: second.id,
        status: 'failed',
        expectedVersion: 1,
      });
      const third = await createRerunWorkflowRun({
        workflowRunId: second.id,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });

      expect(second.currentAttempt).toBe(2);
      expect(second.id).toBe(source.id);
      expect(third).toMatchObject({id: source.id, currentAttempt: 3});
    });

    test('rejects a concurrent rerun while a new attempt is active', async () => {
      const source = await createTerminalSourceRun();

      const results = await Promise.allSettled([
        createRerunWorkflowRun({
          workflowRunId: source.id,
          mode: 'all',
          actorUserId: crypto.randomUUID(),
        }),
        createRerunWorkflowRun({
          workflowRunId: source.id,
          mode: 'all',
          actorUserId: crypto.randomUUID(),
        }),
      ]);

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    });

    test('rejects non-terminal sources and failed-mode runs with no failed jobs', async () => {
      const running = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: rerunModel(),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });
      const succeeded = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: rerunModel(),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });
      await updateWorkflowRunStatus({
        workflowRunId: succeeded.id,
        status: 'succeeded',
        expectedVersion: 1,
      });

      await expect(
        createRerunWorkflowRun({
          workflowRunId: running.id,
          mode: 'all',
          actorUserId: crypto.randomUUID(),
        }),
      ).rejects.toBeInstanceOf(RunNotTerminalError);
      await expect(
        createRerunWorkflowRun({
          workflowRunId: succeeded.id,
          mode: 'failed',
          actorUserId: crypto.randomUUID(),
        }),
      ).rejects.toBeInstanceOf(NoFailedJobsError);
    });

    test('rejects a missing source run', async () => {
      await expect(
        createRerunWorkflowRun({
          workflowRunId: crypto.randomUUID(),
          mode: 'all',
          actorUserId: crypto.randomUUID(),
        }),
      ).rejects.toBeInstanceOf(SourceRunNotFoundError);
    });
  });
});
