import type {LeasedWriteAnnotationOperationDto} from '@shipfox/annotations-dto';
import {config} from '#config.js';
import {
  type AnnotationWriteRepository,
  type StoredAnnotation,
  withAnnotationLock,
} from '#db/annotations.js';
import {
  AnnotationBodyTooLargeError,
  AnnotationCountLimitExceededError,
  AnnotationTotalBytesLimitExceededError,
} from './errors.js';

export interface WriteAnnotationsParams {
  workspaceId: string;
  projectId: string;
  workflowRunId: string;
  workflowRunAttempt: number;
  workflowRunAttemptId: string;
  jobId: string;
  jobExecutionId: string;
  originStepId: string;
  originStepAttempt: number;
  operations: readonly LeasedWriteAnnotationOperationDto[];
}

export interface WriteAnnotationsResult {
  annotations: Array<{context: string; id: string | null}>;
  accounting: {
    annotationCount: number;
    totalBodyBytes: number;
  };
}

interface AnnotationWriteState {
  current: Map<string, StoredAnnotation>;
  nextSequence: number;
  results: WriteAnnotationsResult['annotations'];
}

async function applyAnnotationOperation(
  repo: AnnotationWriteRepository,
  params: WriteAnnotationsParams,
  operation: LeasedWriteAnnotationOperationDto,
  state: AnnotationWriteState,
): Promise<void> {
  if (operation.op === 'remove') {
    await repo.removeAnnotation(params.jobExecutionId, operation.context);
    state.current.delete(operation.context);
    state.results.push({context: operation.context, id: null});
    return;
  }

  const existing = state.current.get(operation.context);
  const body =
    operation.op === 'append' ? `${existing?.body ?? ''}${operation.body}` : operation.body;
  const bodyBytes = Buffer.byteLength(body);
  ensureBodyBudget(bodyBytes);
  const unchanged =
    operation.op === 'replace' &&
    existing !== undefined &&
    existing.body === body &&
    existing.style === operation.style;
  if (unchanged) {
    state.results.push({context: operation.context, id: existing.id});
    return;
  }

  const draft = new Map(state.current);
  draft.set(operation.context, {
    id: existing?.id ?? '',
    context: operation.context,
    style: operation.style,
    body,
    bodyBytes,
    sequence: existing?.sequence ?? state.nextSequence,
  });
  ensureExecutionBudgets(draft);

  const row = existing
    ? await repo.updateAnnotation({
        id: existing.id,
        originStepId: params.originStepId,
        originStepAttempt: params.originStepAttempt,
        style: operation.style,
        body,
        bodyBytes,
      })
    : await repo.createAnnotation({
        workspaceId: params.workspaceId,
        projectId: params.projectId,
        workflowRunId: params.workflowRunId,
        workflowRunAttempt: params.workflowRunAttempt,
        workflowRunAttemptId: params.workflowRunAttemptId,
        jobId: params.jobId,
        jobExecutionId: params.jobExecutionId,
        originStepId: params.originStepId,
        originStepAttempt: params.originStepAttempt,
        context: operation.context,
        style: operation.style,
        body,
        bodyBytes,
        sequence: state.nextSequence,
      });
  state.current.set(operation.context, row);
  if (!existing) state.nextSequence += 1;
  state.results.push({context: operation.context, id: row.id});
}

export function writeAnnotations(params: WriteAnnotationsParams): Promise<WriteAnnotationsResult> {
  return withAnnotationLock(params.jobExecutionId, async (repo) => {
    const current = await repo.loadCurrentAnnotations(params.jobExecutionId);
    const state: AnnotationWriteState = {
      current,
      nextSequence:
        Math.max(0, ...Array.from(current.values()).map((annotation) => annotation.sequence)) + 1,
      results: [],
    };

    for (const operation of params.operations) {
      await applyAnnotationOperation(repo, params, operation, state);
    }

    return {
      annotations: state.results,
      accounting: currentAccounting(current),
    };
  });
}

function ensureBodyBudget(bodyBytes: number): void {
  if (bodyBytes > config.ANNOTATIONS_MAX_BODY_BYTES) {
    throw new AnnotationBodyTooLargeError(config.ANNOTATIONS_MAX_BODY_BYTES);
  }
}

function ensureExecutionBudgets(annotationsByContext: ReadonlyMap<string, StoredAnnotation>): void {
  const accounting = currentAccounting(annotationsByContext);
  if (accounting.annotationCount > config.ANNOTATIONS_MAX_PER_EXECUTION) {
    throw new AnnotationCountLimitExceededError(config.ANNOTATIONS_MAX_PER_EXECUTION);
  }
  if (accounting.totalBodyBytes > config.ANNOTATIONS_MAX_TOTAL_BYTES) {
    throw new AnnotationTotalBytesLimitExceededError(config.ANNOTATIONS_MAX_TOTAL_BYTES);
  }
}

function currentAccounting(annotationsByContext: ReadonlyMap<string, StoredAnnotation>) {
  return {
    annotationCount: annotationsByContext.size,
    totalBodyBytes: Array.from(annotationsByContext.values()).reduce(
      (total, annotation) => total + annotation.bodyBytes,
      0,
    ),
  };
}
