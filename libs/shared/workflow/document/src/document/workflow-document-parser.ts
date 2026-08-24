import type {z} from 'zod';
import {type WorkflowDocument, workflowDocumentSchema} from './workflow-document.js';

export const invalidWorkflowDocumentErrorCode = 'invalid-workflow-document';

export class InvalidWorkflowDocumentError extends Error {
  readonly code = invalidWorkflowDocumentErrorCode;
  readonly validationError: z.ZodError<WorkflowDocument>;

  constructor(validationError: z.ZodError<WorkflowDocument>) {
    super('Invalid workflow document', {cause: validationError});
    this.name = 'InvalidWorkflowDocumentError';
    this.validationError = validationError;
  }
}

export function parseWorkflowDocument(input: unknown): WorkflowDocument {
  const result = workflowDocumentSchema.safeParse(input);
  if (result.success) return result.data as WorkflowDocument;

  // The step schema also parses the reserved tool-step `outputs` mapping form;
  // every successful parse still carries only declaration-form outputs, so the
  // widened schema output and error types narrow to the exported types here.
  throw new InvalidWorkflowDocumentError(result.error as z.ZodError<WorkflowDocument>);
}
