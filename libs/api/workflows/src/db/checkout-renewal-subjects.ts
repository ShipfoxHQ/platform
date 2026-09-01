import {and, eq} from 'drizzle-orm';
import {getCheckoutPolicy} from '#core/checkout.js';
import type {CheckoutRenewalSubject} from '#core/entities/checkout-renewal-subject.js';
import {normalizeRepositoryUrl} from '#core/entities/checkout-renewal-subject.js';
import {db, type Tx, withTransaction} from './db.js';
import {checkoutRenewalSubjects} from './schema/checkout-renewal-subjects.js';
import {jobExecutions} from './schema/job-executions.js';
import {jobs} from './schema/jobs.js';
import {stepAttempts} from './schema/step-attempts.js';
import {steps} from './schema/steps.js';
import {workflowRunAttempts} from './schema/workflow-run-attempts.js';
import {workflowRuns} from './schema/workflow-runs.js';

export interface SavePendingCheckoutRenewalSubjectParams extends CheckoutRenewalSubject {
  jobExecutionId: string;
  workflowRunAttemptId: string;
}

/**
 * Stores the first non-secret subject issued for the current running step attempt.
 * A repeated initial-token request cannot replace the frozen subject.
 */
export async function savePendingCheckoutRenewalSubject(
  params: SavePendingCheckoutRenewalSubjectParams,
  transaction?: Tx,
): Promise<boolean> {
  if (transaction === undefined) {
    return withTransaction((tx) => savePendingCheckoutRenewalSubject(params, tx));
  }

  const repositoryUrl = normalizeRepositoryUrlSafely(params.repositoryUrl);
  if (repositoryUrl === null || params.externalRepositoryId.trim().length === 0) return false;

  const [context] = await transaction
    .select({
      jobExecutionId: steps.jobExecutionId,
      workflowRunAttemptId: jobs.workflowRunAttemptId,
      currentAttempt: steps.currentAttempt,
      status: steps.status,
      config: steps.config,
    })
    .from(steps)
    .innerJoin(jobExecutions, eq(jobExecutions.id, steps.jobExecutionId))
    .innerJoin(jobs, eq(jobs.id, jobExecutions.jobId))
    .where(eq(steps.id, params.stepId))
    .limit(1)
    .for('update', {of: [steps]});

  const policy = context === undefined ? null : getCheckoutPolicy(context.config);
  const isCurrentPersistedCheckout =
    context !== undefined &&
    context.jobExecutionId === params.jobExecutionId &&
    context.workflowRunAttemptId === params.workflowRunAttemptId &&
    context.currentAttempt === params.attempt &&
    context.status === 'running' &&
    policy?.persistCredentials === true &&
    policy?.permissionsContents === params.permissions.contents;
  if (!isCurrentPersistedCheckout) return false;

  const inserted = await transaction
    .insert(checkoutRenewalSubjects)
    .values({
      stepId: params.stepId,
      workflowRunAttemptId: params.workflowRunAttemptId,
      attempt: params.attempt,
      repositoryUrl,
      connectionId: params.connectionId,
      externalRepositoryId: params.externalRepositoryId,
      permissionsContents: params.permissions.contents,
    })
    .onConflictDoNothing({
      target: [checkoutRenewalSubjects.stepId, checkoutRenewalSubjects.attempt],
    })
    .returning({id: checkoutRenewalSubjects.id});
  if (inserted.length > 0) return true;

  const [existing] = await transaction
    .select({
      workflowRunAttemptId: checkoutRenewalSubjects.workflowRunAttemptId,
      repositoryUrl: checkoutRenewalSubjects.repositoryUrl,
      connectionId: checkoutRenewalSubjects.connectionId,
      externalRepositoryId: checkoutRenewalSubjects.externalRepositoryId,
      permissionsContents: checkoutRenewalSubjects.permissionsContents,
      status: checkoutRenewalSubjects.status,
    })
    .from(checkoutRenewalSubjects)
    .where(
      and(
        eq(checkoutRenewalSubjects.stepId, params.stepId),
        eq(checkoutRenewalSubjects.attempt, params.attempt),
      ),
    )
    .limit(1);
  return (
    existing?.status === 'pending' &&
    existing.workflowRunAttemptId === params.workflowRunAttemptId &&
    existing.repositoryUrl === repositoryUrl &&
    existing.connectionId === params.connectionId &&
    existing.externalRepositoryId === params.externalRepositoryId &&
    existing.permissionsContents === params.permissions.contents
  );
}

/** Promotes a subject only when its exact step attempt completed successfully. */
export async function promoteCheckoutRenewalSubject(
  params: {stepId: string; attempt: number},
  transaction: Tx,
): Promise<boolean> {
  const [context] = await transaction
    .select({
      attemptStatus: stepAttempts.status,
      config: steps.config,
    })
    .from(stepAttempts)
    .innerJoin(steps, eq(steps.id, stepAttempts.stepId))
    .where(and(eq(stepAttempts.stepId, params.stepId), eq(stepAttempts.attempt, params.attempt)))
    .limit(1);
  if (
    context?.attemptStatus !== 'succeeded' ||
    getCheckoutPolicy(context.config)?.persistCredentials !== true
  ) {
    return false;
  }

  const promoted = await transaction
    .update(checkoutRenewalSubjects)
    .set({status: 'promoted', promotedAt: new Date()})
    .where(
      and(
        eq(checkoutRenewalSubjects.stepId, params.stepId),
        eq(checkoutRenewalSubjects.attempt, params.attempt),
        eq(checkoutRenewalSubjects.status, 'pending'),
      ),
    )
    .returning({id: checkoutRenewalSubjects.id});
  return promoted.length > 0;
}

