import type {ValidationDiagnostic} from './entities/validation-diagnostic.js';
import type {WorkflowDefinitionPayload} from './entities/workflow-definition.js';
import {DefinitionParseError} from './errors.js';
import {type DefinitionValidationOptions, validateDefinition} from './validate-definition.js';

export interface ParsedDefinition extends WorkflowDefinitionPayload {
  diagnostics: ValidationDiagnostic[];
}

export type ParseDefinitionOptions = DefinitionValidationOptions;

export function parseDefinitionWithDiagnostics(
  yamlString: string,
  options: ParseDefinitionOptions,
): ParsedDefinition {
  const result = validateDefinition(yamlString, options);

  if (!result.valid) {
    throw new DefinitionParseError(
      result.errors[0]?.message ?? 'Invalid definition',
      result.errors,
    );
  }

  return {
    ...result.definition,
    sourceSnapshot: {content: yamlString, format: 'yaml'},
    diagnostics: result.diagnostics,
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
