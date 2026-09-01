import {eq} from 'drizzle-orm';
import type {WorkflowRun} from '#core/entities/workflow-run.js';
import {db} from '#db/db.js';
import {jobExecutions as jobExecutionsTable} from '#db/schema/job-executions.js';
import {jobs as jobsTable} from '#db/schema/jobs.js';
import {stepAttempts as stepAttemptsTable} from '#db/schema/step-attempts.js';
import {steps as stepsTable} from '#db/schema/steps.js';
import {workflowRunAttempts} from '#db/schema/workflow-run-attempts.js';
import {createWorkflowRun} from '#db/workflow-runs.js';
import {workflowModel} from '../factories/workflow-model.js';

export interface HighCardinalityWorkflowRunParams {
  jobs?: number | undefined;
  dependenciesPerJob?: number | undefined;
  executionsPerJob?: number | undefined;
  stepsPerExecution?: number | undefined;
  attemptsPerStep?: number | undefined;
  invocationsPerAttempt?: number | undefined;
}

export interface HighCardinalityWorkflowRunFixture {
  run: WorkflowRun;
  workflowRunAttemptId: string;
  jobIds: string[];
  executionIds: string[];
  stepIds: string[];
  stepAttemptIds: string[];
  counts: {
    jobs: number;
    dependencyEdges: number;
    executions: number;
    steps: number;
    stepAttempts: number;
    legacyJoinedRows: number;
  };
}

/**
 * Builds a rectangular run graph whose children all exist. This makes the current
 * `jobs -> executions -> steps -> attempts` join amplification reproducible while keeping
 * fixture payloads deterministic and free of real user data.
 */
