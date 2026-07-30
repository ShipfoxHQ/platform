import {readPersistedWorkflowModel} from '@shipfox/api-definitions-dto';
import {and, asc, eq, inArray, sql} from 'drizzle-orm';
import {isWorkflowRunTerminal, type WorkflowRun} from '#core/entities/workflow-run.js';
import {NoFailedJobsError, RunNotTerminalError, SourceRunNotFoundError} from '#core/errors.js';
import {deriveJobExecutionRunner} from '#core/workflow-run-creation.js';
import {recordWorkflowRunCreated} from '#metrics/instance.js';
import {db, type Tx} from '../db.js';
import {type JobExecutionDb, jobExecutions} from '../schema/job-executions.js';
import {type JobDb, jobs} from '../schema/jobs.js';
import {type StepDb, steps} from '../schema/steps.js';
import {type WorkflowRunAttemptDb, workflowRunAttempts} from '../schema/workflow-run-attempts.js';
import {toWorkflowRun, workflowRuns} from '../schema/workflow-runs.js';
import {type MaterializedRunGraphJob, persistMaterializedRunGraph} from './run-graph.js';
import {lockWorkflowRun} from './shared.js';

export interface CreateRerunWorkflowRunParams {
  workflowRunId: string;
  mode: 'all' | 'failed';
  actorUserId: string;
}

