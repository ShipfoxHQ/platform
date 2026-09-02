import {
  type WorkflowDocumentStepOutputType,
  workflowDocumentStepOutputTypes,
} from '@shipfox/workflow-document';
import {Ajv, type AnySchema, type ValidateFunction} from 'ajv';
import type {ExpressionType} from '../expression/workflow-expression.js';

export type OutputType = WorkflowDocumentStepOutputType;

export interface OutputTypeDeclaration {
  readonly type: OutputType;
  readonly schema?: unknown;
}

export type OutputDeclarations = Readonly<Record<string, OutputTypeDeclaration>>;

export type JsonSchemaValidationResult =
  | {readonly ok: true}
  | {readonly ok: false; readonly reason: string};

export type StepOutputCoercionErrorReason =
  | 'missing'
  | 'undeclared'
  | 'invalid_type'
  | 'invalid_json'
  | 'schema_invalid';

export interface StepOutputCoercionError {
  readonly key: string;
  readonly reason: StepOutputCoercionErrorReason;
  readonly expectedType?: OutputType;
  readonly message: string;
  readonly schemaError?: string;
}

export type CoerceStepOutputsResult =
  | {readonly ok: true; readonly output: Record<string, unknown>}
  | {readonly ok: false; readonly error: StepOutputCoercionError};

const ajv = new Ajv({strict: false});
const coercingAjv = new Ajv({
  strict: false,
  coerceTypes: true,
  allErrors: true,
  addUsedSchema: false,
});
const jsonOutputValidatorCache = new Map<string, ValidateFunction>();
const fallbackJsonType = {kind: 'dyn'} as const satisfies ExpressionType;
const openObjectJsonType = {kind: 'map'} as const satisfies ExpressionType;

export {workflowDocumentStepOutputTypes as outputTypes};

export function outputDeclarationToExpressionType(
  declaration: OutputTypeDeclaration,
): ExpressionType {
  switch (declaration.type) {
    case 'string':
      return 'string';
    case 'number':
      return 'double';
    case 'boolean':
      return 'bool';
    case 'json':
      return declaration.schema === undefined
        ? fallbackJsonType
        : jsonSchemaToExpressionType(declaration.schema);
  }
}

export function outputDeclarationsToExpressionFields(
  declarations: OutputDeclarations,
): Readonly<Record<string, ExpressionType>> {
  return Object.fromEntries(
    Object.entries(declarations).map(([key, declaration]) => [
      key,
      outputDeclarationToExpressionType(declaration),
    ]),
  );
}

export function jsonSchemaToExpressionType(schema: unknown): ExpressionType {
  if (!isPlainRecord(schema)) return fallbackJsonType;
  if (hasDynamicSchemaShape(schema)) return fallbackJsonType;
  if (schema.patternProperties !== undefined) return openObjectJsonType;

  const type = schema.type;
  if (Array.isArray(type)) return fallbackJsonType;

  switch (type) {
    case 'string':
      return 'string';
    case 'number':
      return 'double';
    case 'integer':
      return 'int';
    case 'boolean':
      return 'bool';
    case 'null':
      return 'null';
    case 'array':
      return {
        kind: 'list',
        element: jsonSchemaToExpressionType(schema.items),
      };
    case 'object':
      return closedObjectJsonSchemaToExpressionType(schema);
    default:
      return fallbackJsonType;
  }
}

export function validateJsonSchema(schema: unknown): JsonSchemaValidationResult {
  const valid = ajv.validateSchema(schema as AnySchema);
  if (valid) return {ok: true};

  return {
    ok: false,
    reason: ajv.errorsText(ajv.errors, {separator: '; '}),
  };
}

export function coerceStepOutputs(params: {
  readonly declarations: OutputDeclarations;
  readonly output: Record<string, unknown> | null | undefined;
}): CoerceStepOutputsResult {
  const declaredKeys = Object.keys(params.declarations);
  const output = params.output ?? {};

  for (const key of declaredKeys) {
    if (Object.hasOwn(output, key)) continue;
    const declaration = params.declarations[key];
    return {
      ok: false,
      error: {
        key,
        reason: 'missing',
        ...(declaration === undefined ? {} : {expectedType: declaration.type}),
        message: `Output "${key}" is required by the step output declaration.`,
      },
    };
  }

  for (const key of Object.keys(output)) {
    if (Object.hasOwn(params.declarations, key)) continue;
    return {
      ok: false,
      error: {
        key,
        reason: 'undeclared',
        message: `Output "${key}" is not declared by the step output schema.`,
      },
    };
  }

  const coerced: Record<string, unknown> = {};
  for (const [key, declaration] of Object.entries(params.declarations)) {
    const value = output[key];
    const result = coerceStepOutputValue(key, declaration, value);
    if (!result.ok) return result;
    coerced[key] = result.value;
  }

  return {ok: true, output: coerced};
}

type CoerceStepOutputValueResult =
  | {readonly ok: true; readonly value: unknown}
  | {readonly ok: false; readonly error: StepOutputCoercionError};

