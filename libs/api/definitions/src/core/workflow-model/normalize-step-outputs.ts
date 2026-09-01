import {type OutputDeclarations, validateJsonSchema} from '@shipfox/expression';
import type {WorkflowDocumentStep} from '@shipfox/workflow-document';
import type {WorkflowModelValidationIssue} from './invalid-workflow-model-error.js';
import {issue} from './validation-issue.js';

export function normalizeStepOutputs(params: {
  step: WorkflowDocumentStep;
  sourceName: string;
  stepIndex: number;
  issues: WorkflowModelValidationIssue[];
}): OutputDeclarations | undefined {
  if (params.step.tool !== undefined) return undefined;
  const outputs = params.step.outputs;
  if (outputs === undefined) return undefined;

  for (const [key, declaration] of Object.entries(outputs)) {
    const schema = 'schema' in declaration ? declaration.schema : undefined;
    if (declaration.type !== 'json' || schema === undefined) continue;

    const validation = validateJsonSchema(schema);
    if (validation.ok) continue;

    params.issues.push(
      issue({
        code: 'invalid-output-schema',
        message: `Step output "${key}" must declare a valid JSON Schema.`,
        path: ['jobs', params.sourceName, 'steps', params.stepIndex, 'outputs', key, 'schema'],
        details: {
          output: key,
          reason: validation.reason,
        },
      }),
    );
  }

  return outputs;
}
