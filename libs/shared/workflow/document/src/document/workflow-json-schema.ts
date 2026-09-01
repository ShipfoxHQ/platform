import {z} from 'zod';
import {thinkingLevelsForHarness} from './step-enums.js';
import {
  WORKFLOW_LITERAL_NAME_PATTERN,
  workflowDocumentAgentStepFields,
  workflowDocumentSchema,
  workflowDocumentStepOutputDeclarationSchema,
  workflowDocumentToolStepOutputsSchema,
} from './workflow-document.js';

type JsonSchema = Record<string, unknown>;

export interface BuildWorkflowJsonSchemaOptions {
  id?: string;
}

export function buildWorkflowJsonSchema({
  id = 'https://www.shipfox.io/docs/workflow.schema.json',
}: BuildWorkflowJsonSchemaOptions = {}): JsonSchema {
  const schema = z.toJSONSchema(workflowDocumentSchema, {
    io: 'input',
    unrepresentable: 'any',
  }) as JsonSchema;
  const stepSchema = stepSchemaFor(schema);
  const stepProperties = propertiesOf(stepSchema);
  const thinkingSchema = object(stepProperties.thinking);
  // `thinking` accepts an enum value or a template, so the per-harness branch
  // narrows the enum alternative and keeps the template alternative intact.
  const thinkingBranches = objects(thinkingSchema.anyOf);
  const thinkingEnumBranch = thinkingBranches.find((branch) => Array.isArray(branch.enum)) ?? {};
  const thinkingTemplateBranches = thinkingBranches.filter((branch) => !Array.isArray(branch.enum));

  // `agent` remains reserved. Tool-step fields are now part of the authoring
  // schema and are constrained below by the projected discriminator.
  delete stepProperties.agent;
  projectWorkflowValidation(schema, stepSchema);
  const thinkingConditionals = (['pi', 'claude'] as const).map((harness) => {
    const conditional: JsonSchema = {
      if: {
        properties: {
          harness: {
            ...object(stepProperties.harness),
            const: harness,
          },
        },
        required: ['harness'],
      },
    };
    // biome-ignore lint/suspicious/noThenProperty: JSON Schema uses "then" for a conditional branch.
    conditional.then = {
      properties: {
        thinking: {
          ...(typeof thinkingSchema.description === 'string'
            ? {description: thinkingSchema.description}
            : {}),
          anyOf: [
            {...thinkingEnumBranch, enum: [...thinkingLevelsForHarness(harness)]},
            ...thinkingTemplateBranches,
          ],
        },
      },
    };
    return conditional;
  });
  stepSchema.allOf = [...objects(stepSchema.allOf), ...thinkingConditionals];
  schema.$schema = 'https://json-schema.org/draft/2020-12/schema';
  schema.$id = id;
  schema.title = 'Shipfox Workflow';

  return schema;
}

