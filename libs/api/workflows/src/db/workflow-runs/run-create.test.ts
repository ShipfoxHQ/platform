import type {WorkflowFieldTemplate} from '@shipfox/api-definitions-dto';
import {
  WORKFLOW_SOURCE_SNAPSHOT_MAX_BYTES,
  WORKFLOWS_WORKFLOW_RUN_ATTEMPT_CREATED,
} from '@shipfox/api-workflows-dto';
import {parseWorkflowTemplate, planInterpolationField} from '@shipfox/expression';
import {and, eq, sql} from 'drizzle-orm';
import type {AgentDefaultsResolver} from '#core/agent-defaults.js';
import {
  InterpolationUnresolvableError,
  type WorkflowSourceSnapshotTooLargeError,
} from '#core/errors.js';
import {nextStepForJob, recordStepResult} from '#core/job-execution.js';
import {resolveTestAgentDefaults} from '#test/fixtures/agent-inter-module.js';
import {createTestSecretsClient} from '#test/fixtures/secrets-inter-module.js';
import {buildModel, expression, shellRef, template} from '#test/helpers/workflow-runs.js';
import {workflowModel} from '#test/index.js';
import {db} from '../db.js';
import {workflowsOutbox} from '../schema/outbox.js';
import {workflowRunCounters} from '../schema/workflow-run-counters.js';
import {workflowRuns} from '../schema/workflow-runs.js';
import {
  createWorkflowRun,
  evaluateJobActivations,
  getJobExecutionsByJobId,
  getJobsByWorkflowRunId,
  getStepsByJobId,
  getWorkflowRunAttemptById,
  getWorkflowRunById,
  getWorkflowRunDetail,
  listRunAttempts,
  resolveJobStatusFromJobExecutions,
  updateJobExecutionStatus,
} from '../workflow-runs.js';

