import {z} from 'zod';
import {type WorkflowDocument, workflowDocumentSchema} from './workflow-document.js';

export const invalidWorkflowDocumentErrorCode = 'invalid-workflow-document';

export class InvalidWorkflowDocumentError extends Error {
  readonly code = invalidWorkflowDocumentErrorCode;
  readonly validationError: z.ZodError<WorkflowDocument>;

  constructor(validationError: z.ZodError<WorkflowDocument>, cause: unknown = validationError) {
    super('Invalid workflow document', {cause});
    this.name = 'InvalidWorkflowDocumentError';
    this.validationError = validationError;
  }
}

export function parseWorkflowDocument(input: unknown): WorkflowDocument {
  try {
    const result = workflowDocumentSchema.safeParse(input);
    if (result.success) return result.data;

    throw new InvalidWorkflowDocumentError(result.error as z.ZodError<WorkflowDocument>);
  } catch (error) {
    if (error instanceof InvalidWorkflowDocumentError) throw error;

    const validationError = new z.ZodError([
      {
        code: 'custom',
        path: [],
        message: 'Workflow document could not be parsed.',
      },
    ]) as z.ZodError<WorkflowDocument>;
    throw new InvalidWorkflowDocumentError(validationError, error);
  }
}
