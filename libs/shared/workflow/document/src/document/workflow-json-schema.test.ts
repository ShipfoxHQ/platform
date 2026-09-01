import {
  WORKFLOW_DOCUMENT_STEP_OUTPUT_KEY_PATTERN,
  WORKFLOW_DOCUMENT_STEP_OUTPUTS_MAX_ENTRIES,
  WORKFLOW_INTERPOLATION_MARKER_PATTERN,
  WORKFLOW_LITERAL_NAME_PATTERN,
  WORKFLOW_SESSION_KEY_MAX_LENGTH,
  WORKFLOW_SESSION_KEY_PATTERN_SOURCE,
} from './workflow-document.js';
import {buildWorkflowJsonSchema} from './workflow-json-schema.js';

type JsonSchema = Record<string, unknown>;

describe('buildWorkflowJsonSchema', () => {
  it('publishes input declarations and authorable tool fields', () => {
    const schema = buildWorkflowJsonSchema();
    const step = stepSchemaFor(schema);
    const output = object(object(object(step.properties).outputs).additionalProperties);

    expect(schema).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://www.shipfox.io/docs/workflow.schema.json',
      title: 'Shipfox Workflow',
    });
    const stepProperties = object(step.properties);
    expect(stepProperties).not.toHaveProperty('agent');
    expect(stepProperties).toEqual(
      expect.objectContaining({
        tool: expect.any(Object),
        connection: expect.any(Object),
        with: expect.any(Object),
      }),
    );
    expect(output.anyOf).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          anyOf: expect.arrayContaining([
            expect.objectContaining({enum: ['string', 'number', 'boolean', 'json']}),
          ]),
        }),
        expect.objectContaining({type: 'string', minLength: 1}),
      ]),
    );
  });

  it('switches step output values to mappings when a tool is present', () => {
    const schema = buildWorkflowJsonSchema();
    const step = stepSchemaFor(schema);
    const condition = objects(step.allOf).find(
      (candidate) => JSON.stringify(candidate.if) === JSON.stringify({required: ['tool']}),
    );
    const defaultOutput = object(object(object(step.properties).outputs).additionalProperties);
    const toolOutput = object(
      object(object(condition?.then).properties).outputs,
    ).additionalProperties;

    expect(condition).toBeDefined();
    expect(defaultOutput.anyOf).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          anyOf: expect.arrayContaining([
            expect.objectContaining({enum: ['string', 'number', 'boolean', 'json']}),
          ]),
        }),
      ]),
    );
    expect(object(toolOutput)).toMatchObject({
      type: 'string',
      minLength: 1,
      pattern: WORKFLOW_INTERPOLATION_MARKER_PATTERN.source,
    });
    expect(object(object(condition?.then).properties).outputs).toMatchObject({
      maxProperties: WORKFLOW_DOCUMENT_STEP_OUTPUTS_MAX_ENTRIES,
      propertyNames: {pattern: WORKFLOW_DOCUMENT_STEP_OUTPUT_KEY_PATTERN.source},
    });

    const declarationCondition = objects(step.allOf).find(
      (candidate) => JSON.stringify(candidate.if) === JSON.stringify({not: {required: ['tool']}}),
    );
    expect(declarationCondition).toBeDefined();
    const declarationOutput = object(
      object(object(declarationCondition?.then).properties).outputs,
    ).additionalProperties;
    expect(declarationOutput).toEqual(
      expect.objectContaining({
        anyOf: expect.arrayContaining([
          expect.objectContaining({enum: ['string', 'number', 'boolean', 'json']}),
        ]),
      }),
    );
    expect(objects(object(declarationOutput).anyOf)).not.toContainEqual(
      expect.objectContaining({pattern: WORKFLOW_INTERPOLATION_MARKER_PATTERN.source}),
    );
  });

  it('describes static and dynamic workflow and job name fields', () => {
    const schema = buildWorkflowJsonSchema();
    const rootProperties = object(schema.properties);
    const jobs = object(rootProperties.jobs);
    const jobProperties = object(object(jobs.additionalProperties).properties);

    expect(rootProperties.name).toMatchObject({
      description: 'Static literal human-readable workflow name.',
      pattern: WORKFLOW_LITERAL_NAME_PATTERN.source,
    });
    expect(rootProperties.run_name).toMatchObject({
      description: 'Dynamic name for each workflow run. Supports workflow expressions.',
    });
    expect(jobProperties.name).toMatchObject({
      description: 'Static literal human-readable job name.',
      pattern: WORKFLOW_LITERAL_NAME_PATTERN.source,
    });
    expect(jobProperties.execution_name).toMatchObject({
      description: 'Dynamic name for each job execution. Supports workflow expressions.',
    });
  });

  it('restricts thinking values for each harness', () => {
    const schema = buildWorkflowJsonSchema();
    const conditionals = objects(stepSchemaFor(schema).allOf);

    expect(thinkingValuesFor(conditionals, 'pi')).toEqual([
      'off',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
    expect(thinkingValuesFor(conditionals, 'claude')).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
    expect(conditionals).not.toContainEqual(
      expect.objectContaining({if: {not: {required: ['harness']}}}),
    );
  });

  it('projects job and step validation rules', () => {
    const schema = buildWorkflowJsonSchema();
    const jobs = object(object(schema.properties).jobs);
    const triggers = object(object(schema.properties).triggers);
    const jobOutputs = jobOutputsSchemaFor(schema);
    const step = stepSchemaFor(schema);
    const gate = object(object(step.properties).gate);
    const batch = batchSchemaFor(schema);
    const discriminator = objects(step.allOf).find((constraint) => 'oneOf' in constraint);

    expect(jobs.minProperties).toBe(1);
    expect(triggers.minProperties).toBe(1);
    expect(jobOutputs.minProperties).toBe(1);
    expect(discriminator).toMatchObject({
      oneOf: [
        {required: ['run']},
        {required: ['prompt']},
        {required: ['checkout']},
        {required: ['tool']},
      ],
    });
    expect(requiredAlternatives(gate)).toEqual(['success', 'on_failure']);
    expect(requiredAlternatives(batch)).toEqual(['debounce', 'max_size', 'max_wait']);
  });

  it('describes the session field with string and object forms', () => {
    const schema = buildWorkflowJsonSchema();
    const step = stepSchemaFor(schema);
    const session = object(object(step.properties).session);
    const discriminator = objects(step.allOf).find((constraint) => 'oneOf' in constraint);
    const runBranch = objects(discriminator?.oneOf)[0];
    const checkoutBranch = objects(discriminator?.oneOf)[2];

    expect(session.description).toContain('session');
    expect(objects(session.anyOf)).toEqual(
      expect.arrayContaining([expect.objectContaining({type: 'string', minLength: 1})]),
    );
    expect(objects(session.anyOf)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'string',
          maxLength: WORKFLOW_SESSION_KEY_MAX_LENGTH,
          pattern: WORKFLOW_SESSION_KEY_PATTERN_SOURCE,
        }),
      ]),
    );
    const objectForm = objects(session.anyOf).find((branch) => branch.type === 'object');
    expect(objectForm).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['key'],
    });
    expect(object(object(objectForm?.properties).key).description).toContain('interpolation');
    expect(object(object(objectForm?.properties).mode).enum).toEqual(['resume', 'fork']);
    expect(strings(runBranch?.required)).toEqual(['run']);
    expect(object(runBranch?.not).anyOf).toEqual(
      expect.arrayContaining([expect.objectContaining({required: ['session']})]),
    );
    expect(object(checkoutBranch?.not).anyOf).toEqual(
      expect.arrayContaining([expect.objectContaining({required: ['session']})]),
    );
    expect(object(checkoutBranch?.not).anyOf).not.toContainEqual(
      expect.objectContaining({required: ['working_directory']}),
    );
  });

  it('keeps trigger event optional in the JSON schema', () => {
    const schema = buildWorkflowJsonSchema();
    const triggers = object(object(schema.properties).triggers);
    const trigger = object(triggers.additionalProperties);

    expect(strings(trigger.required)).not.toContain('event');
    expect(object(trigger.properties).event).toMatchObject({
      type: 'string',
      description:
        'Event name that starts the workflow. Omit it to accept every event the source delivers. Sources that deliver one event, such as `manual`, `cron`, and custom webhooks, do not need it.',
    });
  });

  it('publishes the supported job checkout subset and full checkout-step fields', () => {
    const schema = buildWorkflowJsonSchema();
    const root = object(schema.properties);
    const jobs = object(root.jobs);
    const job = object(jobs.additionalProperties);
    const jobCheckout = object(object(job.properties).checkout);
    const step = stepSchemaFor(schema);
    const stepCheckout = object(object(step.properties).checkout);

    expect(jobCheckout.anyOf).toEqual(
      expect.arrayContaining([
        expect.objectContaining({type: 'object'}),
        expect.objectContaining({const: false}),
      ]),
    );
    expect(objectSchemaFor(jobCheckout).properties).toEqual({
      permissions: expect.any(Object),
      'persist-credentials': expect.any(Object),
    });
    expect(stepCheckout).toEqual(
      expect.objectContaining({
        type: 'object',
        properties: expect.objectContaining({
          project: expect.any(Object),
          'fetch-depth': expect.any(Object),
          force: expect.any(Object),
        }),
      }),
    );
    const connectionCondition = objects(stepCheckout.allOf).find(
      (condition) => JSON.stringify(condition.if) === JSON.stringify({required: ['connection']}),
    );
    expect(connectionCondition).toBeDefined();
    expect(connectionCondition?.then).toEqual({required: ['repository']});
  });

  it('describes every JSON Schema property', () => {
    const missingDescriptions = descriptionsMissingFrom(buildWorkflowJsonSchema());

    expect(missingDescriptions).toEqual([]);
  });
});

