import {buildWorkflowJsonSchema} from './workflow-json-schema.js';

type JsonSchema = Record<string, unknown>;

describe('buildWorkflowJsonSchema', () => {
  it('publishes input declarations without the reserved agent key', () => {
    const schema = buildWorkflowJsonSchema();
    const step = stepSchemaFor(schema);
    const output = object(object(object(step.properties).outputs).additionalProperties);

    expect(schema).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://www.shipfox.io/docs/workflow.schema.json',
      title: 'Shipfox Workflow',
    });
    expect(object(step.properties)).not.toHaveProperty('agent');
    expect(output.anyOf).toEqual(
      expect.arrayContaining([
        expect.objectContaining({enum: ['string', 'number', 'boolean', 'json']}),
      ]),
    );
  });

  it('describes static and dynamic workflow and job name fields', () => {
    const schema = buildWorkflowJsonSchema();
    const rootProperties = object(schema.properties);
    const jobs = object(rootProperties.jobs);
    const jobProperties = object(object(jobs.additionalProperties).properties);

    expect(rootProperties.name).toMatchObject({
      description: 'Static literal human-readable workflow name.',
    });
    expect(rootProperties.run_name).toMatchObject({
      description: 'Dynamic name for each workflow run. Supports workflow expressions.',
    });
    expect(jobProperties.name).toMatchObject({
      description: 'Static literal human-readable job name.',
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
      oneOf: [{required: ['run']}, {required: ['prompt']}, {required: ['checkout']}],
    });
    expect(requiredAlternatives(gate)).toEqual(['success', 'on_failure']);
    expect(requiredAlternatives(batch)).toEqual(['debounce', 'max_size', 'max_wait']);
  });

  it('publishes checkout fields for both job and checkout-step syntax', () => {
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
    expect(objectSchemaFor(jobCheckout).properties).toEqual(
      expect.objectContaining({
        project: expect.any(Object),
        connection: expect.any(Object),
        repository: expect.any(Object),
        ref: expect.any(Object),
        'fetch-depth': expect.any(Object),
        path: expect.any(Object),
        permissions: expect.any(Object),
        'persist-credentials': expect.any(Object),
        force: expect.any(Object),
      }),
    );
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
  return object(object(object(conditional?.then).properties).thinking).enum;
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
