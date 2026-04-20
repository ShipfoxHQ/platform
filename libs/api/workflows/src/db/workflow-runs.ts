import type {WorkflowSpec} from '@shipfox/api-definitions';
import {WORKFLOW_RUN_CREATED, type WorkflowsEventMap} from '@shipfox/api-workflows-dto';
import {writeOutboxEvent} from '@shipfox/node-outbox';
import {and, asc, desc, eq, inArray, sql} from 'drizzle-orm';
import type {Job, JobStatus} from '#core/entities/job.js';
import type {Step, StepStatus} from '#core/entities/step.js';
import type {TriggerContext, WorkflowRun, WorkflowRunStatus} from '#core/entities/workflow-run.js';
import {db} from './db.js';
import {jobs, toJob} from './schema/jobs.js';
import {workflowsOutbox} from './schema/outbox.js';
import {steps, toStep} from './schema/steps.js';
import {toWorkflowRun, workflowRuns} from './schema/workflow-runs.js';

export interface CreateWorkflowRunParams {
  workspaceId: string;
  projectId: string;
  definitionId: string;
  definition: WorkflowSpec;
  triggerContext: TriggerContext;
  inputs?: Record<string, unknown> | undefined;
}

function normalizeDependencies(needs: string | string[] | undefined): string[] {
  if (!needs) return [];
  return Array.isArray(needs) ? needs : [needs];
}

function normalizeRunner(runner: string | string[] | undefined): string[] | null {
  if (!runner) return null;
  return Array.isArray(runner) ? runner : [runner];
}

export async function createWorkflowRun(params: CreateWorkflowRunParams): Promise<WorkflowRun> {
  return await db().transaction(async (tx) => {
    const [runRow] = await tx
      .insert(workflowRuns)
      .values({
        workspaceId: params.workspaceId,
        projectId: params.projectId,
        definitionId: params.definitionId,
        status: 'pending',
        triggerContext: params.triggerContext,
        inputs: params.inputs ?? null,
      })
      .returning();
    if (!runRow) throw new Error('Insert returned no rows');

    const jobEntries = Object.entries(params.definition.jobs);
    let jobRows: (typeof jobs.$inferSelect)[] = [];

    if (jobEntries.length > 0) {
      jobRows = await tx
        .insert(jobs)
        .values(
          jobEntries.map(([jobName, jobSpec], index) => ({
            runId: runRow.id,
            name: jobName,
            status: 'pending' as const,
            dependencies: normalizeDependencies(jobSpec.needs),
            runner: normalizeRunner(jobSpec.runner),
            position: index,
          })),
        )
        .returning();
    }

    const stepValues: (typeof steps.$inferInsert)[] = [];
    for (const jobRow of jobRows) {
      const jobSpec = params.definition.jobs[jobRow.name];
      if (!jobSpec) continue;
      for (const [stepIndex, stepSpec] of jobSpec.steps.entries()) {
        stepValues.push({
          jobId: jobRow.id,
          name: stepSpec.name ?? null,
          status: 'pending',
          type: 'run',
          config: {run: stepSpec.run},
          position: stepIndex,
        });
      }
    }

    if (stepValues.length > 0) {
      await tx.insert(steps).values(stepValues);
    }

    await writeOutboxEvent<WorkflowsEventMap>(tx, workflowsOutbox, {
      type: WORKFLOW_RUN_CREATED,
      payload: {
        runId: runRow.id,
        workspaceId: runRow.workspaceId,
        projectId: runRow.projectId,
        definitionId: runRow.definitionId,
      },
    });

    return toWorkflowRun(runRow);
  });
}

export async function getWorkflowRunById(id: string): Promise<WorkflowRun | undefined> {
  const rows = await db().select().from(workflowRuns).where(eq(workflowRuns.id, id)).limit(1);
  const row = rows[0];
  if (!row) return undefined;
  return toWorkflowRun(row);
}

export async function listWorkflowRunsByProject(projectId: string): Promise<WorkflowRun[]> {
  const rows = await db()
    .select()
    .from(workflowRuns)
    .where(eq(workflowRuns.projectId, projectId))
    .orderBy(desc(workflowRuns.createdAt));
  return rows.map(toWorkflowRun);
}

export async function getJobsByRunId(runId: string): Promise<Job[]> {
  const rows = await db()
    .select()
    .from(jobs)
    .where(eq(jobs.runId, runId))
    .orderBy(asc(jobs.position));
  return rows.map(toJob);
}

export async function getStepsByJobId(jobId: string): Promise<Step[]> {
  const rows = await db()
    .select()
    .from(steps)
    .where(eq(steps.jobId, jobId))
    .orderBy(asc(steps.position));
  return rows.map(toStep);
}

export async function getStepsByJobIds(jobIds: string[]): Promise<Step[]> {
  if (jobIds.length === 0) return [];
  const rows = await db()
    .select()
    .from(steps)
    .where(inArray(steps.jobId, jobIds))
    .orderBy(asc(steps.position));
  return rows.map(toStep);
}

export interface UpdateWorkflowRunStatusParams {
  runId: string;
  status: WorkflowRunStatus;
  expectedVersion: number;
}

export async function updateWorkflowRunStatus(
  params: UpdateWorkflowRunStatusParams,
): Promise<WorkflowRun> {
  const rows = await db()
    .update(workflowRuns)
    .set({
      status: params.status,
      version: sql`${workflowRuns.version} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(workflowRuns.id, params.runId), eq(workflowRuns.version, params.expectedVersion)))
    .returning();

  const row = rows[0];
  if (!row)
    throw new Error(
      `Optimistic lock failure: run ${params.runId} version ${params.expectedVersion}`,
    );
  return toWorkflowRun(row);
}

export interface UpdateJobStatusParams {
  jobId: string;
  status: JobStatus;
  expectedVersion: number;
}

export async function updateJobStatus(params: UpdateJobStatusParams): Promise<Job> {
  const rows = await db()
    .update(jobs)
    .set({
      status: params.status,
      version: sql`${jobs.version} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(jobs.id, params.jobId), eq(jobs.version, params.expectedVersion)))
    .returning();

  const row = rows[0];
  if (!row)
    throw new Error(
      `Optimistic lock failure: job ${params.jobId} version ${params.expectedVersion}`,
    );
  return toJob(row);
}

export interface BulkUpdateStepStatusesParams {
  jobId: string;
  status: StepStatus;
}

export async function bulkUpdateStepStatuses(params: BulkUpdateStepStatusesParams): Promise<void> {
  await db()
    .update(steps)
    .set({
      status: params.status,
      updatedAt: new Date(),
    })
    .where(eq(steps.jobId, params.jobId));
}
