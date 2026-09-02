import type {ValidationDiagnostic} from './entities/validation-diagnostic.js';
import type {WorkflowDefinitionPayload} from './entities/workflow-definition.js';
import {DefinitionParseError} from './errors.js';
import {
  type DefinitionValidationOptions,
  type ValidationError,
  validateDefinition,
} from './validate-definition.js';
import type {WorkflowModelValidationIssue} from './workflow-model/invalid-workflow-model-error.js';

export interface ParsedDefinition extends WorkflowDefinitionPayload {
  diagnostics: ValidationDiagnostic[];
  issues: WorkflowModelValidationIssue[];
}

export type ParseDefinitionOptions = DefinitionValidationOptions;

export function parseDefinitionWithDiagnostics(
  yamlString: string,
  options: ParseDefinitionOptions,
): ParsedDefinition {
  const result = validateDefinition(yamlString, options);

  if (!result.valid) {
    const firstError = result.errors[0];
    const message =
      firstError === undefined ? 'Invalid definition' : formatValidationError(firstError);
    throw new DefinitionParseError(
      `${message}${additionalValidationErrorsSuffix(result.errors.length)}`,
      result.errors,
    );
  }

  return {
    ...result.definition,
    sourceSnapshot: {content: yamlString, format: 'yaml'},
    diagnostics: result.diagnostics,
    issues: result.issues,
  };
}

export function parseDefinition(
  yamlString: string,
  options: ParseDefinitionOptions,
): WorkflowDefinitionPayload {
  const parsed = parseDefinitionWithDiagnostics(yamlString, options);
  return stripDefinitionDiagnostics(parsed);
}

export function stripDefinitionDiagnostics(parsed: ParsedDefinition): WorkflowDefinitionPayload {
  return {
    document: parsed.document,
    model: parsed.model,
    sourceSnapshot: parsed.sourceSnapshot ?? null,
  };
}

function formatValidationError(error: ValidationError): string {
  const path = error.path === undefined || error.path.length === 0 ? '' : ` at ${error.path}`;
  const reason = error.reason === undefined ? '' : `: ${error.reason}`;
  return `${error.message}${path}${reason}`;
}

function additionalValidationErrorsSuffix(errorCount: number): string {
  return errorCount > 1 ? ` (and ${errorCount - 1} more issues)` : '';
}
