import {Ajv} from 'ajv';
import {
  coerceStepOutputs,
  jsonSchemaToExpressionType,
  outputDeclarationToExpressionType,
  validateJsonSchema,
} from './output-declarations.js';

describe('outputDeclarationToExpressionType', () => {
  it.each([
    [{type: 'string' as const}, 'string'],
    [{type: 'number' as const}, 'double'],
    [{type: 'boolean' as const}, 'bool'],
    [{type: 'json' as const}, {kind: 'dyn'}],
    [{type: 'json' as const, schema: {}}, {kind: 'dyn'}],
  ])('maps %j', (declaration, expected) => {
    const result = outputDeclarationToExpressionType(declaration);

    expect(result).toEqual(expected);
  });
});

describe('jsonSchemaToExpressionType', () => {
  it.each([
    [{type: 'string'}, 'string'],
    [{type: 'number'}, 'double'],
    [{type: 'integer'}, 'int'],
    [{type: 'boolean'}, 'bool'],
    [{type: 'null'}, 'null'],
  ])('maps scalar schema %j', (schema, expected) => {
    const result = jsonSchemaToExpressionType(schema);

    expect(result).toEqual(expected);
  });

  it('maps array schemas', () => {
    const result = jsonSchemaToExpressionType({type: 'array', items: {type: 'string'}});

    expect(result).toEqual({kind: 'list', element: 'string'});
  });

  it('maps closed all-required object schemas', () => {
    const result = jsonSchemaToExpressionType({
      type: 'object',
      additionalProperties: false,
      required: ['registry', 'size_bytes'],
      properties: {
        registry: {type: 'string'},
        size_bytes: {type: 'integer'},
      },
    });

    expect(result).toEqual({
      kind: 'object',
      fields: {
        registry: 'string',
        size_bytes: 'int',
      },
    });
  });

  it.each([
    [
      'optional property',
      {
        type: 'object',
        additionalProperties: false,
        required: ['registry'],
        properties: {registry: {type: 'string'}, tag: {type: 'string'}},
      },
    ],
    [
      'additional properties',
      {
        type: 'object',
        additionalProperties: true,
        required: ['registry'],
        properties: {registry: {type: 'string'}},
      },
    ],
    [
      'required property without a schema',
      {
        type: 'object',
        additionalProperties: false,
        required: ['registry'],
        properties: {},
      },
    ],
    ['patternProperties', {type: 'object', patternProperties: {'^x': {type: 'string'}}}],
  ])('maps open object %s schema to map', (_label, schema) => {
    const result = jsonSchemaToExpressionType(schema);

    expect(result).toEqual({kind: 'map'});
  });

  it.each([
    ['absent schema', undefined],
    ['null schema', null],
    ['oneOf', {oneOf: [{type: 'string'}, {type: 'number'}]}],
    ['anyOf', {anyOf: [{type: 'string'}, {type: 'number'}]}],
    ['allOf', {allOf: [{type: 'string'}, {type: 'number'}]}],
    ['not', {not: {type: 'string'}}],
    ['nullable', {type: 'string', nullable: true}],
    ['union type', {type: ['string', 'number']}],
    ['empty schema', {}],
  ])('maps unknown-shaped %s schema to dyn', (_label, schema) => {
    const result = jsonSchemaToExpressionType(schema);

    expect(result).toEqual({kind: 'dyn'});
  });

  it.each([
    [{type: 'string', enum: ['ready']}, 'string'],
    [{type: 'integer', const: 42}, 'int'],
    [{type: 'number', enum: [1, 2]}, 'double'],
  ])('preserves scalar schema %j despite enum/const', (schema, expected) => {
    const result = jsonSchemaToExpressionType(schema);

    expect(result).toBe(expected);
  });

  it('maps an unconstrained nested schema to dyn', () => {
    const result = jsonSchemaToExpressionType({
      type: 'object',
      additionalProperties: false,
      properties: {payload: {}},
      required: ['payload'],
    });

    expect(result).toEqual({kind: 'object', fields: {payload: {kind: 'dyn'}}});
  });
});

describe('validateJsonSchema', () => {
  it('accepts valid JSON Schemas', () => {
    const result = validateJsonSchema({
      type: 'object',
      properties: {registry: {type: 'string'}},
    });

    expect(result).toEqual({ok: true});
  });

  it('rejects invalid JSON Schemas', () => {
    const result = validateJsonSchema({type: 'definitely-not-a-json-schema-type'});

    expect(result).toMatchObject({ok: false});
  });
});