export async function createHighCardinalityWorkflowRun(
  params: HighCardinalityWorkflowRunParams = {},
): Promise<HighCardinalityWorkflowRunFixture> {
  const jobsCount = positiveCount(params.jobs ?? 4, 'jobs');
  const dependenciesPerJob = boundedCount(params.dependenciesPerJob ?? 1, 'dependenciesPerJob');
  const executionsPerJob = positiveCount(params.executionsPerJob ?? 3, 'executionsPerJob');
  const stepsPerExecution = positiveCount(params.stepsPerExecution ?? 3, 'stepsPerExecution');
  const attemptsPerStep = positiveCount(params.attemptsPerStep ?? 2, 'attemptsPerStep');
  const invocationsPerAttempt = boundedCount(
    params.invocationsPerAttempt ?? 0,
    'invocationsPerAttempt',
  );

  const run = await createWorkflowRun({
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    definitionId: crypto.randomUUID(),
    model: workflowModel({name: 'Measurement fixture', jobs: {}}),
    triggerPayload: {
      source: 'manual',
      event: 'fire',
      subscriptionId: crypto.randomUUID(),
      userId: crypto.randomUUID(),
    },
    inputs: {fixture: 'measurement-input'},
    sourceSnapshot: {format: 'yaml', content: 'measurement-source'},
  });

  const [attempt] = await db()
    .select({id: workflowRunAttempts.id})
    .from(workflowRunAttempts)
    .where(eq(workflowRunAttempts.workflowRunId, run.id))
    .limit(1);
  if (!attempt) throw new Error(`Missing workflow-run attempt for ${run.id}`);

  const jobIds = Array.from({length: jobsCount}, () => crypto.randomUUID());
  const dependencyEdges = jobIds.flatMap((_, jobIndex) =>
    jobIds.slice(Math.max(0, jobIndex - dependenciesPerJob), jobIndex),
  );

  const executionIds: string[] = [];
  const stepIds: string[] = [];
  const stepAttemptIds: string[] = [];

  await db().transaction(async (tx) => {
    await tx.insert(jobsTable).values(
      jobIds.map((id, jobIndex) => ({
        id,
        workflowRunAttemptId: attempt.id,
        key: `measurement-job-${jobIndex}`,
        checkoutPersistCredentials: true,
        checkoutPermissionsContents: 'read' as const,
        dependencies: jobIds.slice(Math.max(0, jobIndex - dependenciesPerJob), jobIndex),
        position: jobIndex,
      })),
    );

    const executionValues = jobIds.flatMap((jobId, jobIndex) =>
      Array.from({length: executionsPerJob}, (_, executionIndex) => {
        const sequence = executionIndex + 1;
        const id = crypto.randomUUID();
        executionIds.push(id);
        const status = executionStatus(sequence, executionsPerJob);
        return {
          id,
          jobId,
          sequence,
          status,
          statusReason: executionStatusReason(status),
          runner: ['measurement-runner'],
          triggerEvents: [],
          ...(status === 'running' ? {startedAt: new Date()} : {}),
          name: `measurement-execution-${jobIndex}-${sequence}`,
        };
      }),
    );
    await tx.insert(jobExecutionsTable).values(executionValues);

    const stepValues = executionIds.flatMap((jobExecutionId, executionIndex) =>
      Array.from({length: stepsPerExecution}, (_, stepIndex) => {
        const id = crypto.randomUUID();
        stepIds.push(id);
        const globalStepIndex = executionIndex * stepsPerExecution + stepIndex;
        return {
          id,
          jobExecutionId,
          key: `measurement-step-${stepIndex}`,
          name: `Measurement step ${stepIndex}`,
          type: stepType(globalStepIndex),
          config: {fixture: 'measurement-config'},
          status: stepStatus(globalStepIndex),
          position: stepIndex,
          ...(executionIndex === 0 && stepIndex === 0
            ? {sourceLocation: {startLine: 1, endLine: 1}}
            : {}),
        };
      }),
    );
    await tx.insert(stepsTable).values(stepValues);

    const attemptValues = stepIds.flatMap((stepId, stepIndex) => {
      const jobExecutionId = executionIds[Math.floor(stepIndex / stepsPerExecution)];
      if (!jobExecutionId) throw new Error(`Missing execution for fixture step ${stepId}`);

      return Array.from({length: attemptsPerStep}, (_, attemptIndex) => {
        const id = crypto.randomUUID();
        stepAttemptIds.push(id);
        return {
          id,
          stepId,
          jobExecutionId,
          attempt: attemptIndex + 1,
          executionOrder: stepIndex * attemptsPerStep + attemptIndex + 1,
          status: stepAttemptStatus(stepIndex * attemptsPerStep + attemptIndex),
          invocations: Array.from({length: invocationsPerAttempt}, (_, invocationIndex) => ({
            call_index: invocationIndex,
            started_at: '2026-01-01T00:00:00.000Z',
            outcome: 'succeeded',
          })),
        };
      });
    });
    await tx.insert(stepAttemptsTable).values(attemptValues);
  });

  return {
    run,
    workflowRunAttemptId: attempt.id,
    jobIds,
    executionIds,
    stepIds,
    stepAttemptIds,
    counts: {
      jobs: jobsCount,
      dependencyEdges: dependencyEdges.length,
      executions: executionIds.length,
      steps: stepIds.length,
      stepAttempts: stepAttemptIds.length,
      legacyJoinedRows: jobsCount * executionsPerJob * stepsPerExecution * attemptsPerStep,
    },
  };
}

function positiveCount(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function boundedCount(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}

function executionStatus(
  sequence: number,
  executionsPerJob: number,
): 'running' | 'succeeded' | 'failed' | 'cancelled' {
  if (executionsPerJob > 1 && sequence === 1) return 'running';
  if (sequence % 3 === 0) return 'failed';
  if (sequence % 2 === 0) return 'cancelled';
  return 'succeeded';
}

function executionStatusReason(
  status: 'running' | 'succeeded' | 'failed' | 'cancelled',
): 'step_failed' | 'user_cancelled' | null {
  if (status === 'failed') return 'step_failed';
  if (status === 'cancelled') return 'user_cancelled';
  return null;
}

function stepType(index: number): 'run' | 'agent' | 'checkout' | 'tool' {
  return (['run', 'agent', 'checkout', 'tool'] as const)[index % 4] ?? 'run';
}

function stepStatus(
  index: number,
): 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'skipped' {
  return (
    (['pending', 'running', 'succeeded', 'failed', 'cancelled', 'skipped'] as const)[index % 6] ??
    'pending'
  );
}

function stepAttemptStatus(index: number): 'running' | 'succeeded' | 'failed' | 'cancelled' {
  return (['running', 'succeeded', 'failed', 'cancelled'] as const)[index % 4] ?? 'running';
}
