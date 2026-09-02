import {annotationsInterModuleContract} from '@shipfox/annotations-dto/inter-module';
import {
  createInterModuleKnownError,
  defineInterModulePresentation,
  type InterModulePresentation,
} from '@shipfox/inter-module';
import {
  AnnotationBodyTooLargeError,
  AnnotationCountLimitExceededError,
  AnnotationTotalBytesLimitExceededError,
} from '#core/errors.js';
import {writeAnnotations} from '#core/write-annotations.js';
import {listAnnotationsForRunAttempt} from '#db/index.js';
import {toAnnotationReadDto} from './dto/annotation.js';

export function createAnnotationsInterModulePresentation(): InterModulePresentation<
  typeof annotationsInterModuleContract
> {
  return defineInterModulePresentation(annotationsInterModuleContract, {
    replaceOrRemoveAnnotation: async (input) => {
      try {
        const {annotation, context, ...target} = input;
        await writeAnnotations({
          ...target,
          operations: [
            annotation.op === 'remove'
              ? {context, style: 'warning', op: 'remove'}
              : {context, ...annotation},
          ],
        });
        return {};
      } catch (error) {
        throw toReplaceOrRemoveAnnotationKnownError(error);
      }
    },
    listAnnotationsForRunAttempt: async (input) => {
      const result = await listAnnotationsForRunAttempt({
        workflowRunId: input.workflowRunId,
        workflowRunAttempt: input.workflowRunAttempt,
        workspaceIds: [input.workspaceId],
        jobExecutionId: input.jobExecutionId,
        after: input.cursor ? {sequence: input.cursor.value, id: input.cursor.id} : undefined,
        limit: input.limit,
      });

      return {
        annotations: result.annotations.map(toAnnotationReadDto),
        hasMore: result.hasMore,
        nextCursor: result.nextCursor
          ? {value: result.nextCursor.sequence, id: result.nextCursor.id}
          : null,
      };
    },
  });
}

export function toReplaceOrRemoveAnnotationKnownError(error: unknown): unknown {
  const method = annotationsInterModuleContract.methods.replaceOrRemoveAnnotation;
  if (error instanceof AnnotationBodyTooLargeError) {
    return createInterModuleKnownError(method, 'annotation-body-too-large', {
      maxBytes: error.maxBytes,
    });
  }
  if (error instanceof AnnotationCountLimitExceededError) {
    return createInterModuleKnownError(method, 'annotation-count-limit-exceeded', {
      maxAnnotations: error.maxAnnotations,
    });
  }
  if (error instanceof AnnotationTotalBytesLimitExceededError) {
    return createInterModuleKnownError(method, 'annotation-total-bytes-limit-exceeded', {
      maxBytes: error.maxBytes,
    });
  }
  return error;
}