function checkoutTemplate(source: string): WorkflowFieldTemplate {
  const result = planInterpolationField({
    field: 'checkout.repository',
    segments: parseWorkflowTemplate(source),
  });
  if (!result.ok) throw new Error('Expected valid checkout template');
  return result.plan.field.segments;
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
    test('enforces the workflow run origin and dev source relationship at the database boundary', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel(),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });

      await expect(
        db().execute(
          sql`UPDATE ${workflowRuns} SET origin = 'dev', dev_source = '{}'::jsonb WHERE ${workflowRuns.id} = ${run.id}`,
        ),
      ).resolves.toBeDefined();

      await expect(
        db().update(workflowRuns).set({origin: 'synced'}).where(eq(workflowRuns.id, run.id)),
      ).rejects.toThrow();

      await db()
        .update(workflowRuns)
        .set({
          origin: 'dev',
          devSource: {
            ref: 'main',
            commit: 'abc123',
            config_path: '.shipfox/workflows.yml',
            initiated_by_user_id: crypto.randomUUID(),
            replay_of_event_id: null,
          },
        })
        .where(eq(workflowRuns.id, run.id));
    });

    test('persists a dev origin with its dev source', async () => {
      const devSource = {
        ref: 'fix-triage-prompt',
        commit: 'a'.repeat(40),
        configPath: '.shipfox/workflows/triage-sentry.yml',
        initiatedByUserId: crypto.randomUUID(),
        replayOfEventId: null,
      };
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel(),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          userId: crypto.randomUUID(),
        },
        origin: 'dev',
        devSource,
      });

      expect(run.origin).toBe('dev');
      expect(run.devSource).toEqual(devSource);
      await expect(getWorkflowRunById(run.id)).resolves.toMatchObject({
        origin: 'dev',
        devSource,
      });
      // The persisted jsonb carries snake_case keys, matching the read boundary.
      await expect(
        db()
          .select({origin: workflowRuns.origin, devSource: workflowRuns.devSource})
          .from(workflowRuns)
          .where(eq(workflowRuns.id, run.id)),
      ).resolves.toEqual([
        {
          origin: 'dev',
          devSource: {
            ref: devSource.ref,
            commit: devSource.commit,
            config_path: devSource.configPath,
            initiated_by_user_id: devSource.initiatedByUserId,
            replay_of_event_id: devSource.replayOfEventId,
          },
        },
      ]);
    });

    test('persists normalized integration trigger facts alongside the payload', async () => {
      const triggerConnectionId = crypto.randomUUID();
      const integrations = {
        resolveTriggerReference: vi.fn().mockResolvedValue({
          externalRepositoryId: 'github:42',
          ref: 'refs/heads/main',
          commit: 'a'.repeat(40),
        }),
        resolveSourceRepository: vi.fn().mockResolvedValue({
          connection: {id: triggerConnectionId, provider: 'github', slug: 'github-main'},
          repository: {
            externalRepositoryId: 'github:42',
            owner: 'acme',
            name: 'api',
            fullName: 'acme/api',
            defaultBranch: 'main',
            visibility: 'private' as const,
            cloneUrl: 'https://github.com/acme/api.git',
            htmlUrl: 'https://github.com/acme/api',
          },
        }),
      } as never;
      const projects = {
        getProjectBySource: vi.fn().mockResolvedValue({project: {id: 'project-1'}}),
      } as never;

      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel(),
        triggerConnectionId,
        triggerPayload: {
          provider: 'github',
          source: 'github-main',
          event: 'push',
          deliveryId: 'delivery-1',
          data: {ref: 'refs/heads/main', headCommitSha: 'a'.repeat(40)},
        },
        integrations,
        projects,
      });

      const triggerReference = {
        project: {id: 'project-1'},
        repository: 'acme/api',
        ref: 'refs/heads/main',
        commit: 'a'.repeat(40),
      };
      expect(run.triggerReference).toEqual(triggerReference);
      await expect(
        db()
          .select({triggerReference: workflowRuns.triggerReference})
          .from(workflowRuns)
          .where(eq(workflowRuns.id, run.id)),
      ).resolves.toEqual([{triggerReference}]);
    });

    test('creates a run when trigger enrichment fails', async () => {
      const triggerConnectionId = crypto.randomUUID();
      const integrations = {
        resolveTriggerReference: vi.fn().mockResolvedValue({
          externalRepositoryId: 'github:42',
          ref: 'refs/heads/main',
          commit: 'a'.repeat(40),
        }),
        resolveSourceRepository: vi.fn().mockRejectedValue(new Error('source unavailable')),
      } as never;
      const projects = {
        getProjectBySource: vi.fn().mockResolvedValue({project: {id: 'project-1'}}),
      } as never;

      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel(),
        triggerConnectionId,
        triggerPayload: {
          provider: 'github',
          source: 'github-main',
          event: 'push',
          deliveryId: 'delivery-1',
          data: {ref: 'refs/heads/main', headCommitSha: 'a'.repeat(40)},
        },
        integrations,
        projects,
      });

      expect(run.triggerReference).toBeNull();
      await expect(
        db()
          .select({triggerReference: workflowRuns.triggerReference})
          .from(workflowRuns)
          .where(eq(workflowRuns.id, run.id)),
      ).resolves.toEqual([{triggerReference: null}]);
    });

    test('resolves and persists a dynamic run name while preserving the static snapshot', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          name: 'Deploy application',
          runName: `Deploy ${template('event.environment')}`,
        }),
        triggerPayload: {
          source: 'github',
          event: 'deployment',
          deliveryId: 'delivery-1',
          data: {environment: 'production'},
        },
      });

      expect(run).toMatchObject({
        name: 'Deploy production',
        workflowName: 'Deploy application',
        nameOverride: 'Deploy production',
      });
      await expect(getWorkflowRunById(run.id)).resolves.toMatchObject({
        name: 'Deploy production',
        workflowName: 'Deploy application',
        nameOverride: 'Deploy production',
      });
    });

    test('loads referenced variables before resolving the run name', async () => {
      const secrets = createTestSecretsClient();
      await secrets.setSecrets({
        workspaceId,
        projectId,
        namespace: '',
        values: {ENVIRONMENT: 'staging'},
      });

      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({runName: `Deploy ${template('vars.ENVIRONMENT')}`}),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
        secrets,
      });

      expect(run).toMatchObject({
        name: 'Deploy staging',
        workflowName: 'Test Workflow',
        nameOverride: 'Deploy staging',
      });
    });

    test('creates the run when only the run name references variables without a secrets client', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          name: 'Deploy application',
          runName: template('vars.ENVIRONMENT'),
        }),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });

      expect(run).toMatchObject({
        name: 'Deploy application',
        workflowName: 'Deploy application',
        nameOverride: null,
      });
      await expect(getJobsByWorkflowRunId(run.id)).resolves.toHaveLength(1);
    });

    test('falls back to the static name when run-name resolution cannot produce a value', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          name: 'Deploy application',
          runName: template('event.environment'),
        }),
        triggerPayload: {
          source: 'github',
          event: 'deployment',
          deliveryId: 'delivery-1',
          data: {},
        },
      });

      expect(run).toMatchObject({
        name: 'Deploy application',
        workflowName: 'Deploy application',
        nameOverride: null,
      });
      await expect(
        db()
          .select({name: workflowRuns.name, workflowName: workflowRuns.workflowName})
          .from(workflowRuns)
          .where(eq(workflowRuns.id, run.id)),
      ).resolves.toEqual([{name: null, workflowName: 'Deploy application'}]);
      await expect(getJobsByWorkflowRunId(run.id)).resolves.toHaveLength(1);
    });

    test('inserts run, jobs, and steps atomically', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel(),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
        resolveAgentDefaults: resolveTestAgentDefaults,
      });

      expect(run.id).toBeDefined();
      expect(run.projectId).toBe(projectId);
      expect(run.definitionId).toBe(definitionId);
      expect(run.number).toBe(1);
      expect(run.status).toBe('pending');
      expect(run.triggerProvider).toBeNull();
      expect(run.triggerPayload).toMatchObject({source: 'manual', event: 'fire'});
      expect(run.inputs).toBeNull();
      expect(run.version).toBe(1);
      expect(run.createdAt).toBeInstanceOf(Date);
      expect(run.updatedAt).toBeInstanceOf(Date);

      const runJobs = await getJobsByWorkflowRunId(run.id);
      expect(runJobs).toHaveLength(1);
      expect(runJobs[0]?.key).toBe('build');
      expect(runJobs[0]?.name).toBeNull();
      expect(runJobs[0]?.checkout).toEqual({
        permissions: {contents: 'read'},
        persistCredentials: true,
      });

      const jobExecutions = await getJobExecutionsByJobId(runJobs[0]?.id as string);
      expect(jobExecutions).toHaveLength(1);
      expect(jobExecutions[0]).toMatchObject({
        jobId: runJobs[0]?.id,
        sequence: 1,
        nameOverride: null,
        name: 'build',
        runner: ['ubuntu-latest'],
        evaluationTrace: null,
      });

      // Every job gets a synthetic "Set up job" step at position 0; user steps follow.
      const jobSteps = await getStepsByJobId(runJobs[0]?.id as string);
      expect(jobSteps).toHaveLength(2);
      expect(jobSteps.every((step) => step.jobExecutionId === jobExecutions[0]?.id)).toBe(true);
      expect(jobSteps[0]).toMatchObject({
        type: 'setup',
        name: 'Set up job',
        position: 0,
        config: {
          checkout: {
            permissions: {contents: 'read'},
            persist_credentials: true,
          },
        },
      });
      expect(jobSteps[1]).toMatchObject({position: 1, config: {run: 'echo hello'}});
    });

    test('allocates distinct consecutive numbers for concurrent creations of one definition', async () => {
      const [first, second] = await Promise.all([
        createWorkflowRun({
          workspaceId,
          projectId,
          definitionId,
          model: buildModel({name: 'First'}),
          triggerPayload: {
            source: 'manual',
            event: 'fire',
            subscriptionId: crypto.randomUUID(),
            userId: crypto.randomUUID(),
          },
        }),
        createWorkflowRun({
          workspaceId,
          projectId,
          definitionId,
          model: buildModel({name: 'Second'}),
          triggerPayload: {
            source: 'manual',
            event: 'fire',
            subscriptionId: crypto.randomUUID(),
            userId: crypto.randomUUID(),
          },
        }),
      ]);

      expect([first.number, second.number].sort((a, b) => a - b)).toEqual([1, 2]);
      const [counter] = await db()
        .select()
        .from(workflowRunCounters)
        .where(eq(workflowRunCounters.definitionId, definitionId));
      expect(counter?.nextNumber).toBe(3);
    });

    test('makes the allocated number available to run-creation expressions', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            build: {
              executionName: `Build #${template('run.number')}`,
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
      const [job] = await getJobsByWorkflowRunId(run.id);
      if (!job) throw new Error('Expected workflow job');
      const [execution] = await getJobExecutionsByJobId(job.id);

      expect(execution?.name).toBe('Build #1');
    });

    test('rolls back number allocation when creation rolls back', async () => {
      await expect(
        createWorkflowRun({
          workspaceId,
          projectId,
          definitionId,
          model: buildModel({env: {TOKEN: template('vars.TOKEN')}}),
          triggerPayload: {
            source: 'manual',
            event: 'fire',
            subscriptionId: crypto.randomUUID(),
            userId: crypto.randomUUID(),
          },
        }),
      ).rejects.toThrow('Secrets client is not configured.');

      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel(),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });

      expect(run.number).toBe(1);
      const [counter] = await db()
        .select()
        .from(workflowRunCounters)
        .where(eq(workflowRunCounters.definitionId, definitionId));
      expect(counter?.nextNumber).toBe(2);
    });

    test('numbers definitions independently within one project', async () => {
      const otherDefinitionId = crypto.randomUUID();
      const first = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel(),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });
      const second = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId: otherDefinitionId,
        model: buildModel(),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });

      expect(first.number).toBe(1);
      expect(second.number).toBe(1);
    });

    async function createJobOutputRun() {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            build: {
              steps: [{key: 'pack', run: 'echo pack'}],
              outputs: {
                image_sha: template('steps.pack.outputs.sha'),
              },
            },
            deploy: {
              needs: 'build',
              steps: [
                {
                  key: 'deploy',
                  run: 'deploy',
                  env: {IMAGE_SHA: template('jobs.build.outputs.image_sha')},
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
        resolveAgentDefaults: resolveTestAgentDefaults,
      });
      const [build, deploy] = await getJobsByWorkflowRunId(run.id);
      if (!build || !deploy) throw new Error('Expected build and deploy jobs');
      const [buildExecution] = await getJobExecutionsByJobId(build.id);
      if (!buildExecution) throw new Error('Expected build execution');
      const [buildSetup, pack] = await getStepsByJobId(build.id);
      if (!buildSetup || !pack) throw new Error('Expected build steps');
      const [deploySetup] = await getStepsByJobId(deploy.id);
      if (!deploySetup) throw new Error('Expected deploy setup step');

      return {run, build, deploy, buildExecution, buildSetup, pack, deploySetup};
    }

    async function recordBuildStepOutputs(state: Awaited<ReturnType<typeof createJobOutputRun>>) {
      await nextStepForJob(state.build.id);
      await recordStepResult({
        jobExecutionId: state.buildExecution.id,
        stepId: state.buildSetup.id,
        status: 'succeeded',
      });
      await nextStepForJob(state.build.id);
      await recordStepResult({
        jobExecutionId: state.buildExecution.id,
        stepId: state.pack.id,
        status: 'succeeded',
        output: {sha: 'abc123'},
      });
    }

    test('persists mapped outputs on the succeeded job execution', async () => {
      const state = await createJobOutputRun();
      await recordBuildStepOutputs(state);

      const outputExecution = await updateJobExecutionStatus({
        jobExecutionId: state.buildExecution.id,
        expectedVersion: state.buildExecution.version,
        status: 'succeeded',
      });

      expect(outputExecution.outputs).toEqual({image_sha: 'abc123'});
    });

    test('reduces the latest succeeded execution outputs onto the job', async () => {
      const state = await createJobOutputRun();
      await recordBuildStepOutputs(state);
      await updateJobExecutionStatus({
        jobExecutionId: state.buildExecution.id,
        expectedVersion: state.buildExecution.version,
        status: 'succeeded',
      });

      await resolveJobStatusFromJobExecutions({jobId: state.build.id});

      const [build] = (await getJobsByWorkflowRunId(state.run.id)).filter(
        (job) => job.id === state.build.id,
      );
      expect(build?.outputs).toEqual({image_sha: 'abc123'});
    });

    test('fills dependent step configs from direct dependency job outputs', async () => {
      const state = await createJobOutputRun();
      await recordBuildStepOutputs(state);
      await updateJobExecutionStatus({
        jobExecutionId: state.buildExecution.id,
        expectedVersion: state.buildExecution.version,
        status: 'succeeded',
      });
      await resolveJobStatusFromJobExecutions({jobId: state.build.id});
      await nextStepForJob(state.deploy.id);
      const [deployExecution] = await getJobExecutionsByJobId(state.deploy.id);
      if (!deployExecution) throw new Error('Expected deploy execution');
      await recordStepResult({
        jobExecutionId: deployExecution.id,
        stepId: state.deploySetup.id,
        status: 'succeeded',
      });

      const deployStep = await nextStepForJob(state.deploy.id);

      expect(deployStep).toEqual({
        kind: 'step',
        step: expect.objectContaining({
          key: 'deploy',
          config: expect.objectContaining({env: {IMAGE_SHA: 'abc123'}}),
        }),
        dispatched: true,
      });
    });

    test('creates a run with indexed structured dependency output config', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            review: {
              steps: [{key: 'inspect', run: 'echo inspect'}],
              outputs: {findings: template('steps.inspect.outputs.findings')},
              outputTypes: {
                findings: {
                  kind: 'list',
                  element: {kind: 'object', fields: {severity: 'string'}},
                },
              },
            },
            summarize: {
              needs: 'review',
              steps: [
                {
                  key: 'consume',
                  run: `test "${template('jobs.review.outputs.findings[0].severity')}" = high\necho "structured severity=${template('jobs.review.outputs.findings[0].severity')}"`,
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
        resolveAgentDefaults: resolveTestAgentDefaults,
      });

      const summarize = (await getJobsByWorkflowRunId(run.id)).find(
        (job) => job.key === 'summarize',
      );
      if (!summarize) throw new Error('Expected summarize job');
      const [, consume] = await getStepsByJobId(summarize.id);
      expect(consume?.configPlan).toMatchObject({
        env: {
          __sf_0: {
            segments: [
              {
                kind: 'deferred',
                expression: {source: 'jobs.review.outputs.findings[0].severity'},
              },
            ],
          },
        },
      });
    });

    test('persists the parsed model on the run attempt', async () => {
      const model = buildModel({
        env: {RUN_ID: template('run.id')},
        jobs: {
          build: {
            executionName: `Build ${template('event.ref')}`,
            steps: [
              {
                run: 'npm test',
                env: {REF: template('event.ref')},
                gate: {success: expression('step.exit_code == 0')},
              },
            ],
          },
        },
      });

      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model,
        triggerPayload: {
          source: 'github',
          event: 'push',
          deliveryId: 'delivery-1',
          data: {ref: 'refs/heads/main'},
        },
      });

      const [attemptSummary] = await listRunAttempts({workflowRunId: run.id, projectId});
      const attempt = await getWorkflowRunAttemptById(attemptSummary?.id as string);
      const [runJob] = await getJobsByWorkflowRunId(run.id);
      if (!runJob) throw new Error('Expected workflow job');
      const [jobExecution] = await getJobExecutionsByJobId(runJob.id);

      expect(attempt?.model).toEqual(model);
      expect(jobExecution).toMatchObject({
        name: 'Build refs/heads/main',
        evaluationTrace: [
          {
            expression: 'event.ref',
            roots: ['event'],
            fillTarget: 'execution-creation',
            evaluatedAt: 'execution-creation',
            value: 'refs/heads/main',
            field: 'job.execution_name',
          },
        ],
      });
    });

    test('loads predicate vars once and persists the run-creation snapshot', async () => {
      const secrets = createTestSecretsClient();
      const values = {
        JOB_IF: 'true',
        JOB_SUCCESS: 'true',
        STEP_IF: 'true',
        GATE_SUCCESS: 'true',
        LISTENER_ON: 'true',
        LISTENER_UNTIL: 'true',
      };
      await secrets.setSecrets({workspaceId, projectId, values});

      const model = workflowModel({
        jobs: {
          build: {
            if: 'vars.JOB_IF == "true"',
            success: 'vars.JOB_SUCCESS == "true"',
            steps: [
              {
                if: expression('vars.STEP_IF == "true"'),
                gate: {success: expression('vars.GATE_SUCCESS == "true"')},
                run: 'echo build',
              },
            ],
          },
          listen: {
            listening: {
              on: [{source: 'github', event: 'push', filter: 'vars.LISTENER_ON == "true"'}],
              until: [
                {source: 'github', event: 'pull_request', filter: 'vars.LISTENER_UNTIL == "true"'},
              ],
              onResolve: 'finish',
            },
            steps: [{run: 'echo listen'}],
          },
        },
      });

      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model,
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
        secrets,
      });

      const [attempt] = await listRunAttempts({workflowRunId: run.id, projectId});

      expect(attempt?.vars).toEqual(values);
    });

    test('evaluates job and step predicates from the persisted vars snapshot', async () => {
      const secrets = createTestSecretsClient();
      await secrets.setSecrets({workspaceId, projectId, values: {ENABLED: 'true'}});
      const model = workflowModel({
        jobs: {
          build: {
            if: 'vars.ENABLED == "true"',
            steps: [{if: expression('vars.ENABLED == "true"'), run: 'echo build'}],
          },
        },
      });

      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model,
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
        secrets,
      });
      await secrets.setSecrets({workspaceId, projectId, values: {ENABLED: 'false'}});

      const [job] = await getJobsByWorkflowRunId(run.id);
      if (!job) throw new Error('Expected workflow job');
      const activation = await evaluateJobActivations({
        runAttemptId: job.workflowRunAttemptId,
        jobs: [{jobId: job.id, expectedVersion: job.version}],
      });
      expect(activation).toEqual([{kind: 'start-job', jobId: job.id}]);

      const [execution] = await getJobExecutionsByJobId(job.id);
      if (!execution) throw new Error('Expected job execution');
      const setup = await nextStepForJob(job.id);
      if (setup.kind !== 'step') throw new Error('Expected setup step');
      expect(setup).toMatchObject({kind: 'step', step: {type: 'setup'}});
      await recordStepResult({
        jobExecutionId: execution.id,
        stepId: setup.step.id,
        status: 'succeeded',
      });

      const guarded = await nextStepForJob(job.id);
      expect(guarded).toMatchObject({kind: 'step', step: {position: 1}, dispatched: true});
    });

    test('returns the persisted model in run detail', async () => {
      const model = buildModel({
        env: {RUN_ID: template('run.id')},
        jobs: {
          build: {
            steps: [{run: 'echo first'}, {run: 'echo second'}],
          },
        },
      });
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model,
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });

      const detail = await getWorkflowRunDetail(run.id);

      expect(detail?.runAttempt.model).toEqual(model);
      expect(detail?.jobs).toHaveLength(1);
      expect(detail?.jobs[0]?.jobExecutions[0]?.steps).toHaveLength(3);
    });

    test('persists explicit checkout policy on jobs', async () => {
      const run = await createWorkflowRun({
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
              steps: [{run: 'echo hello'}],
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

      const runJobs = await getJobsByWorkflowRunId(run.id);
      expect(runJobs[0]?.checkout).toEqual({
        permissions: {contents: 'write'},
        persistCredentials: false,
      });
    });

    test('persists listening job config without initial execution or steps', async () => {
      const displayNameSource = ['Review batch $', '{{ execution.index }}'].join('');
      const stepNameSource = ['Review $', '{{ execution.index }}'].join('');
      const promptSource = ['Review $', '{{ execution.events[0].data.body }}'].join('');
      const model = workflowModel({
        name: 'Listening workflow',
        runner: 'ubuntu-latest',
        jobs: {
          listen: {
            name: 'Process review',
            executionName: displayNameSource,
            listening: {
              on: [{source: 'github', event: 'pull_request_review'}],
              until: [{source: 'github', event: 'pull_request'}],
              timeoutMs: 30 * 24 * 60 * 60 * 1000,
              maxExecutions: 3,
              batch: {debounceMs: 5000, maxSize: 10, maxWaitMs: 60 * 60 * 1000},
              onResolve: 'cancel',
            },
            steps: [{name: stepNameSource, prompt: promptSource}],
          },
          build: {
            steps: [{run: 'echo build'}],
          },
        },
      });

      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model,
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });

      const runJobs = await getJobsByWorkflowRunId(run.id);
      const listen = runJobs.find((job) => job.key === 'listen');
      const build = runJobs.find((job) => job.key === 'build');
      expect(listen).toMatchObject({
        mode: 'listening',
        name: 'Process review',
        listeningTimeoutMs: 30 * 24 * 60 * 60 * 1000,
        maxExecutions: 3,
        onResolve: 'cancel',
        batchDebounceMs: 5000,
        batchMaxSize: 10,
        batchMaxWaitMs: 60 * 60 * 1000,
        listenerStatus: 'inactive',
        resolutionReason: null,
        listeningOn: [{source: 'github', event: 'pull_request_review'}],
        listeningUntil: [{source: 'github', event: 'pull_request'}],
      });
      expect(build).toMatchObject({mode: 'one_shot', listenerStatus: 'inactive'});

      const listenExecutions = await getJobExecutionsByJobId(listen?.id as string);
      const listenSteps = await getStepsByJobId(listen?.id as string);
      expect(listenExecutions).toEqual([]);
      expect(listenSteps).toEqual([]);

      const buildExecutions = await getJobExecutionsByJobId(build?.id as string);
      const buildSteps = await getStepsByJobId(build?.id as string);
      expect(buildExecutions).toHaveLength(1);
      expect(buildSteps).toHaveLength(2);
      expect(buildSteps[0]).toMatchObject({type: 'setup', name: 'Set up job', position: 0});
      expect(buildSteps[1]).toMatchObject({type: 'run', config: {run: 'echo build'}, position: 1});
    });

    test('persists the listening workflow model on the run attempt', async () => {
      const displayNameSource = ['Review batch $', '{{ execution.index }}'].join('');
      const promptSource = ['Review $', '{{ execution.events[0].data.body }}'].join('');
      const model = workflowModel({
        name: 'Listening workflow',
        runner: 'ubuntu-latest',
        jobs: {
          listen: {
            name: 'Process review',
            executionName: displayNameSource,
            listening: {
              on: [{source: 'github', event: 'pull_request_review'}],
              until: [{source: 'github', event: 'pull_request'}],
              timeoutMs: 30 * 24 * 60 * 60 * 1000,
              maxExecutions: 3,
              batch: {debounceMs: 5000, maxSize: 10, maxWaitMs: 60 * 60 * 1000},
              onResolve: 'cancel',
            },
            steps: [{prompt: promptSource}],
          },
          build: {
            steps: [{run: 'echo build'}],
          },
        },
      });

      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model,
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });

      const [attemptSummary] = await listRunAttempts({workflowRunId: run.id, projectId});
      const attempt = await getWorkflowRunAttemptById(attemptSummary?.id as string);
      expect(attempt?.model).toEqual(model);
    });

    test('does not load variables referenced only by listening job executions at run creation', async () => {
      const model = workflowModel({
        name: 'Listening vars workflow',
        runner: 'ubuntu-latest',
        jobs: {
          listen: {
            listening: {
              on: [{source: 'github', event: 'pull_request_review'}],
              until: [{source: 'github', event: 'pull_request'}],
              onResolve: 'finish',
            },
            steps: [
              {
                run: 'echo region',
                env: {REGION: template('vars.REGION')},
              },
            ],
          },
        },
      });

      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model,
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });

      const runJobs = await getJobsByWorkflowRunId(run.id);
      const listen = runJobs[0];
      expect(listen).toMatchObject({mode: 'listening'});
      await expect(getJobExecutionsByJobId(listen?.id as string)).resolves.toEqual([]);
    });

    test.each([
      {
        field: 'run',
        model: () =>
          workflowModel({
            name: 'Missing run var',
            runner: 'ubuntu-latest',
            jobs: {build: {steps: [{run: `echo ${template('vars.REQUIRED')}`}]}},
          }),
        expected: {field: 'run', source: 'vars.REQUIRED'},
      },
      {
        field: 'env',
        model: () =>
          workflowModel({
            name: 'Missing env var',
            runner: 'ubuntu-latest',
            jobs: {
              build: {
                steps: [{run: 'echo ok', env: {REGION: template('vars.REQUIRED')}}],
              },
            },
          }),
        expected: {field: 'env', envKey: 'REGION', source: 'vars.REQUIRED'},
      },
      {
        field: 'agent.prompt',
        model: () =>
          workflowModel({
            name: 'Missing prompt var',
            runner: 'ubuntu-latest',
            jobs: {fix: {steps: [{prompt: template('vars.REQUIRED')}]}},
          }),
        expected: {field: 'agent.prompt', source: 'vars.REQUIRED'},
      },
      {
        field: 'agent.model',
        model: () =>
          workflowModel({
            name: 'Missing model var',
            runner: 'ubuntu-latest',
            jobs: {fix: {steps: [{prompt: 'Fix it', model: template('vars.REQUIRED')}]}},
          }),
        expected: {field: 'agent.model', source: 'vars.REQUIRED'},
      },
      {
        field: 'agent.provider',
        model: () =>
          workflowModel({
            name: 'Missing provider var',
            runner: 'ubuntu-latest',
            jobs: {fix: {steps: [{prompt: 'Fix it', provider: template('vars.REQUIRED')}]}},
          }),
        expected: {field: 'agent.provider', source: 'vars.REQUIRED'},
      },
      {
        field: 'agent.session',
        model: () =>
          workflowModel({
            name: 'Missing session var',
            runner: 'ubuntu-latest',
            jobs: {fix: {steps: [{prompt: 'Fix it', session: template('vars.REQUIRED')}]}},
          }),
        expected: {field: 'agent.session', source: 'vars.REQUIRED'},
      },
      {
        field: 'job.runner',
        model: () =>
          workflowModel({
            name: 'Missing runner var',
            runner: 'ubuntu-latest',
            jobs: {
              build: {
                runner: [],
                runnerTemplates: [template('vars.REQUIRED')],
                steps: [{run: 'echo ok'}],
              },
            },
          }),
        expected: {field: 'job.runner', source: 'vars.REQUIRED'},
      },
      {
        field: 'step.name',
        model: () =>
          workflowModel({
            name: 'Missing step name var',
            runner: 'ubuntu-latest',
            jobs: {build: {steps: [{name: template('vars.REQUIRED'), run: 'echo ok'}]}},
          }),
        expected: {field: 'step.name', source: 'vars.REQUIRED'},
      },
      {
        field: 'step.working_directory',
        model: () =>
          workflowModel({
            name: 'Missing working directory var',
            runner: 'ubuntu-latest',
            jobs: {
              build: {
                steps: [{workingDirectory: template('vars.REQUIRED'), run: 'echo ok'}],
              },
            },
          }),
        expected: {field: 'step.working_directory', source: 'vars.REQUIRED'},
      },
      {
        field: 'tool.with',
        model: () =>
          workflowModel({
            name: 'Missing tool with var',
            runner: 'ubuntu-latest',
            jobs: {
              build: {
                steps: [
                  {
                    tool: 'get_issue',
                    connection: 'linear-main',
                    with: {id: template('vars.REQUIRED')},
                  },
                ],
              },
            },
          }),
        expected: {field: 'tool.with', source: 'vars.REQUIRED'},
      },
      {
        field: 'tool.outputs',
        model: () =>
          workflowModel({
            name: 'Missing tool output var',
            runner: 'ubuntu-latest',
            jobs: {
              build: {
                steps: [
                  {
                    tool: 'get_issue',
                    connection: 'linear-main',
                    with: {id: 'ENG-1'},
                    outputs: {sev: template('vars.REQUIRED')},
                  },
                ],
              },
            },
          }),
        expected: {field: 'tool.outputs', envKey: 'sev', source: 'vars.REQUIRED'},
      },
      {
        field: 'checkout.repository',
        model: () =>
          workflowModel({
            name: 'Missing checkout repository var',
            runner: 'ubuntu-latest',
            jobs: {
              build: {
                steps: [
                  {
                    checkout: {
                      repository: template('vars.REQUIRED'),
                      fetchDepth: 1,
                      permissions: {contents: 'read'},
                      persistCredentials: true,
                      templates: {
                        repository: checkoutTemplate(template('vars.REQUIRED')),
                      },
                    },
                  },
                ],
              },
            },
          }),
        expected: {field: 'checkout.repository', source: 'vars.REQUIRED'},
      },
    ] as const)('reports missing variables against $field', async ({model, expected}) => {
      let error: unknown;
      try {
        await createWorkflowRun({
          workspaceId,
          projectId,
          definitionId,
          model: model(),
          triggerPayload: {
            source: 'manual',
            event: 'fire',
            subscriptionId: crypto.randomUUID(),
            userId: crypto.randomUUID(),
          },
          secrets: createTestSecretsClient(),
        });
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(InterpolationUnresolvableError);
      expect(error).toMatchObject(expected);
    });

    test('resolves a working directory that references a workspace variable', async () => {
      const secrets = createTestSecretsClient();
      await secrets.setSecrets({
        workspaceId,
        namespace: '',
        values: {BUILD_DIR: 'packages/api'},
      });
      const model = workflowModel({
        name: 'Working directory from var',
        runner: 'ubuntu-latest',
        jobs: {
          build: {
            steps: [{workingDirectory: template('vars.BUILD_DIR'), run: 'echo ok'}],
          },
        },
      });

      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model,
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
        secrets,
      });

      const [build] = await getJobsByWorkflowRunId(run.id);
      const [, step] = await getStepsByJobId(build?.id as string);
      expect(step?.config).toMatchObject({run: 'echo ok', working_directory: 'packages/api'});
    });

    test('writes workflows.workflow_run_attempt.created outbox event in same transaction', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel(),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });

      const outboxRows = await db()
        .select()
        .from(workflowsOutbox)
        .where(eq(workflowsOutbox.eventType, WORKFLOWS_WORKFLOW_RUN_ATTEMPT_CREATED));

      const matchingRow = outboxRows.find(
        (row) => (row.payload as Record<string, unknown>).workflowRunId === run.id,
      );

      expect(matchingRow).toBeDefined();
      expect(matchingRow?.payload).toMatchObject({
        workflowRunId: run.id,
        attempt: 1,
        workspaceId: run.workspaceId,
        projectId: run.projectId,
        definitionId: run.definitionId,
      });
      expect(matchingRow?.orderingKey).toBe(run.id);
      expect(matchingRow?.dispatchedAt).toBeNull();
    });

    test('persists resolved step config and authored step config separately', async () => {
      const model = workflowModel({
        name: 'Interpolated workflow',
        runner: 'ubuntu-latest',
        env: {RUN_ID: template('run.id'), REF: template('event.ref')},
        jobs: {
          build: {
            steps: [{run: `echo "${template('run.id')}"`}],
          },
        },
      });

      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model,
        triggerPayload: {
          source: 'github',
          event: 'push',
          deliveryId: 'delivery-1',
          data: {ref: 'refs/heads/main'},
        },
      });

      const [job] = await getJobsByWorkflowRunId(run.id);
      const rows = (await getStepsByJobId(job?.id as string)).map((step) => ({
        type: step.type,
        config: step.config,
        authoredConfig: step.authoredConfig,
      }));

      expect(rows[1]).toEqual({
        type: 'run',
        config: {
          run: `echo "${shellRef('__sf_0')}"`,
          env: {RUN_ID: run.id, REF: 'refs/heads/main', __sf_0: run.id},
        },
        authoredConfig: {
          run: `echo "${template('run.id')}"`,
          env: {RUN_ID: template('run.id'), REF: template('event.ref')},
        },
      });

      const steps = await getStepsByJobId(job?.id as string);
      expect(steps[1]?.authoredConfig).toEqual({
        run: `echo "${template('run.id')}"`,
        env: {RUN_ID: template('run.id'), REF: template('event.ref')},
      });
    });

    test('resolves webhook trigger payload body and headers into step config', async () => {
      const model = workflowModel({
        name: 'Webhook workflow',
        runner: 'ubuntu-latest',
        env: {
          PAYMENT_ID: template('event.body.payment_id'),
          SIGNATURE: template('event.headers["x-stripe-signature"]'),
        },
        jobs: {
          build: {
            steps: [{run: 'echo webhook'}],
          },
        },
      });

      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model,
        triggerPayload: {
          provider: 'webhook',
          source: 'stripe_prod',
          event: 'received',
          deliveryId: 'delivery-1',
          data: {
            method: 'POST',
            headers: {'x-stripe-signature': 'sig_123'},
            query: {mode: 'live'},
            body: {payment_id: 'pay_123'},
          },
        },
      });

      const [job] = await getJobsByWorkflowRunId(run.id);
      const steps = await getStepsByJobId(job?.id as string);

      expect(steps[1]?.config).toEqual({
        run: 'echo webhook',
        env: {
          PAYMENT_ID: 'pay_123',
          SIGNATURE: 'sig_123',
        },
      });
    });

    test('fails for missing available untrusted interpolation paths', async () => {
      const model = workflowModel({
        name: 'Diagnostic workflow',
        runner: 'ubuntu-latest',
        env: {REF: template('event.ref')},
        jobs: {
          build: {
            steps: [{run: 'echo ok'}],
          },
        },
      });

      let error: unknown;
      try {
        await createWorkflowRun({
          workspaceId,
          projectId,
          definitionId,
          model,
          triggerPayload: {
            source: 'github',
            event: 'push',
            deliveryId: 'delivery-1',
            data: {},
          },
        });
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(InterpolationUnresolvableError);
      expect(error).toMatchObject({
        field: 'env',
        source: 'event.ref',
        envKey: 'REF',
      });
      const runs = await db()
        .select()
        .from(workflowRuns)
        .where(
          and(
            eq(workflowRuns.workspaceId, workspaceId),
            eq(workflowRuns.definitionId, definitionId),
          ),
        );
      expect(runs).toEqual([]);
    });

    test('rolls back outbox event when transaction fails', async () => {
      const marker = crypto.randomUUID();

      const transaction = db().transaction(async (tx) => {
        await tx.insert(workflowsOutbox).values({
          eventType: WORKFLOWS_WORKFLOW_RUN_ATTEMPT_CREATED,
          payload: {workflowRunId: marker, projectId, definitionId},
        });
        throw new Error('Simulated failure');
      });

      await expect(transaction).rejects.toThrow('Simulated failure');

      const leaked = await db()
        .select()
        .from(workflowsOutbox)
        .where(sql`${workflowsOutbox.payload}->>'workflowRunId' = ${marker}`);

      expect(leaked).toHaveLength(0);
    });

    test('normalizes needs string to array', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            build: {steps: [{run: 'echo build'}]},
            test: {needs: 'build', steps: [{run: 'echo test'}]},
          },
        }),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });

      const runJobs = await getJobsByWorkflowRunId(run.id);
      const testJob = runJobs.find((j) => j.key === 'test');

      expect(testJob?.dependencies).toEqual(['build']);
    });

    test('normalizes needs undefined to empty array', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel(),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });

      const runJobs = await getJobsByWorkflowRunId(run.id);

      expect(runJobs[0]?.dependencies).toEqual([]);
    });

    test('stores authored agent tools with runtime agent defaults resolved', async () => {
      const run = await createWorkflowRun({
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
        resolveAgentDefaults: resolveTestAgentDefaults,
      });

      const runJobs = await getJobsByWorkflowRunId(run.id);
      const jobSteps = await getStepsByJobId(runJobs[0]?.id as string);
      const agentStep = jobSteps.find((step) => step.type === 'agent');

      expect(agentStep).toMatchObject({
        type: 'agent',
        config: {
          harness: 'pi',
          model: 'claude-opus-4-8',
          provider: 'anthropic',
          thinking: 'xhigh',
          tools: ['read', 'web_search'],
          prompt: 'Fix the failing tests.',
        },
      });
    });

    test('stores agent step config resolved by the injected resolver', async () => {
      const resolveAgentDefaults = vi.fn<AgentDefaultsResolver>().mockReturnValue({
        harness: 'pi',
        provider: 'openai',
        model: 'gpt-5.5-pro',
        thinking: 'medium',
      });

      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            fix: {steps: [{prompt: 'Fix the failing tests.'}]},
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

      const runJobs = await getJobsByWorkflowRunId(run.id);
      const jobSteps = await getStepsByJobId(runJobs[0]?.id as string);
      const agentStep = jobSteps.find((step) => step.type === 'agent');
      expect(resolveAgentDefaults).toHaveBeenCalledWith({
        harness: undefined,
        provider: undefined,
        model: undefined,
        thinking: undefined,
      });
      expect(agentStep?.config).toEqual({
        harness: 'pi',
        model: 'gpt-5.5-pro',
        provider: 'openai',
        thinking: 'medium',
        prompt: 'Fix the failing tests.',
      });
    });

    test('handles multi-job definitions with correct positions', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            lint: {steps: [{run: 'echo lint'}]},
            build: {steps: [{run: 'echo build'}]},
            test: {needs: ['lint', 'build'], steps: [{run: 'echo test'}]},
          },
        }),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });

      const runJobs = await getJobsByWorkflowRunId(run.id);

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
        model: buildModel({jobs: {}}),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });

      expect(run.id).toBeDefined();

      const runJobs = await getJobsByWorkflowRunId(run.id);

      expect(runJobs).toHaveLength(0);
    });

    test('handles job with zero steps', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            empty: {steps: []},
          },
        }),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });

      const runJobs = await getJobsByWorkflowRunId(run.id);
      expect(runJobs).toHaveLength(1);

      // A job with no user steps still gets the synthetic setup step.
      const jobSteps = await getStepsByJobId(runJobs[0]?.id as string);

      expect(jobSteps).toHaveLength(1);
      expect(jobSteps[0]).toMatchObject({type: 'setup', name: 'Set up job', position: 0});
    });

    test('stores step display names', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            build: {
              steps: [{name: 'Install deps', run: 'npm install'}, {run: 'npm build'}],
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

      const runJobs = await getJobsByWorkflowRunId(run.id);
      const jobSteps = await getStepsByJobId(runJobs[0]?.id as string);

      // Index 0 is the synthetic setup step; user steps start at index 1.
      expect(jobSteps[0]?.name).toBe('Set up job');
      expect(jobSteps[1]?.name).toBe('Install deps');
      expect(jobSteps[2]?.name).toBe('npm build');
    });

    test('stores source locations for authored steps', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            build: {
              steps: [
                {run: 'npm install', sourceLocation: {startLine: 5, endLine: 6}},
                {run: 'npm test', sourceLocation: {startLine: 7, endLine: 10}},
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
      });

      const runJobs = await getJobsByWorkflowRunId(run.id);
      const jobSteps = await getStepsByJobId(runJobs[0]?.id as string);

      expect(jobSteps.map((step) => step.sourceLocation)).toEqual([
        null,
        {startLine: 5, endLine: 6},
        {startLine: 7, endLine: 10},
      ]);
    });

    test('stores frozen step config', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            build: {steps: [{run: 'make build'}]},
          },
        }),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });

      const runJobs = await getJobsByWorkflowRunId(run.id);
      const jobSteps = await getStepsByJobId(runJobs[0]?.id as string);

      // Index 0 is the synthetic setup step; the user run step is at index 1.
      expect(jobSteps[1]?.type).toBe('run');
      expect(jobSteps[1]?.config).toEqual({run: 'make build'});
    });

    test('stores inputs when provided', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel(),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
        inputs: {env: 'staging', verbose: true},
      });

      expect(run.inputs).toEqual({env: 'staging', verbose: true});
    });

    test('stores the exact source snapshot when provided', async () => {
      const sourceContent = `name: Exact
  # keep comment and spacing
  jobs:
    build:
      steps:
        - run: echo "hello"
  `;

      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({name: 'Exact'}),
        sourceSnapshot: {content: sourceContent, format: 'yaml'},
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });

      const found = await getWorkflowRunById(run.id);

      expect(run.sourceSnapshot).toEqual({content: sourceContent, format: 'yaml'});
      expect(found?.sourceSnapshot).toEqual({content: sourceContent, format: 'yaml'});
    });

    test('accepts a source snapshot at the exact UTF-8 byte limit', async () => {
      const sourceContent = 'a'.repeat(WORKFLOW_SOURCE_SNAPSHOT_MAX_BYTES);

      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel(),
        sourceSnapshot: {content: sourceContent, format: 'yaml'},
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });

      expect(run.sourceSnapshot).toEqual({content: sourceContent, format: 'yaml'});
    });

    test('stores null source snapshot when omitted', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel(),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });

      const found = await getWorkflowRunById(run.id);

      expect(run.sourceSnapshot).toBeNull();
      expect(found?.sourceSnapshot).toBeNull();
    });

    test('rejects a source snapshot above the approved byte limit before allocating a run number', async () => {
      const sourceSnapshot = {
        content: '🙂'.repeat(Math.ceil(WORKFLOW_SOURCE_SNAPSHOT_MAX_BYTES / 4) + 1),
        format: 'yaml' as const,
      };
      const measuredBytes = Buffer.byteLength(sourceSnapshot.content, 'utf8');

      await expect(
        createWorkflowRun({
          workspaceId,
          projectId,
          definitionId,
          model: buildModel(),
          sourceSnapshot,
          triggerPayload: {
            source: 'manual',
            event: 'fire',
            subscriptionId: crypto.randomUUID(),
            userId: crypto.randomUUID(),
          },
        }),
      ).rejects.toEqual(
        expect.objectContaining<Partial<WorkflowSourceSnapshotTooLargeError>>({
          limitBytes: WORKFLOW_SOURCE_SNAPSHOT_MAX_BYTES,
          measuredBytes,
          overshootBytes: measuredBytes - WORKFLOW_SOURCE_SNAPSHOT_MAX_BYTES,
        }),
      );

      await expect(
        db()
          .select()
          .from(workflowRunCounters)
          .where(eq(workflowRunCounters.definitionId, definitionId)),
      ).resolves.toHaveLength(0);
    });

    test('duplicate triggerIdempotencyKey returns the existing run without writing jobs/steps/outbox a second time', async () => {
      const subscriptionId = crypto.randomUUID();
      const eventId = crypto.randomUUID();
      const idempotencyKey = `${subscriptionId}:${eventId}`;
      const model = buildModel({name: 'Original idempotent model'});

      const first = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model,
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId,
          userId: crypto.randomUUID(),
        },
        sourceSnapshot: {content: 'name: Original\njobs: {}\n', format: 'yaml'},
        triggerIdempotencyKey: idempotencyKey,
      });
      const second = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({name: 'Mutated idempotent model'}),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId,
          userId: crypto.randomUUID(),
        },
        sourceSnapshot: {content: 'name: Mutated\njobs: {}\n', format: 'yaml'},
        triggerIdempotencyKey: idempotencyKey,
      });

      expect(second.id).toBe(first.id);
      expect(second.number).toBe(first.number);
      expect(second.triggerIdempotencyKey).toBe(idempotencyKey);
      expect(second.sourceSnapshot).toEqual({
        content: 'name: Original\njobs: {}\n',
        format: 'yaml',
      });

      const allJobs = await getJobsByWorkflowRunId(first.id);
      expect(allJobs).toHaveLength(1);
      const attempts = await listRunAttempts({workflowRunId: first.id, projectId});
      expect(attempts).toHaveLength(1);
      expect(attempts[0]?.model).toEqual(model);
      const outboxRows = await db()
        .select()
        .from(workflowsOutbox)
        .where(sql`${workflowsOutbox.payload}->>'workflowRunId' = ${first.id}`);
      expect(outboxRows).toHaveLength(1);
      const [counter] = await db()
        .select()
        .from(workflowRunCounters)
        .where(eq(workflowRunCounters.definitionId, definitionId));
      expect(counter?.nextNumber).toBe(2);
    });

    test('duplicate triggerIdempotencyKey returns the persisted run name without reevaluating it', async () => {
      const idempotencyKey = crypto.randomUUID();
      const first = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          name: 'Deploy application',
          runName: `Deploy ${template('event.environment')}`,
        }),
        triggerPayload: {
          source: 'github',
          event: 'deployment',
          deliveryId: 'delivery-1',
          data: {environment: 'production'},
        },
        triggerIdempotencyKey: idempotencyKey,
      });
      const replay = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          name: 'Changed workflow',
          runName: `Changed ${template('event.environment')}`,
        }),
        triggerPayload: {
          source: 'github',
          event: 'deployment',
          deliveryId: 'delivery-2',
          data: {environment: 'staging'},
        },
        triggerIdempotencyKey: idempotencyKey,
      });

      expect(replay).toMatchObject({
        id: first.id,
        name: 'Deploy production',
        workflowName: 'Deploy application',
        nameOverride: 'Deploy production',
      });
    });

    test('duplicate triggerIdempotencyKey returns the existing run without re-materializing', async () => {
      const subscriptionId = crypto.randomUUID();
      const eventId = crypto.randomUUID();
      const idempotencyKey = `${subscriptionId}:${eventId}`;
      const model = buildModel({
        jobs: {
          fix: {steps: [{prompt: 'Fix the failing tests.'}]},
        },
      });
      const firstResolver = vi.fn<AgentDefaultsResolver>().mockReturnValue({
        harness: 'pi',
        provider: 'openai',
        model: 'gpt-5.5-pro',
        thinking: 'medium',
      });
      const secondResolver = vi.fn<AgentDefaultsResolver>().mockImplementation(() => {
        throw new Error('agent defaults unavailable');
      });
      const first = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model,
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId,
          userId: crypto.randomUUID(),
        },
        triggerIdempotencyKey: idempotencyKey,
        resolveAgentDefaults: firstResolver,
      });

      const replay = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model,
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId,
          userId: crypto.randomUUID(),
        },
        triggerIdempotencyKey: idempotencyKey,
        resolveAgentDefaults: secondResolver,
      });

      expect(replay.id).toBe(first.id);
      expect(firstResolver).toHaveBeenCalledTimes(1);
      expect(secondResolver).not.toHaveBeenCalled();

      const allJobs = await getJobsByWorkflowRunId(first.id);
      expect(allJobs).toHaveLength(1);
    });

    test('null triggerIdempotencyKey allows independent inserts', async () => {
      const a = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel(),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });
      const b = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel(),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });

      expect(b.id).not.toBe(a.id);
      expect(a.triggerIdempotencyKey).toBeNull();
      expect(b.triggerIdempotencyKey).toBeNull();
    });
  });
});
