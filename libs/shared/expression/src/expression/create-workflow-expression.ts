import {type ASTNode, Environment, parse as parseCel} from '@marcbachmann/cel-js';
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

  const ast = parseWorkflowExpression(source);

  if (params.check.mode === 'typed') {
    const environment = createTypeCheckingEnvironment();
    for (const [name, type] of Object.entries(params.check.typeEnvironment ?? {})) {
      const celType = toCelType(type, environment, name);
      if (typeof celType === 'string') {
        environment.registerVariable(name, celType);
      } else {
        environment.registerVariable({name, schema: celType.schema});
      }
    }

    const typeCheckResult = environment.check(source);
    if (!typeCheckResult.valid) {
      throw new InvalidWorkflowExpressionError({
        source,
        reason: typeCheckResult.error?.message ?? 'Expression source did not type-check.',
      });
    }
    if (
      params.check.expectedResultType !== undefined &&
      typeCheckResult.type !== scalarTypeToCelType[params.check.expectedResultType] &&
      !(typeCheckResult.type === 'dyn' && containsFromJsonCall(ast))
    ) {
      throw new InvalidWorkflowExpressionError({
        source,
        reason: `Expression source must return ${scalarTypeToCelType[params.check.expectedResultType]}; got ${typeCheckResult.type ?? 'unknown'}.`,
      });
    }
    resultType =
      resolveKnownPathType(source, params.check.typeEnvironment) ??
      fromCelType(typeCheckResult.type, ast);
  }

  return {
    language: 'cel',
    source: source as ValidCelExpression,
    check: params.check.mode,
    ...(resultType === undefined ? {} : {resultType}),
  };
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
  if (type.kind === 'list') {
    return `list<${toCelListElementType(type.element, environment, variableName)}>`;
  }
  if (type.kind === 'map') return 'map';

  return {
    schema: Object.fromEntries(
      Object.entries(type.fields).map(([name, field]) => [
        name,
        toCelSchemaType(field, environment, `${variableName}_${name}`),
      ]),
    ),
  };
}

function toCelSchemaType(
  type: ExpressionType,
  environment: Environment,
  path: string,
): string | CelSchema {
  if (typeof type === 'string') return scalarTypeToCelType[type];
  if (type.kind === 'list') {
    return `list<${toCelSchemaListElementType(type.element, environment, path)}>`;
  }
  if (type.kind === 'map') return 'map';
  return Object.fromEntries(
    Object.entries(type.fields).map(([name, field]) => [
      name,
      toCelSchemaType(field, environment, `${path}_${name}`),
    ]),
  );
}

function toCelSchemaListElementType(
  type: ExpressionType,
  environment: Environment,
  path: string,
): string {
  if (typeof type === 'string') return scalarTypeToCelType[type];
  if (type.kind === 'map') return 'map';
  if (type.kind === 'object') {
    const typeName = `$${path}_item`;
    environment.registerType({
      name: typeName,
      schema: Object.fromEntries(
        Object.entries(type.fields).map(([name, field]) => [
          name,
          toCelSchemaType(field, environment, `${path}_item_${name}`),
        ]),
      ),
    });
    return typeName;
  }
  return `list<${toCelSchemaListElementType(type.element, environment, `${path}_item`)}>`;
}

function toCelListElementType(
  type: ExpressionType,
  environment: Environment,
  variableName: string,
): string {
  if (typeof type === 'string') return scalarTypeToCelType[type];
  if (type.kind === 'map') return 'map';
  if (type.kind === 'object') {
    const typeName = `$${variableName}.item`;
    environment.registerType({
      name: typeName,
      schema: Object.fromEntries(
        Object.entries(type.fields).map(([name, field]) => [
          name,
          toCelSchemaType(field, environment, `${variableName}_item_${name}`),
        ]),
      ),
    });
    return typeName;
  }
  return `list<${toCelSchemaListElementType(type.element, environment, `${variableName}_item`)}>`;
}

function fromCelType(type: string | undefined, ast: ASTNode): ExpressionType | undefined {
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
      // Preserve legacy string fallback for open-map lookups; JSON values stay unknown.
      return containsFromJsonCall(ast) ? undefined : 'string';
    default:
      // cel-js currently exposes custom/list element result types as opaque strings.
      // Keep the outer list shape when present, but erase element detail rather than
      // pretending we can round-trip the original schema.
      if (type.startsWith('list<')) return {kind: 'list', element: {kind: 'map'}};
      return {kind: 'map'};
  }
}

function parseWorkflowExpression(source: string): ASTNode {
  try {
    return parseCel(source).ast;
  } catch (error) {
    throw new InvalidWorkflowExpressionError({
      source,
      reason: error instanceof Error ? error.message : 'Expression source could not be parsed.',
    });
  }
}

function containsFromJsonCall(node: ASTNode): boolean {
  if ((node.op === 'call' || node.op === 'rcall') && node.args[0] === 'fromJson') {
    return true;
  }

  return containsFromJsonValue(node.args);
}

function containsFromJsonValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsFromJsonValue);
  if (typeof value !== 'object' || value === null) return false;

  const candidate = value as {readonly args?: unknown; readonly op?: unknown};
  if (candidate.args === undefined || candidate.op === undefined) return false;

  return containsFromJsonCall(candidate as ASTNode);
}