function projectWorkflowValidation(schema: JsonSchema, stepSchema: JsonSchema) {
  const rootProperties = propertiesOf(schema);
  const jobs = object(rootProperties.jobs);
  const triggers = object(rootProperties.triggers);
  addLiteralNamePattern(rootProperties.name);
  jobs.minProperties = 1;
  triggers.minProperties = 1;

  stepSchema.allOf = [
    ...objects(stepSchema.allOf),
    {
      oneOf: [
        {
          required: ['run'],
          not: {
            anyOf: [
              ...workflowDocumentAgentStepFields.map((field) => ({required: [field]})),
              {required: ['checkout']},
              {required: ['tool']},
              {required: ['connection']},
              {required: ['with']},
            ],
          },
        },
        {
          required: ['prompt'],
          not: {
            anyOf: [
              {required: ['run']},
              {required: ['checkout']},
              {required: ['env']},
              {required: ['tool']},
              {required: ['connection']},
              {required: ['with']},
            ],
          },
        },
        {
          required: ['checkout'],
          not: {
            anyOf: [
              {required: ['run']},
              ...workflowDocumentAgentStepFields.map((field) => ({required: [field]})),
              {required: ['env']},
              {required: ['working_directory']},
              {required: ['tool']},
              {required: ['connection']},
              {required: ['with']},
            ],
          },
        },
        {
          required: ['tool'],
          not: {
            anyOf: [
              {required: ['run']},
              ...workflowDocumentAgentStepFields.map((field) => ({required: [field]})),
              {required: ['checkout']},
              {required: ['env']},
              {required: ['working_directory']},
            ],
          },
        },
      ],
    },
  ];

  const job = object(jobs.additionalProperties);
  addLiteralNamePattern(propertiesOf(job).name);
  projectCheckoutTargetValidation(propertiesOf(stepSchema).checkout);
  const jobOutputs = object(propertiesOf(job).outputs);
  jobOutputs.minProperties = 1;
  const listening = object(propertiesOf(job).listening);
  const batch = object(propertiesOf(listening).batch);
  addAtLeastOneConstraint(batch, ['debounce', 'max_size', 'max_wait']);

  const gate = object(propertiesOf(stepSchema).gate);
  addAtLeastOneConstraint(gate, ['success', 'on_failure']);

  // The raw document schema accepts both output forms so the conditional
  // branches below can select the form that belongs to the step kind.
  const outputs = object(propertiesOf(stepSchema).outputs);
  const declarationOutputValue = z.toJSONSchema(workflowDocumentStepOutputDeclarationSchema, {
    io: 'input',
    unrepresentable: 'any',
  }) as JsonSchema;
  delete declarationOutputValue.$schema;

  const toolOutputs = z.toJSONSchema(workflowDocumentToolStepOutputsSchema, {
    io: 'input',
    unrepresentable: 'any',
  }) as JsonSchema;
  const toolOutputValue = object(toolOutputs.additionalProperties);
  delete toolOutputValue.$schema;
  // Zod refinements are not representable in its JSON Schema projection. Keep
  // the mapping marker in the editor schema; exact expression validation stays
  // in the model layer.
  toolOutputValue.pattern = '\\$\\{\\{';
  outputs.additionalProperties = {
    anyOf: [declarationOutputValue, toolOutputValue],
  };

  const toolOutputsCondition: JsonSchema = {if: {required: ['tool']}};
  // biome-ignore lint/suspicious/noThenProperty: JSON Schema uses "then" for a conditional branch.
  toolOutputsCondition.then = {
    properties: {
      outputs: {
        ...outputs,
        ...(typeof toolOutputs.description === 'string'
          ? {description: toolOutputs.description}
          : {}),
        additionalProperties: toolOutputValue,
      },
    },
  };
  const declarationOutputsCondition: JsonSchema = {if: {not: {required: ['tool']}}};
  // biome-ignore lint/suspicious/noThenProperty: JSON Schema uses "then" for a conditional branch.
  declarationOutputsCondition.then = {
    properties: {
      outputs: {
        ...outputs,
        additionalProperties: declarationOutputValue,
      },
    },
  };
  stepSchema.allOf = [
    ...objects(stepSchema.allOf),
    toolOutputsCondition,
    declarationOutputsCondition,
  ];
}

function addLiteralNamePattern(schema: JsonSchema | undefined) {
  if (schema === undefined) return;
  schema.pattern = WORKFLOW_LITERAL_NAME_PATTERN.source;
}

function projectCheckoutTargetValidation(schema: JsonSchema | undefined) {
  const checkout = objectSchemaFor(schema);
  if (Object.keys(checkout).length === 0) return;

  checkout.allOf = [
    ...objects(checkout.allOf),
    {
      not: {
        allOf: [
          {required: ['project']},
          {anyOf: [{required: ['connection']}, {required: ['repository']}]},
        ],
      },
    },
    (() => {
      const conditional: JsonSchema = {if: {required: ['connection']}};
      // biome-ignore lint/suspicious/noThenProperty: JSON Schema uses "then" for a conditional branch.
      conditional.then = {required: ['repository']};
      return conditional;
    })(),
  ];
}

function addAtLeastOneConstraint(schema: JsonSchema, fields: string[]) {
  schema.allOf = [...objects(schema.allOf), {anyOf: fields.map((field) => ({required: [field]}))}];
}

function stepSchemaFor(schema: JsonSchema): JsonSchema {
  const jobs = object(propertiesOf(schema).jobs);
  const job = object(jobs.additionalProperties);
  const steps = object(propertiesOf(job).steps);
  return object(steps.items);
}

function propertiesOf(schema: JsonSchema): Record<string, JsonSchema> {
  const properties = object(schema.properties);
  schema.properties = properties;
  return properties as Record<string, JsonSchema>;
}

function object(value: unknown): JsonSchema {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonSchema)
    : {};
}

function objectSchemaFor(value: unknown): JsonSchema {
  const schema = object(value);
  if (schema.type === 'object' || schema.properties) return schema;
  return (
    objects(schema.anyOf).find((option) => option.type === 'object' || option.properties) ?? {}
  );
}

function objects(value: unknown): JsonSchema[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is JsonSchema =>
          typeof item === 'object' && item !== null && !Array.isArray(item),
      )
    : [];
}