function stepSchemaFor(schema: JsonSchema): JsonSchema {
  const jobs = object(object(schema.properties).jobs);
  const job = object(jobs.additionalProperties);
  const steps = object(object(job.properties).steps);
  return object(steps.items);
}

function batchSchemaFor(schema: JsonSchema): JsonSchema {
  const jobs = object(object(schema.properties).jobs);
  const job = object(jobs.additionalProperties);
  const listening = object(object(job.properties).listening);
  return object(object(listening.properties).batch);
}

function jobOutputsSchemaFor(schema: JsonSchema): JsonSchema {
  const jobs = object(object(schema.properties).jobs);
  const job = object(jobs.additionalProperties);
  return object(object(job.properties).outputs);
}

function objectSchemaFor(schema: JsonSchema): JsonSchema {
  if (schema.type === 'object' || schema.properties) return schema;
  return (
    objects(schema.anyOf).find((option) => option.type === 'object' || option.properties) ?? {}
  );
}

function requiredAlternatives(schema: JsonSchema): unknown {
  const constraint = objects(schema.allOf).find((candidate) => 'anyOf' in candidate);
  return objects(constraint?.anyOf).map((alternative) => strings(alternative.required)[0]);
}

function thinkingValuesFor(conditionals: JsonSchema[], harness: string): unknown {
  const conditional = conditionals.find(
    (candidate) => object(object(object(candidate.if).properties).harness).const === harness,
  );
  const thinking = object(object(object(conditional?.then).properties).thinking);
  const branches = Array.isArray(thinking.anyOf) ? thinking.anyOf : [];
  return branches.map(object).find((branch) => Array.isArray(branch.enum))?.enum;
}

function descriptionsMissingFrom(schema: JsonSchema, path = '#'): string[] {
  const missing: string[] = [];
  const properties = object(schema.properties);
  for (const [name, value] of Object.entries(properties)) {
    const property = object(value);
    const propertyPath = `${path}/properties/${name}`;
    if (typeof property.description !== 'string' || property.description.trim() === '') {
      missing.push(`${propertyPath}: add .meta({description: '...'}) to its Zod field.`);
    }
    missing.push(...descriptionsMissingFrom(property, propertyPath));
  }

  for (const [key, value] of Object.entries(schema)) {
    if (key === 'properties') continue;
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (isObject(item))
          missing.push(...descriptionsMissingFrom(item, `${path}/${key}/${index}`));
      });
    } else if (isObject(value)) {
      missing.push(...descriptionsMissingFrom(value, `${path}/${key}`));
    }
  }

  return missing;
}

function object(value: unknown): JsonSchema {
  return isObject(value) ? value : {};
}

function objects(value: unknown): JsonSchema[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function isObject(value: unknown): value is JsonSchema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