export async function createRerunWorkflowRun(
  params: CreateRerunWorkflowRunParams,
): Promise<WorkflowRun> {
  const result = await db().transaction(async (tx) => {
    const workflowRunId = params.workflowRunId;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${workflowRunId}))`);

    const sourceRow = await lockWorkflowRun(workflowRunId, tx);
    if (!sourceRow) throw new SourceRunNotFoundError(workflowRunId);

    const [sourceAttemptRow] = await tx
      .select()
      .from(workflowRunAttempts)
      .where(
        and(
          eq(workflowRunAttempts.workflowRunId, sourceRow.id),
          eq(workflowRunAttempts.attempt, sourceRow.currentAttempt),
        ),
      )
      .limit(1)
      .for('update');
    if (!sourceAttemptRow) {
      throw new Error(
        `Current attempt ${sourceRow.currentAttempt} missing for run ${sourceRow.id}`,
      );
    }
    if (!isWorkflowRunTerminal(sourceAttemptRow.status)) {
      throw new RunNotTerminalError(sourceRow.id);
    }

    const sourceJobs = await tx
      .select()
      .from(jobs)
      .where(eq(jobs.workflowRunAttemptId, sourceAttemptRow.id))
      .orderBy(asc(jobs.position), asc(jobs.id));

    if (
      params.mode === 'failed' &&
      !sourceJobs.some((job) => job.status === 'failed' || job.status === 'cancelled')
    ) {
      throw new NoFailedJobsError(sourceRow.id);
    }

    const [attemptRow] = await tx
      .select({value: sql<number>`coalesce(max(${workflowRunAttempts.attempt}), 1)`})
      .from(workflowRunAttempts)
      .where(eq(workflowRunAttempts.workflowRunId, sourceRow.id));
    const attempt = Number(attemptRow?.value ?? 1) + 1;

    const [newAttemptRow] = await tx
      .insert(workflowRunAttempts)
      .values({
        workflowRunId: sourceRow.id,
        attempt,
        status: 'pending',
        rerunMode: params.mode,
        rerunByUserId: params.actorUserId,
        model: sourceAttemptRow.model,
        vars: sourceAttemptRow.vars,
        agentToolMaterialization: sourceAttemptRow.agentToolMaterialization,
      })
      .returning();
    if (!newAttemptRow) throw new Error('Insert returned no rows');

    const sourceGraph = await loadRerunSourceGraph(tx, sourceJobs);

    const sourceRun = toWorkflowRun(sourceRow);
    const graphJobs = materializeRerunGraphJobs({
      mode: params.mode,
      sourceRun,
      sourceAttempt: sourceAttemptRow,
      sourceJobs,
      ...sourceGraph,
    });
    await persistMaterializedRunGraph(tx, {
      run: sourceRun,
      workflowRunAttempt: newAttemptRow,
      materializedJobs: graphJobs,
    });

    const [newRunRow] = await tx
      .update(workflowRuns)
      .set({
        currentAttempt: attempt,
        status: 'pending',
        version: sql`${workflowRuns.version} + 1`,
        updatedAt: new Date(),
        startedAt: null,
        finishedAt: null,
      })
      .where(eq(workflowRuns.id, sourceRow.id))
      .returning();
    if (!newRunRow) throw new Error(`Workflow run missing after rerun: ${sourceRow.id}`);

    return toWorkflowRun(newRunRow);
  });

  recordWorkflowRunCreated(result.triggerPayload.provider ?? result.triggerSource);

  return result;
}

async function loadRerunSourceGraph(
  tx: Tx,
  sourceJobs: readonly JobDb[],
): Promise<{
  readonly sourceJobExecutionByJobId: ReadonlyMap<string, JobExecutionDb>;
  readonly sourceJobByJobExecutionId: ReadonlyMap<string, JobDb>;
  readonly sourceSteps: readonly StepDb[];
}> {
  const sourceJobIds = sourceJobs.map((job) => job.id);
  const sourceJobExecutionRows =
    sourceJobIds.length === 0
      ? []
      : await tx
          .select()
          .from(jobExecutions)
          .where(inArray(jobExecutions.jobId, sourceJobIds))
          .orderBy(asc(jobExecutions.jobId), asc(jobExecutions.sequence), asc(jobExecutions.id));
  const sourceJobExecutionByJobId = new Map<string, JobExecutionDb>();
  for (const jobExecution of sourceJobExecutionRows) {
    if (!sourceJobExecutionByJobId.has(jobExecution.jobId)) {
      sourceJobExecutionByJobId.set(jobExecution.jobId, jobExecution);
    }
  }

  const sourceJobExecutionIds = [...sourceJobExecutionByJobId.values()].map(
    (jobExecution) => jobExecution.id,
  );
  const sourceSteps =
    sourceJobExecutionIds.length === 0
      ? []
      : await tx
          .select()
          .from(steps)
          .where(inArray(steps.jobExecutionId, sourceJobExecutionIds))
          .orderBy(asc(steps.jobExecutionId), asc(steps.position), asc(steps.id));

  const sourceJobById = new Map(sourceJobs.map((job) => [job.id, job]));
  const sourceJobByJobExecutionId = new Map(
    [...sourceJobExecutionByJobId.entries()].flatMap(([jobId, jobExecution]) => {
      const job = sourceJobById.get(jobId);
      return job ? [[jobExecution.id, job] as const] : [];
    }),
  );

  return {sourceJobExecutionByJobId, sourceJobByJobExecutionId, sourceSteps};
}

function materializeRerunGraphJobs(params: {
  readonly mode: CreateRerunWorkflowRunParams['mode'];
  readonly sourceRun: WorkflowRun;
  readonly sourceAttempt: WorkflowRunAttemptDb;
  readonly sourceJobs: readonly JobDb[];
  readonly sourceJobExecutionByJobId: ReadonlyMap<string, JobExecutionDb>;
  readonly sourceJobByJobExecutionId: ReadonlyMap<string, JobDb>;
  readonly sourceSteps: readonly StepDb[];
}): readonly MaterializedRunGraphJob[] {
  const sourceModel =
    params.sourceAttempt.model === null
      ? null
      : readPersistedWorkflowModel(params.sourceAttempt.model);
  const sourceModelJobByKey = new Map((sourceModel?.jobs ?? []).map((job) => [job.key, job]));
  const sourceStepsByJobId = new Map<string, StepDb[]>();
  for (const step of params.sourceSteps) {
    const sourceJob = params.sourceJobByJobExecutionId.get(step.jobExecutionId);
    if (!sourceJob) continue;
    const sourceJobSteps = sourceStepsByJobId.get(sourceJob.id) ?? [];
    sourceJobSteps.push(step);
    sourceStepsByJobId.set(sourceJob.id, sourceJobSteps);
  }

  return params.sourceJobs.map((sourceJob) => {
    const carriedOver = params.mode === 'failed' && sourceJob.status === 'succeeded';

    return {
      job: {
        key: sourceJob.key,
        name: sourceJob.name,
        mode: sourceJob.mode,
        status: carriedOver ? ('succeeded' as const) : ('pending' as const),
        statusReason: null,
        carriedOver,
        checkoutPersistCredentials: sourceJob.checkoutPersistCredentials,
        checkoutPermissionsContents: sourceJob.checkoutPermissionsContents,
        success: sourceJob.success,
        executionTimeoutMs: sourceJob.executionTimeoutMs,
        listeningTimeoutMs: sourceJob.listeningTimeoutMs,
        maxExecutions: sourceJob.maxExecutions,
        onResolve: sourceJob.onResolve,
        batchDebounceMs: sourceJob.batchDebounceMs,
        batchMaxSize: sourceJob.batchMaxSize,
        batchMaxWaitMs: sourceJob.batchMaxWaitMs,
        listenerStatus: 'inactive' as const,
        resolutionReason: null,
        listeningOn: sourceJob.listeningOn ? [...sourceJob.listeningOn] : null,
        listeningUntil: sourceJob.listeningUntil ? [...sourceJob.listeningUntil] : null,
        outputs: carriedOver && sourceJob.outputs ? {...sourceJob.outputs} : null,
        dependencies: [...sourceJob.dependencies],
        runner: sourceJob.runner ? [...sourceJob.runner] : null,
        position: sourceJob.position,
      },
      createExecution: (job) => {
        if (job.mode === 'listening') return undefined;

        const sourceExecution = params.sourceJobExecutionByJobId.get(sourceJob.id);
        const modelJob = sourceModelJobByKey.get(job.key);
        const nameOverride = sourceExecution?.name ?? null;
        const executionName = nameOverride ?? job.name ?? job.key;
        const runner =
          carriedOver || modelJob === undefined
            ? (sourceExecution?.runner ?? job.runner ?? null)
            : deriveJobExecutionRunner({
                run: params.sourceRun,
                modelJob,
                jobId: job.id,
                sequence: 1,
                nameOverride,
                executionName,
                jobName: job.name,
                status: 'pending',
              });

        return {
          sequence: 1,
          // Reruns preserve the authored/resolved override, never the
          // effective fallback exposed by the core entity.
          name: nameOverride,
          runner: runner ? [...runner] : null,
          status: carriedOver ? ('succeeded' as const) : ('pending' as const),
          statusReason: null,
          outputs: carriedOver && sourceExecution?.outputs ? {...sourceExecution.outputs} : null,
          ...(carriedOver ? {finishedAt: sql`now()`} : {}),
        };
      },
      createSteps: () =>
        (sourceStepsByJobId.get(sourceJob.id) ?? []).map((step) => ({
          key: step.key,
          name: step.name,
          sourceLocation: step.sourceLocation,
          status: carriedOver ? step.status : ('pending' as const),
          statusReason: carriedOver ? step.statusReason : null,
          type: step.type,
          config: step.config,
          condition: step.condition ?? null,
          configPlan: step.configPlan,
          authoredConfig: step.authoredConfig,
          error: null,
          position: step.position,
          currentAttempt: 1,
        })),
    };
  });
}
