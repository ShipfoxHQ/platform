import {annotationsInterModuleContract} from '@shipfox/annotations-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {eq} from 'drizzle-orm';
import {
  AnnotationBodyTooLargeError,
  AnnotationCountLimitExceededError,
  AnnotationTotalBytesLimitExceededError,
} from '#core/errors.js';
import {db} from '#db/db.js';
import {annotations} from '#db/schema/annotations.js';
import {annotationFactory} from '#test/index.js';
import {
  createAnnotationsInterModulePresentation,
  toReplaceOrRemoveAnnotationKnownError,
} from './inter-module.js';

function input() {
  return {
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    workflowRunId: crypto.randomUUID(),
    workflowRunAttempt: 1,
    workflowRunAttemptId: crypto.randomUUID(),
    jobId: crypto.randomUUID(),
    jobExecutionId: crypto.randomUUID(),
    originStepId: crypto.randomUUID(),
    originStepAttempt: 1,
    context: 'agent-tool-capability:step',
  };
}

describe('Annotations inter-module presentation', () => {
  test('lists only annotations owned by the requested workspace and preserves the cursor', async () => {
    const workspaceId = crypto.randomUUID();
    const workflowRunId = crypto.randomUUID();
    const visible = await annotationFactory.create({
      workspaceId,
      workflowRunId,
      context: 'visible',
      sequence: 1,
    });
    const next = await annotationFactory.create({
      workspaceId,
      workflowRunId,
      context: 'next',
      sequence: 2,
    });
    await annotationFactory.create({
      workspaceId,
      workflowRunId,
      context: 'after',
      sequence: 3,
    });
    await annotationFactory.create({
      workspaceId: crypto.randomUUID(),
      workflowRunId,
      context: 'hidden',
      sequence: 4,
    });
    const presentation = createAnnotationsInterModulePresentation();

    const result = await presentation.handlers.listAnnotationsForRunAttempt(
      {
        workspaceId,
        workflowRunId,
        workflowRunAttempt: 1,
        limit: 2,
      },
      {signal: new AbortController().signal},
    );

    expect(result).toEqual({
      annotations: [
        {
          id: visible.id,
          job_id: visible.jobId,
          job_execution_id: visible.jobExecutionId,
          origin_step_id: visible.originStepId,
          origin_step_attempt: visible.originStepAttempt,
          context: 'visible',
          style: visible.style,
          sequence: 1,
          body: visible.body,
        },
        {
          id: next.id,
          job_id: next.jobId,
          job_execution_id: next.jobExecutionId,
          origin_step_id: next.originStepId,
          origin_step_attempt: next.originStepAttempt,
          context: 'next',
          style: next.style,
          sequence: 2,
          body: next.body,
        },
      ],
      hasMore: true,
      nextCursor: {value: next.sequence, id: next.id},
    });
  });

  test('replaces and removes a warning annotation through PostgreSQL', async () => {
    const presentation = createAnnotationsInterModulePresentation();
    const target = input();
    const handlerContext = {signal: new AbortController().signal};

    await presentation.handlers.replaceOrRemoveAnnotation(
      {
        ...target,
        annotation: {op: 'replace', style: 'warning', body: 'Missing tool'},
      },
      handlerContext,
    );
    const afterReplace = await db()
      .select()
      .from(annotations)
      .where(eq(annotations.jobExecutionId, target.jobExecutionId));

    await presentation.handlers.replaceOrRemoveAnnotation(
      {
        ...target,
        annotation: {op: 'remove'},
      },
      handlerContext,
    );
    const afterRemove = await db()
      .select()
      .from(annotations)
      .where(eq(annotations.jobExecutionId, target.jobExecutionId));

    expect(afterReplace).toHaveLength(1);
    expect(afterReplace[0]).toMatchObject({
      context: target.context,
      style: 'warning',
      body: 'Missing tool',
    });
    expect(afterRemove).toEqual([]);
  });

  test.each([
    ['annotation-body-too-large', () => new AnnotationBodyTooLargeError(10)],
    ['annotation-count-limit-exceeded', () => new AnnotationCountLimitExceededError(10)],
    ['annotation-total-bytes-limit-exceeded', () => new AnnotationTotalBytesLimitExceededError(10)],
  ] as const)('maps %s to the published contract error', (code, createError) => {
    const result = toReplaceOrRemoveAnnotationKnownError(createError());

    expect(
      isInterModuleKnownError(
        annotationsInterModuleContract.methods.replaceOrRemoveAnnotation,
        result,
      ) && result.code,
    ).toBe(code);
  });
});
