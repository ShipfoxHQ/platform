import {Environment, parse as parseCel} from '@marcbachmann/cel-js';
import {registerWorkflowFunctions} from '../workflow-function-registry.js';
import {InvalidWorkflowExpressionError} from './errors.js';
import type {
  CreateWorkflowExpressionParams,
  ExpressionScalarType,
  ExpressionType,
  ExpressionTypeEnvironment,
  ValidCelExpression,
  WorkflowExpression,
} from './workflow-expression.js';

const scalarTypeToCelType = {
  string: 'string',
  int: 'int',
  double: 'double',
  bool: 'bool',
  null: 'null',
  timestamp: 'google.protobuf.Timestamp',
} satisfies Record<ExpressionScalarType, string>;

type CelSchema = {
  [field: string]: string | CelSchema;
};

const directPathPattern = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;

export function createWorkflowExpression(
  params: CreateWorkflowExpressionParams,
): WorkflowExpression {
  const source = params.source.trim();
  let resultType: ExpressionType | undefined;
  if (source.length === 0) {
    throw new InvalidWorkflowExpressionError({
      source: params.source,
      reason: 'Expression source must not be empty.',
    });
  }

  parseWorkflowExpression(source);

  if (params.check.mode === 'typed') {
    resultType = checkTypedWorkflowExpression(source, params.check);
  }

  return {
    language: 'cel',
    source: source as ValidCelExpression,
    check: params.check.mode,
    ...(resultType === undefined ? {} : {resultType}),
  };
}

function checkTypedWorkflowExpression(
  source: string,
  check: Extract<CreateWorkflowExpressionParams['check'], {mode: 'typed'}>,
): ExpressionType | undefined {
  const environment = createTypeCheckingEnvironment();
  registerTypeEnvironment(environment, check.typeEnvironment);
  const result = environment.check(source);
  if (!result.valid) {
    throw new InvalidWorkflowExpressionError({
      source,
      reason: result.error?.message ?? 'Expression source did not type-check.',
    });
  }
  assertExpectedResultType(source, result.type, check.expectedResultType);
  return resolveKnownPathType(source, check.typeEnvironment) ?? fromCelType(result.type);
}

function registerTypeEnvironment(
  environment: Environment,
  typeEnvironment: ExpressionTypeEnvironment | undefined,
): void {
  for (const [name, type] of Object.entries(typeEnvironment ?? {})) {
    const celType = toCelType(type, environment, name);
    if (typeof celType === 'string') environment.registerVariable(name, celType);
    else environment.registerVariable({name, schema: celType.schema});
  }
}

function assertExpectedResultType(
  source: string,
  actualType: string | undefined,
  expectedType: ExpressionScalarType | undefined,
): void {
  if (expectedType === undefined || actualType === scalarTypeToCelType[expectedType]) return;
  if (actualType === 'dyn') return;
  throw new InvalidWorkflowExpressionError({
    source,
    reason: `Expression source must return ${scalarTypeToCelType[expectedType]}; got ${actualType ?? 'unknown'}.`,
  });
}

function resolveKnownPathType(
  source: string,
  typeEnvironment: ExpressionTypeEnvironment | undefined,
): ExpressionType | undefined {
  // cel-js erases list element detail from custom result type strings, so recover
  // known direct paths before falling back to its lossy result type conversion.
  if (typeEnvironment === undefined || !directPathPattern.test(source)) {
    return undefined;
  }

  const [root, ...path] = source.split('.');
  let current = root === undefined ? undefined : typeEnvironment[root];
  for (const segment of path) {
    if (current === undefined || typeof current === 'string' || current.kind !== 'object') {
      return undefined;
    }
    current = current.fields[segment];
  }

  return current;
}

function createTypeCheckingEnvironment(): Environment {
  const environment = new Environment({unlistedVariablesAreDyn: false});
  registerWorkflowFunctions(environment);

  // CEL evaluates numeric equality across types, but its static checker normally
  // rejects the same expression. Match validation to the runtime contract.
  environment.registerOperator('double == int', (left: number, right: bigint) => {
    return Number.isInteger(left) && BigInt(left) === right;
  });

  // Typed context fields may be absent at runtime while still exposing their
  // known shape when present. CEL's built-in equality overloads do not allow a
  // declared object type to compare with null, so keep null checks aligned with
  // the runtime context contract.
  environment.registerOperator('dyn != null', (left: unknown, right: null) => left !== right);

  return environment;
}

