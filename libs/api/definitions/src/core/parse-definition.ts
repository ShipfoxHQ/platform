import type {ValidationWarning} from './entities/validation-warning.js';
import type {WorkflowDefinitionPayload} from './entities/workflow-definition.js';
import {DefinitionParseError} from './errors.js';
import {type DefinitionValidationOptions, validateDefinition} from './validate-definition.js';

export interface ParsedDefinition extends WorkflowDefinitionPayload {
  warnings: ValidationWarning[];
}

export type ParseDefinitionOptions = DefinitionValidationOptions;

export function parseDefinitionWithWarnings(
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
    warnings: result.warnings,
  };
}

export function parseDefinition(
  yamlString: string,
  options: ParseDefinitionOptions,
): WorkflowDefinitionPayload {
  const parsed = parseDefinitionWithWarnings(yamlString, options);
  return stripDefinitionWarnings(parsed);
}

export function stripDefinitionWarnings(parsed: ParsedDefinition): WorkflowDefinitionPayload {
  return {
    document: parsed.document,
    model: parsed.model,
    sourceSnapshot: parsed.sourceSnapshot ?? null,
  };
}