describe('coerceStepOutputs', () => {
  it('passes through scalar and structured values for schema-less JSON outputs', () => {
    const result = coerceStepOutputs({
      declarations: {
        count: {type: 'json'},
        ready: {type: 'json'},
        payload: {type: 'json'},
        items: {type: 'json'},
      },
      output: {
        count: 42,
        ready: true,
        payload: {name: 'build'},
        items: ['one', 2],
      },
    });

    expect(result).toEqual({
      ok: true,
      output: {
        count: 42,
        ready: true,
        payload: {name: 'build'},
        items: ['one', 2],
      },
    });
  });

  it('decodes string values for schema-less JSON outputs', () => {
    const result = coerceStepOutputs({
      declarations: {
        count: {type: 'json'},
        ready: {type: 'json'},
        payload: {type: 'json'},
        items: {type: 'json'},
      },
      output: {
        count: '42',
        ready: 'true',
        payload: '{"name":"build"}',
        items: '["one",2]',
      },
    });

    expect(result).toEqual({
      ok: true,
      output: {
        count: 42,
        ready: true,
        payload: {name: 'build'},
        items: ['one', 2],
      },
    });
  });

  it('coerces declared scalar output values', () => {
    const result = coerceStepOutputs({
      declarations: {
        count: {type: 'number'},
        ready: {type: 'boolean'},
        sha: {type: 'string'},
      },
      output: {count: '42', ready: 'true', sha: 'abc123'},
    });

    expect(result).toEqual({
      ok: true,
      output: {count: 42, ready: true, sha: 'abc123'},
    });
  });

  it('coerces JSON string output through its schema', () => {
    const result = coerceStepOutputs({
      declarations: {
        payload: {
          type: 'json',
          schema: {
            type: 'object',
            properties: {
              size: {type: 'integer'},
              ready: {type: 'boolean'},
            },
            required: ['size', 'ready'],
            additionalProperties: false,
          },
        },
      },
      output: {payload: '{"size":"42","ready":"false"}'},
    });

    expect(result).toEqual({
      ok: true,
      output: {payload: {size: 42, ready: false}},
    });
  });

  it('coerces a copied JSON value without mutating the reported output object', () => {
    const payload = {size: '42'};

    const result = coerceStepOutputs({
      declarations: {
        payload: {
          type: 'json',
          schema: {
            type: 'object',
            properties: {size: {type: 'integer'}},
            required: ['size'],
            additionalProperties: false,
          },
        },
      },
      output: {payload},
    });

    expect(result).toEqual({ok: true, output: {payload: {size: 42}}});
    expect(payload).toEqual({size: '42'});
  });

  it.each([
    ['missing declared key', {count: {type: 'number'}}, {}, {key: 'count', reason: 'missing'}],
    [
      'undeclared emitted key',
      {count: {type: 'number'}},
      {count: '1', extra: 'nope'},
      {key: 'extra', reason: 'undeclared'},
    ],
    [
      'invalid scalar',
      {count: {type: 'number'}},
      {count: 'not-a-number'},
      {key: 'count', reason: 'invalid_type'},
    ],
    [
      'invalid JSON',
      {payload: {type: 'json'}},
      {payload: '{not-json'},
      {key: 'payload', reason: 'invalid_json'},
    ],
    [
      'schema validation failure',
      {
        payload: {
          type: 'json',
          schema: {
            type: 'object',
            properties: {size: {type: 'integer'}},
            required: ['size'],
            additionalProperties: false,
          },
        },
      },
      {payload: '{"size":"not-an-int"}'},
      {key: 'payload', reason: 'schema_invalid'},
    ],
  ] as const)('fails for %s', (_label, declarations, output, expectedError) => {
    const result = coerceStepOutputs({declarations, output});

    expect(result).toMatchObject({ok: false, error: expectedError});
  });

  it('reuses compiled JSON Schema validators by stable schema content', () => {
    const compileSpy = vi.spyOn(Ajv.prototype, 'compile');
    compileSpy.mockClear();

    const first = coerceStepOutputs({
      declarations: {
        payload: {
          type: 'json',
          schema: {title: 'cache-test-schema', type: 'integer'},
        },
      },
      output: {payload: '1'},
    });
    const second = coerceStepOutputs({
      declarations: {
        payload: {
          type: 'json',
          schema: {type: 'integer', title: 'cache-test-schema'},
        },
      },
      output: {payload: '2'},
    });

    expect(first).toEqual({ok: true, output: {payload: 1}});
    expect(second).toEqual({ok: true, output: {payload: 2}});
    expect(compileSpy).toHaveBeenCalledTimes(1);
    compileSpy.mockRestore();
  });

  it('does not collide when different JSON Schemas reuse the same schema id', () => {
    const first = coerceStepOutputs({
      declarations: {
        payload: {
          type: 'json',
          schema: {$id: 'https://shipfox.dev/schemas/output', type: 'integer'},
        },
      },
      output: {payload: '1'},
    });
    const second = coerceStepOutputs({
      declarations: {
        payload: {
          type: 'json',
          schema: {
            $id: 'https://shipfox.dev/schemas/output',
            type: 'object',
            properties: {name: {type: 'string'}},
            required: ['name'],
            additionalProperties: false,
          },
        },
      },
      output: {payload: '{"name":"artifact"}'},
    });

    expect(first).toEqual({ok: true, output: {payload: 1}});
    expect(second).toEqual({ok: true, output: {payload: {name: 'artifact'}}});
  });
});