export async function discardPendingCheckoutRenewalSubject(
  params: {stepId: string; attempt: number},
  transaction: Tx,
): Promise<void> {
  await transaction
    .delete(checkoutRenewalSubjects)
    .where(
      and(
        eq(checkoutRenewalSubjects.stepId, params.stepId),
        eq(checkoutRenewalSubjects.attempt, params.attempt),
        eq(checkoutRenewalSubjects.status, 'pending'),
      ),
    );
}

/**
 * Loads only an accepted subject for the step's current attempt. Every relationship and lifecycle
 * check is part of this query so missing, stale, or tampered state returns no authority.
 */
export async function loadCheckoutRenewalSubject(
  stepId: string,
): Promise<CheckoutRenewalSubject | null> {
  await retryPendingCheckoutRenewalSubjectPromotion(stepId);

  const [row] = await db()
    .select({
      subject: checkoutRenewalSubjects,
      stepStatus: steps.status,
      stepCurrentAttempt: steps.currentAttempt,
      stepAttemptStatus: stepAttempts.status,
      config: steps.config,
    })
    .from(checkoutRenewalSubjects)
    .innerJoin(steps, eq(steps.id, checkoutRenewalSubjects.stepId))
    .innerJoin(jobExecutions, eq(jobExecutions.id, steps.jobExecutionId))
    .innerJoin(jobs, eq(jobs.id, jobExecutions.jobId))
    .innerJoin(
      workflowRunAttempts,
      and(
        eq(workflowRunAttempts.id, jobs.workflowRunAttemptId),
        eq(workflowRunAttempts.id, checkoutRenewalSubjects.workflowRunAttemptId),
      ),
    )
    .innerJoin(
      workflowRuns,
      and(
        eq(workflowRuns.id, workflowRunAttempts.workflowRunId),
        eq(workflowRuns.currentAttempt, workflowRunAttempts.attempt),
      ),
    )
    .innerJoin(
      stepAttempts,
      and(
        eq(stepAttempts.stepId, checkoutRenewalSubjects.stepId),
        eq(stepAttempts.attempt, checkoutRenewalSubjects.attempt),
      ),
    )
    .where(
      and(
        eq(checkoutRenewalSubjects.stepId, stepId),
        eq(checkoutRenewalSubjects.status, 'promoted'),
        eq(checkoutRenewalSubjects.attempt, steps.currentAttempt),
        eq(steps.status, 'succeeded'),
        eq(stepAttempts.status, 'succeeded'),
      ),
    )
    .limit(1);

  const policy = row === undefined ? null : getCheckoutPolicy(row.config);
  if (
    row === undefined ||
    row.stepStatus !== 'succeeded' ||
    row.stepAttemptStatus !== 'succeeded' ||
    policy?.persistCredentials !== true ||
    policy?.permissionsContents !== row.subject.permissionsContents ||
    row.stepCurrentAttempt !== row.subject.attempt ||
    row.subject.repositoryUrl !== normalizeRepositoryUrlSafely(row.subject.repositoryUrl) ||
    row.subject.repositoryUrl.length === 0 ||
    row.subject.externalRepositoryId.trim().length === 0
  ) {
    return null;
  }

  return {
    repositoryUrl: row.subject.repositoryUrl,
    connectionId: row.subject.connectionId,
    externalRepositoryId: row.subject.externalRepositoryId,
    permissions: {contents: row.subject.permissionsContents},
    stepId: row.subject.stepId,
    attempt: row.subject.attempt,
  };
}

async function retryPendingCheckoutRenewalSubjectPromotion(stepId: string): Promise<void> {
  await withTransaction(async (tx) => {
    const [pendingSubject] = await tx
      .select({attempt: checkoutRenewalSubjects.attempt})
      .from(checkoutRenewalSubjects)
      .innerJoin(steps, eq(steps.id, checkoutRenewalSubjects.stepId))
      .innerJoin(
        stepAttempts,
        and(
          eq(stepAttempts.stepId, checkoutRenewalSubjects.stepId),
          eq(stepAttempts.attempt, checkoutRenewalSubjects.attempt),
        ),
      )
      .where(
        and(
          eq(checkoutRenewalSubjects.stepId, stepId),
          eq(checkoutRenewalSubjects.status, 'pending'),
          eq(checkoutRenewalSubjects.attempt, steps.currentAttempt),
          eq(steps.status, 'succeeded'),
          eq(stepAttempts.status, 'succeeded'),
        ),
      )
      .limit(1);

    if (pendingSubject !== undefined) {
      await promoteCheckoutRenewalSubject({stepId, attempt: pendingSubject.attempt}, tx);
    }
  });
}

function normalizeRepositoryUrlSafely(repositoryUrl: string): string | null {
  try {
    return normalizeRepositoryUrl(repositoryUrl);
  } catch {
    return null;
  }
}
