import {workflowSpecSchema} from '@shipfox/api-definitions-dto';
import yaml from 'js-yaml';
import type {WorkflowSpec} from './entities/definition.js';
import {DagValidationError, validateDag} from './validate-dag.js';

export type ValidationError = {message: string; path?: string | undefined};

export type ValidationResult =
  | {valid: true; spec: WorkflowSpec}
  | {valid: false; errors: ValidationError[]};

export function validateDefinition(yamlContent: string): ValidationResult {
  let parsed: unknown;
  try {
    parsed = yaml.load(yamlContent);
  } catch (error) {
    return {
      valid: false,
      errors: [
        {message: `Invalid YAML syntax: ${error instanceof Error ? error.message : String(error)}`},
      ],
    };
  }

  if (
    parsed === null ||
    parsed === undefined ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed)
  ) {
    return {
      valid: false,
      errors: [{message: 'Workflow definition must be a YAML object'}],
    };
  }

  const result = workflowSpecSchema.safeParse(parsed);
  if (!result.success) {
    return {
      valid: false,
      errors: result.error.issues.map((issue) => ({
        message: issue.message,
        path: issue.path.join('.'),
      })),
    };
  }

  const spec = result.data as WorkflowSpec;

  try {
    validateDag(spec.jobs);
  } catch (error) {
    if (error instanceof DagValidationError) {
      return {
        valid: false,
        errors: [{message: error.message, path: error.cycle?.join(' -> ')}],
      };
    }
    throw error;
  }

  return {valid: true, spec};
}