function coerceStepOutputValue(
  key: string,
  declaration: OutputTypeDeclaration,
  value: unknown,
): CoerceStepOutputValueResult {
  switch (declaration.type) {
    case 'string':
      return coerceStringOutput(key, value);
    case 'number':
      return coerceNumberOutput(key, value);
    case 'boolean':
      return coerceBooleanOutput(key, value);
    case 'json':
      return coerceJsonOutput(key, declaration, value);
  }
}

function coerceStringOutput(key: string, value: unknown): CoerceStepOutputValueResult {
  if (typeof value === 'string') return {ok: true, value};
  return invalidTypeError(key, 'string', 'must be a string');
}

function coerceNumberOutput(key: string, value: unknown): CoerceStepOutputValueResult {
  if (typeof value === 'number' && Number.isFinite(value)) return {ok: true, value};

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed !== '') {
      const number = Number(trimmed);
      if (Number.isFinite(number)) return {ok: true, value: number};
    }
  }

  return invalidTypeError(key, 'number', 'must be a finite number or numeric string');
}

function coerceBooleanOutput(key: string, value: unknown): CoerceStepOutputValueResult {
  if (typeof value === 'boolean') return {ok: true, value};
  if (value === 'true') return {ok: true, value: true};
  if (value === 'false') return {ok: true, value: false};
  return invalidTypeError(key, 'boolean', 'must be a boolean or the string "true" or "false"');
}

function coerceJsonOutput(
  key: string,
  declaration: OutputTypeDeclaration,
  value: unknown,
): CoerceStepOutputValueResult {
  const parsed = parseJsonOutputValue(key, value);
  if (!parsed.ok) return parsed;

  if (declaration.schema === undefined) return {ok: true, value: parsed.value};

  const data = {value: cloneJsonValue(parsed.value)};
  const validate = validatorForJsonOutputSchema(declaration.schema);
  if (validate(data)) return {ok: true, value: data.value};

  return {
    ok: false,
    error: {
      key,
      reason: 'schema_invalid',
      expectedType: 'json',
      message: `Output "${key}" does not match its JSON Schema.`,
      schemaError: coercingAjv.errorsText(validate.errors, {separator: '; '}),
    },
  };
}

function parseJsonOutputValue(key: string, value: unknown): CoerceStepOutputValueResult {
  if (typeof value !== 'string') return {ok: true, value};

  try {
    return {ok: true, value: JSON.parse(value) as unknown};
  } catch {
    if (looksLikeJsonContainer(value)) {
      return {
        ok: false,
        error: {
          key,
          reason: 'invalid_json',
          expectedType: 'json',
          message: `Output "${key}" must be valid JSON.`,
        },
      };
    }
    return {ok: true, value};
  }
}

function invalidTypeError(
  key: string,
  expectedType: OutputType,
  detail: string,
): CoerceStepOutputValueResult {
  return {
    ok: false,
    error: {
      key,
      reason: 'invalid_type',
      expectedType,
      message: `Output "${key}" ${detail}.`,
    },
  };
}

function validatorForJsonOutputSchema(schema: unknown): ValidateFunction {
  const key = stableJsonStringify(schema);
  const cached = jsonOutputValidatorCache.get(key);
  if (cached !== undefined) return cached;

  const validate = coercingAjv.compile({
    type: 'object',
    properties: {value: schema},
    required: ['value'],
    additionalProperties: false,
  });
  jsonOutputValidatorCache.set(key, validate);
  return validate;
}

function closedObjectJsonSchemaToExpressionType(
  schema: Readonly<Record<string, unknown>>,
): ExpressionType {
  const properties = schema.properties;
  const required = schema.required;
  // CEL object fields are required when statically typed. Optional JSON Schema
  // fields would make valid runtime values fail type-checking, so keep those
  // schemas opaque.
  if (
    schema.additionalProperties !== false ||
    !isPlainRecord(properties) ||
    !Array.isArray(required) ||
    !required.every((field) => typeof field === 'string') ||
    Object.keys(properties).some((field) => !required.includes(field)) ||
    required.some((field) => !Object.hasOwn(properties, field))
  ) {
    return openObjectJsonType;
  }

  return {
    kind: 'object',
    fields: Object.fromEntries(
      Object.entries(properties).map(([field, fieldSchema]) => [
        field,
        jsonSchemaToExpressionType(fieldSchema),
      ]),
    ),
  };
}

function hasDynamicSchemaShape(schema: Readonly<Record<string, unknown>>): boolean {
  return (
    schema.oneOf !== undefined ||
    schema.anyOf !== undefined ||
    schema.allOf !== undefined ||
    schema.not !== undefined ||
    schema.nullable === true
  );
}

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneJsonValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return value;
  return JSON.parse(serialized) as unknown;
}

function stableJsonStringify(value: unknown): string {
  return JSON.stringify(canonicalJson(value));
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!isPlainRecord(value)) return value;

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalJson(value[key])]),
  );
}

function looksLikeJsonContainer(value: string): boolean {
  const trimmed = value.trimStart();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}