export function unsafeWorkflowExpressionFromSource(params: {
  source: string;
  check: WorkflowExpression['check'];
}): WorkflowExpression {
  // Use only when rehydrating a source that was already validated before storage.
  return {
    language: 'cel',
    source: params.source as ValidCelExpression,
    check: params.check,
  };
}

function toCelType(
  type: ExpressionType,
  environment: Environment,
  variableName: string,
): string | {schema: CelSchema} {
  if (typeof type === 'string') return scalarTypeToCelType[type];
  if (type.kind === 'dyn') return 'dyn';
  if (type.kind === 'list') {
    return `list<${toCelListElementType(type.element, environment, [variableName])}>`;
  }
  if (type.kind === 'map') return 'map';

  return {
    schema: Object.fromEntries(
      Object.entries(type.fields).map(([name, field]) => [
        name,
        toCelSchemaType(field, environment, [variableName, name]),
      ]),
    ),
  };
}

function toCelSchemaType(
  type: ExpressionType,
  environment: Environment,
  path: readonly string[],
): string | CelSchema {
  if (typeof type === 'string') return scalarTypeToCelType[type];
  if (type.kind === 'dyn') return 'dyn';
  if (type.kind === 'list') {
    return `list<${toCelSchemaListElementType(type.element, environment, path)}>`;
  }
  if (type.kind === 'map') return 'map';
  return Object.fromEntries(
    Object.entries(type.fields).map(([name, field]) => [
      name,
      toCelSchemaType(field, environment, [...path, name]),
    ]),
  );
}

function toCelSchemaListElementType(
  type: ExpressionType,
  environment: Environment,
  path: readonly string[],
): string {
  if (typeof type === 'string') return scalarTypeToCelType[type];
  if (type.kind === 'dyn') return 'dyn';
  if (type.kind === 'map') return 'map';
  if (type.kind === 'object') {
    const itemPath = [...path, 'item'];
    const typeName = `$${itemPath.join('.')}`;
    environment.registerType({
      name: typeName,
      schema: Object.fromEntries(
        Object.entries(type.fields).map(([name, field]) => [
          name,
          toCelSchemaType(field, environment, [...itemPath, name]),
        ]),
      ),
    });
    return typeName;
  }
  return `list<${toCelSchemaListElementType(type.element, environment, [...path, 'item'])}>`;
}

function toCelListElementType(
  type: ExpressionType,
  environment: Environment,
  path: readonly string[],
): string {
  if (typeof type === 'string') return scalarTypeToCelType[type];
  if (type.kind === 'dyn') return 'dyn';
  if (type.kind === 'map') return 'map';
  if (type.kind === 'object') {
    return toCelSchemaListElementType(type, environment, path);
  }
  return `list<${toCelSchemaListElementType(type.element, environment, [...path, 'item'])}>`;
}

function fromCelType(type: string | undefined): ExpressionType | undefined {
  if (type === undefined) return undefined;

  switch (type) {
    case 'string':
      return 'string';
    case 'int':
      return 'int';
    case 'double':
      return 'double';
    case 'bool':
      return 'bool';
    case 'null':
      return 'null';
    case 'google.protobuf.Timestamp':
      return 'timestamp';
    case 'map':
      return {kind: 'map'};
    case 'dyn':
      return {kind: 'dyn'};
    default:
      // cel-js currently exposes custom/list element result types as opaque strings.
      // Keep the outer list shape when present, but erase element detail rather than
      // pretending we can round-trip the original schema.
      if (type.startsWith('list<')) return {kind: 'list', element: {kind: 'map'}};
      return {kind: 'map'};
  }
}

function parseWorkflowExpression(source: string): void {
  try {
    parseCel(source);
  } catch (error) {
    throw new InvalidWorkflowExpressionError({
      source,
      reason: error instanceof Error ? error.message : 'Expression source could not be parsed.',
    });
  }
}
