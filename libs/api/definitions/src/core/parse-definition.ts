import type {WorkflowSpec} from './entities/definition.js';
import {DefinitionParseError} from './errors.js';
import {validateDefinition} from './validate-definition.js';

export function parseDefinition(yamlString: string): WorkflowSpec {
  const result = validateDefinition(yamlString);

  if (!result.valid) {
    throw new DefinitionParseError(
      result.errors[0]?.message ?? 'Invalid definition',
      result.errors,
    );
  }

  return result.spec;
}
