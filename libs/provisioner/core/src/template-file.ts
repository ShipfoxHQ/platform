import {
  createRangeEnvironment,
  createWorkflowExpression,
  evaluateWorkflowExpressionWithEnvironment,
  InvalidWorkflowExpressionError,
  InvalidWorkflowTemplateError,
  parseWorkflowTemplate,
  type WorkflowExpression,
  type WorkflowTemplateSegment,
} from '@shipfox/expression';
import {logger} from '@shipfox/node-opentelemetry';

/** The maximum number of hand-written and expanded templates in one file. */
export const MAX_TEMPLATES = 1_000;

export type VariantBindings = Readonly<Record<string, unknown>>;

export interface ParsedTemplateList extends ReadonlyArray<ParsedTemplateValue> {}

export interface ParsedTemplateObject {
  readonly [key: string]: ParsedTemplateValue;
}

export type ParsedTemplateValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly WorkflowTemplateSegment[]
  | ParsedTemplateList
  | ParsedTemplateObject;

export type MatrixAxis = readonly unknown[] | WorkflowExpression;

export interface MatrixBlock {
  readonly axes: Readonly<Record<string, MatrixAxis>>;
  readonly exclude: readonly VariantBindings[];
  readonly include: readonly VariantBindings[];
  readonly let: Readonly<Record<string, WorkflowExpression>>;
  readonly key?: WorkflowExpression;
  readonly template: Readonly<Record<string, ParsedTemplateValue>>;
}

export interface ProvisionerTemplateFile {
  readonly templates: Readonly<Record<string, unknown>>;
  readonly vars?: Readonly<Record<string, unknown>>;
  readonly defaults?: Readonly<Record<string, ParsedTemplateValue>>;
  readonly matrix?: Readonly<Record<string, MatrixBlock>>;
}

export interface Variant {
  readonly block: string;
  readonly bindings: VariantBindings;
}

export class ProvisionerTemplateFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProvisionerTemplateFileError';
  }
}

/**
 * Parse the provider-neutral template-file envelope and matrix declarations.
 * Expressions are syntax-checked but not evaluated until enumeration.
 */
export function parseTemplateFile(raw: unknown): ProvisionerTemplateFile {
  const errors: string[] = [];
  if (!isRecord(raw)) {
    throw new ProvisionerTemplateFileError('Template file must be a map.');
  }

  const allowedKeys = new Set(['templates', 'vars', 'defaults', 'matrix']);
  for (const key of Object.keys(raw)) {
    if (!allowedKeys.has(key)) errors.push(`unknown file key "${key}"`);
  }

  const templates = parseRecord(raw.templates, 'templates', errors) ?? {};
  const vars = parseOptionalRecord(raw.vars, 'vars', errors);
  const defaults = parseOptionalTemplateFragment(raw.defaults, 'defaults', errors);
  const matrix = parseMatrix(raw.matrix, errors);

  if (errors.length > 0) {
    throw new ProvisionerTemplateFileError(`Invalid template file: ${errors.join('; ')}`);
  }

  return {
    templates,
    ...(vars === undefined ? {} : {vars}),
    ...(defaults === undefined ? {} : {defaults}),
    ...(matrix === undefined ? {} : {matrix}),
  };
}

/**
 * Enumerate matrix variants in declaration order.
 *
 * Axis values are crossed with the first declared axis as the most significant
 * axis and the last declared axis as the least significant axis. All blocks are
 * evaluated and validated before the first cartesian product is materialized.
 */
export function enumerateVariants(file: ProvisionerTemplateFile): Variant[] {
  const preparedBlocks: PreparedBlock[] = [];
  const errors: string[] = [];

  for (const [blockName, block] of Object.entries(file.matrix ?? {})) {
    const prepared = evaluateBlockAxes(blockName, block, file.vars ?? {}, errors);
    if (prepared !== undefined) preparedBlocks.push(prepared);
  }

  if (errors.length > 0) {
    throw new ProvisionerTemplateFileError(`Invalid template matrix: ${errors.join('; ')}`);
  }

  const contributions = preparedBlocks.map(({name, cartesianCount, include}) => ({
    name,
    count: cartesianCount + BigInt(include.length),
  }));
  const matrixCount = contributions.reduce((total, contribution) => total + contribution.count, 0n);
  const handWrittenCount = BigInt(Object.keys(file.templates).length);
  const totalCount = matrixCount + handWrittenCount;

  if (totalCount > BigInt(MAX_TEMPLATES)) {
    const contributionText = contributions.map(({name, count}) => `${name}: ${count}`).join(', ');
    const matrixText = contributionText.length > 0 ? ` (${contributionText})` : '';
    throw new ProvisionerTemplateFileError(
      `matrix expands to ${matrixCount} templates${matrixText} plus ${handWrittenCount} hand-written; the maximum is ${MAX_TEMPLATES}`,
    );
  }

  const variants: Variant[] = [];
  for (const block of preparedBlocks) {
    const cartesian = materializeCartesianProduct(block.axisNames, block.axisValues);
    for (const bindings of cartesian) {
      if (!block.exclude.some((entry) => matchesPartial(bindings, entry))) {
        variants.push({block: block.name, bindings});
      }
    }
    for (const bindings of block.include) {
      variants.push({block: block.name, bindings});
    }
  }

  return variants;
}

export const parseProvisionerTemplateFile = parseTemplateFile;
export const enumerateTemplateVariants = enumerateVariants;

export type RenderedTemplateMap = Readonly<Record<string, unknown>>;

/**
 * Render all matrix variants and hand-written templates into one provider-neutral map.
 *
 * Defaults are merged before any expression is evaluated. Exact single-expression
 * leaves retain their CEL value type; mixed leaves are rendered as strings.
 */
export function renderTemplateVariants(file: ProvisionerTemplateFile): RenderedTemplateMap {
  const variants = enumerateVariants(file);
  const failures = new RenderFailureCollector();
  const renderedHandWritten = renderHandWrittenTemplates(file, failures);
  const renderedGenerated: RenderedVariant[] = [];

  for (const variant of variants) {
    const block = file.matrix?.[variant.block];
    if (block === undefined) {
      failures.record(variant.block, variant.bindings, 'block', 'Matrix block is missing.');
      continue;
    }

    const evaluation = evaluateVariant(variant, block, file.vars ?? {}, failures);
    if (evaluation === undefined) continue;

    const mergedTemplate = mergeTemplateObjects(file.defaults, block.template);
    const rendered = renderTemplateObject(
      mergedTemplate,
      evaluation.context,
      evaluation.environment,
      variant.block,
      evaluation.displayBindings,
      failures,
    );
    if (rendered.failed) continue;

    renderedGenerated.push({
      block: variant.block,
      bindings: variant.bindings,
      displayBindings: evaluation.displayBindings,
      key: evaluation.key,
      template: rendered.value,
    });
  }

  if (failures.hasFailures()) throw failures.toError();

  const generatedByKey = new Map<string, RenderedVariant>();
  const collisions: string[] = [];
  for (const generated of renderedGenerated) {
    const previous = generatedByKey.get(generated.key);
    if (previous !== undefined) {
      collisions.push(formatCollision(generated.key, previous, generated));
      continue;
    }
    generatedByKey.set(generated.key, generated);
  }

  if (collisions.length > 0) {
    throw new ProvisionerTemplateFileError(`Template key collisions: ${collisions.join('; ')}`);
  }

  const templates: Record<string, unknown> = Object.fromEntries(renderedHandWritten.templates);
  for (const generated of renderedGenerated) {
    if (Object.hasOwn(file.templates, generated.key)) {
      logger().warn(
        {
          event: 'provisioner.template_generated_shadowed',
          templateKey: generated.key,
          block: generated.block,
          bindings: generated.displayBindings,
        },
        `Generated template "${generated.key}" from matrix "${generated.block}" is shadowed by a hand-written template`,
      );
      continue;
    }
    Object.defineProperty(templates, generated.key, {
      configurable: true,
      enumerable: true,
      value: generated.template,
      writable: true,
    });
  }

  return templates;
}

export const renderVariants = renderTemplateVariants;

interface RenderedVariant {
  readonly block: string;
  readonly bindings: VariantBindings;
  readonly displayBindings: VariantBindings;
  readonly key: string;
  readonly template: unknown;
}

interface VariantEvaluation {
  readonly context: Readonly<Record<string, unknown>>;
  readonly displayBindings: VariantBindings;
  readonly environment: ReturnType<typeof createRangeEnvironment>;
  readonly key: string;
}

interface RenderedHandWrittenTemplates {
  readonly templates: readonly (readonly [string, unknown])[];
}

interface RenderedValue {
  readonly failed: boolean;
  readonly value: unknown;
}

interface RenderFailure {
  readonly bindings: VariantBindings;
  readonly message: string;
  readonly path: string;
}

const MAX_FAILURE_SAMPLES = 5;

class RenderFailureCollector {
  private readonly failures = new Map<
    string,
    {count: number; samples: RenderFailure[]; variantKeys: Set<string>}
  >();

  record(block: string, bindings: VariantBindings, path: string, message: string): void {
    const entry = this.failures.get(block) ?? {count: 0, samples: [], variantKeys: new Set()};
    const variantKey = formatBindings(bindings);
    if (!entry.variantKeys.has(variantKey)) {
      entry.variantKeys.add(variantKey);
      entry.count += 1;
    }
    if (entry.samples.length < MAX_FAILURE_SAMPLES) {
      entry.samples.push({bindings, path, message});
    }
    this.failures.set(block, entry);
  }

  hasFailures(): boolean {
    return this.failures.size > 0;
  }

  toError(): ProvisionerTemplateFileError {
    const messages = [...this.failures.entries()].map(([block, entry]) => {
      const samples = entry.samples
        .map(
          (failure) =>
            `${failure.path} for bindings ${formatBindings(failure.bindings)}: ${failure.message}`,
        )
        .join('; ');
      const omitted =
        entry.count > entry.samples.length ? `; ${entry.count - entry.samples.length} more` : '';
      return `${entry.count} variants failed in matrix \`${block}\`: ${samples}${omitted}`;
    });
    return new ProvisionerTemplateFileError(`Template rendering failed: ${messages.join('; ')}`);
  }
}

function renderHandWrittenTemplates(
  file: ProvisionerTemplateFile,
  failures: RenderFailureCollector,
): RenderedHandWrittenTemplates {
  const templates: (readonly [string, unknown])[] = [];
  for (const [key, rawTemplate] of Object.entries(file.templates)) {
    const parseErrors: string[] = [];
    const parsedTemplate = parseTemplateValue(rawTemplate, `templates.${key}`, parseErrors);
    if (parseErrors.length > 0) {
      failures.record('templates', {template: key}, `templates.${key}`, parseErrors.join('; '));
      continue;
    }

    const mergedTemplate = mergeTemplateObjects(file.defaults, parsedTemplate);
    const environment = createRangeEnvironment();
    const context = createEvaluationContext(file.vars ?? {}, {}, {});
    const rendered = renderTemplateObject(
      mergedTemplate,
      context,
      environment,
      'templates',
      {template: key},
      failures,
    );
    if (!rendered.failed) templates.push([key, rendered.value]);
  }
  return {templates};
}

function evaluateVariant(
  variant: Variant,
  block: MatrixBlock,
  vars: Readonly<Record<string, unknown>>,
  failures: RenderFailureCollector,
): VariantEvaluation | undefined {
  const environment = createRangeEnvironment();
  const letBindings = createMap<unknown>();
  let hasFailure = false;

  for (const [name, expression] of Object.entries(block.let)) {
    const context = createEvaluationContext(vars, variant.bindings, letBindings);
    try {
      letBindings[name] = evaluateWorkflowExpressionWithEnvironment(
        expression,
        context,
        environment,
      );
    } catch (error) {
      hasFailure = true;
      failures.record(
        variant.block,
        {...variant.bindings, ...letBindings},
        `let.${name}`,
        errorMessage(error),
      );
    }
  }

  const displayBindings = {...variant.bindings, ...letBindings};
  const context = createEvaluationContext(vars, variant.bindings, letBindings);
  let key: string;
  if (block.key !== undefined) {
    try {
      key = coerceTemplateValue(
        evaluateWorkflowExpressionWithEnvironment(block.key, context, environment),
      );
    } catch (error) {
      hasFailure = true;
      failures.record(variant.block, displayBindings, 'key', errorMessage(error));
      key = '';
    }
  } else {
    try {
      key = deriveTemplateKey(variant.block, block.axes, variant.bindings);
    } catch (error) {
      hasFailure = true;
      failures.record(variant.block, displayBindings, 'key', errorMessage(error));
      key = '';
    }
  }

  return hasFailure ? undefined : {context, displayBindings, environment, key};
}

function renderTemplateObject(
  template: ParsedTemplateValue,
  context: Readonly<Record<string, unknown>>,
  environment: ReturnType<typeof createRangeEnvironment>,
  block: string,
  bindings: VariantBindings,
  failures: RenderFailureCollector,
): RenderedValue {
  return renderTemplateValue(template, context, environment, 'template', block, bindings, failures);
}

function renderTemplateValue(
  value: ParsedTemplateValue,
  context: Readonly<Record<string, unknown>>,
  environment: ReturnType<typeof createRangeEnvironment>,
  path: string,
  block: string,
  bindings: VariantBindings,
  failures: RenderFailureCollector,
): RenderedValue {
  if (isWorkflowTemplateSegments(value)) {
    return renderTemplateSegments(value, context, environment, path, block, bindings, failures);
  }
  if (Array.isArray(value)) {
    let failed = false;
    const rendered = value.map((child, index) => {
      const result = renderTemplateValue(
        child,
        context,
        environment,
        `${path}.${index}`,
        block,
        bindings,
        failures,
      );
      failed ||= result.failed;
      return result.value;
    });
    return {failed, value: rendered};
  }
  if (isRecord(value)) {
    let failed = false;
    const rendered = Object.fromEntries(
      Object.entries(value).map(([key, child]) => {
        const result = renderTemplateValue(
          child as ParsedTemplateValue,
          context,
          environment,
          `${path}.${key}`,
          block,
          bindings,
          failures,
        );
        failed ||= result.failed;
        return [key, result.value];
      }),
    );
    return {failed, value: rendered};
  }
  return {failed: false, value};
}

function renderTemplateSegments(
  segments: readonly WorkflowTemplateSegment[],
  context: Readonly<Record<string, unknown>>,
  environment: ReturnType<typeof createRangeEnvironment>,
  path: string,
  block: string,
  bindings: VariantBindings,
  failures: RenderFailureCollector,
): RenderedValue {
  const exactExpression = segments.length === 1 && segments[0]?.kind === 'expr';
  if (exactExpression) {
    const segment = segments[0];
    if (segment?.kind !== 'expr') return {failed: false, value: ''};
    try {
      return {
        failed: false,
        value: evaluateWorkflowExpressionWithEnvironment(segment.expression, context, environment),
      };
    } catch (error) {
      failures.record(block, bindings, path, errorMessage(error));
      return {failed: true, value: undefined};
    }
  }

  let failed = false;
  let rendered = '';
  for (const segment of segments) {
    if (segment.kind === 'literal') {
      rendered += segment.text;
      continue;
    }
    try {
      rendered += coerceTemplateValue(
        evaluateWorkflowExpressionWithEnvironment(segment.expression, context, environment),
      );
    } catch (error) {
      failed = true;
      failures.record(block, bindings, path, errorMessage(error));
    }
  }
  return {failed, value: rendered};
}

function deriveTemplateKey(
  blockName: string,
  axes: Readonly<Record<string, MatrixAxis>>,
  bindings: VariantBindings,
): string {
  const parts = [blockName];
  for (const axisName of Object.keys(axes)) {
    const value = bindings[axisName];
    if (isRecord(value) || Array.isArray(value)) {
      if (!isRecord(value) || !Object.hasOwn(value, 'name')) {
        throw new Error(
          `axis "${axisName}" object must have a name field for default key derivation`,
        );
      }
      parts.push(coerceKeyPart(value.name));
    } else {
      parts.push(coerceKeyPart(value));
    }
  }
  return parts.join('-');
}

function coerceKeyPart(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  return coerceTemplateValue(value);
}

function mergeTemplateObjects(
  defaults: Readonly<Record<string, ParsedTemplateValue>> | undefined,
  template: ParsedTemplateValue,
): ParsedTemplateValue {
  if (defaults === undefined) return template;
  return deepMergeTemplateValues(defaults as ParsedTemplateValue, template);
}

function deepMergeTemplateValues(
  left: ParsedTemplateValue,
  right: ParsedTemplateValue,
): ParsedTemplateValue {
  if (!isRecord(left) || !isRecord(right)) return right;
  return Object.fromEntries(
    [...new Set([...Object.keys(left), ...Object.keys(right)])].map((key) => {
      if (!Object.hasOwn(right, key)) return [key, left[key]];
      if (!Object.hasOwn(left, key)) return [key, right[key]];
      return [
        key,
        deepMergeTemplateValues(
          left[key] as ParsedTemplateValue,
          right[key] as ParsedTemplateValue,
        ),
      ];
    }),
  );
}

function createEvaluationContext(
  vars: Readonly<Record<string, unknown>>,
  bindings: VariantBindings,
  letBindings: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const context = createMap<unknown>();
  context.vars = vars;
  for (const [name, value] of Object.entries(bindings)) context[name] = value;
  for (const [name, value] of Object.entries(letBindings)) context[name] = value;
  return context;
}

function isWorkflowTemplateSegments(
  value: ParsedTemplateValue,
): value is readonly WorkflowTemplateSegment[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (segment) =>
        isRecord(segment) &&
        (segment.kind === 'literal' || segment.kind === 'expr') &&
        (segment.kind === 'literal'
          ? typeof segment.text === 'string'
          : isRecord(segment.expression)),
    )
  );
}

function coerceTemplateValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value instanceof Date) return value.toISOString();
  const serialized = JSON.stringify(value, (_key, nestedValue) => {
    if (typeof nestedValue !== 'bigint') return nestedValue;
    const numberValue = Number(nestedValue);
    return Number.isSafeInteger(numberValue) ? numberValue : nestedValue.toString();
  });
  return serialized ?? '';
}

function formatCollision(key: string, previous: RenderedVariant, current: RenderedVariant): string {
  const axisNames = new Set([...Object.keys(previous.bindings), ...Object.keys(current.bindings)]);
  const differingAxes = [...axisNames].filter(
    (axisName) => !valuesEqual(previous.bindings[axisName], current.bindings[axisName]),
  );
  return `key "${key}" is used by matrix "${previous.block}" with bindings ${formatBindings(previous.displayBindings)} and matrix "${current.block}" with bindings ${formatBindings(current.displayBindings)}; differing axes: ${differingAxes.join(', ') || 'none'}`;
}

function formatBindings(bindings: VariantBindings): string {
  return coerceTemplateValue(bindings);
}

interface PreparedBlock {
  readonly name: string;
  readonly axisNames: readonly string[];
  readonly axisValues: Readonly<Record<string, readonly unknown[]>>;
  readonly exclude: readonly VariantBindings[];
  readonly include: readonly VariantBindings[];
  readonly cartesianCount: bigint;
}

function evaluateBlockAxes(
  blockName: string,
  block: MatrixBlock,
  vars: Readonly<Record<string, unknown>>,
  errors: string[],
): PreparedBlock | undefined {
  const axisNames = Object.keys(block.axes);
  const axisValues = createMap<readonly unknown[]>();
  let cartesianCount = 1n;
  let hasError = false;
  const environment = createRangeEnvironment();

  for (const axisName of axisNames) {
    const axis = block.axes[axisName];
    if (axis === undefined) {
      errors.push(`matrix "${blockName}" axis "${axisName}" is missing`);
      hasError = true;
      continue;
    }
    let values: unknown[];
    if (Array.isArray(axis)) {
      values = [...axis];
    } else {
      try {
        const expression = axis as WorkflowExpression;
        const result = evaluateWorkflowExpressionWithEnvironment(expression, {vars}, environment);
        if (!Array.isArray(result)) {
          errors.push(`matrix "${blockName}" axis "${axisName}" must evaluate to a list`);
          hasError = true;
          continue;
        }
        values = result;
      } catch (error) {
        errors.push(
          `matrix "${blockName}" axis "${axisName}" could not be evaluated: ${errorMessage(error)}`,
        );
        hasError = true;
        continue;
      }
    }

    if (values.length === 0) {
      errors.push(`matrix "${blockName}" axis "${axisName}" must not be empty`);
      hasError = true;
      continue;
    }

    axisValues[axisName] = values;
    cartesianCount *= BigInt(values.length);
  }

  return hasError
    ? undefined
    : {
        name: blockName,
        axisNames,
        axisValues,
        exclude: block.exclude,
        include: block.include,
        cartesianCount,
      };
}

function materializeCartesianProduct(
  axisNames: readonly string[],
  axisValues: Readonly<Record<string, readonly unknown[]>>,
): VariantBindings[] {
  const variants: VariantBindings[] = [];

  function visit(axisIndex: number, bindings: Record<string, unknown>): void {
    if (axisIndex === axisNames.length) {
      variants.push({...bindings});
      return;
    }

    const axisName = axisNames[axisIndex];
    if (axisName === undefined) return;
    for (const value of axisValues[axisName] ?? []) {
      bindings[axisName] = value;
      visit(axisIndex + 1, bindings);
    }
    delete bindings[axisName];
  }

  visit(0, createMap());
  return variants;
}

function parseMatrix(
  value: unknown,
  errors: string[],
): Readonly<Record<string, MatrixBlock>> | undefined {
  if (value === undefined) return undefined;
  const blocks = parseRecord(value, 'matrix', errors);
  if (blocks === undefined) return undefined;

  const parsed = createMap<MatrixBlock>();
  for (const [name, rawBlock] of Object.entries(blocks)) {
    const block = parseBlock(name, rawBlock, errors);
    if (block !== undefined) parsed[name] = block;
  }
  return parsed;
}

function parseBlock(name: string, value: unknown, errors: string[]): MatrixBlock | undefined {
  const path = `matrix.${name}`;
  if (!isRecord(value)) {
    errors.push(`${path} must be a map`);
    return undefined;
  }

  const allowedKeys = new Set(['axes', 'exclude', 'include', 'let', 'key', 'template']);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) errors.push(`${path} has unknown key "${key}"`);
  }

  const axes = parseAxes(value.axes, `${path}.axes`, errors);
  const exclude = parseVariantList(value.exclude, `${path}.exclude`, errors, axes);
  const include = parseVariantList(value.include, `${path}.include`, errors, axes, true);
  const bindings = parseExpressionMap(value.let, `${path}.let`, errors);
  const key =
    value.key === undefined ? undefined : parseExpression(value.key, `${path}.key`, errors);
  const template = parseTemplateObject(value.template, `${path}.template`, errors);

  return {
    axes,
    exclude,
    include,
    let: bindings,
    ...(key === undefined ? {} : {key}),
    template,
  };
}

function parseAxes(
  value: unknown,
  path: string,
  errors: string[],
): Readonly<Record<string, MatrixAxis>> {
  const rawAxes = parseRecord(value, path, errors);
  if (rawAxes === undefined) return {};

  const axes = createMap<MatrixAxis>();
  for (const [name, axis] of Object.entries(rawAxes)) {
    if (name.length === 0) {
      errors.push(`${path} contains an empty axis name`);
      continue;
    }
    if (Array.isArray(axis)) {
      if (axis.length === 0) errors.push(`${path}.${name} must not be empty`);
      axes[name] = axis;
      continue;
    }
    const expression = parseExpression(axis, `${path}.${name}`, errors);
    if (expression !== undefined) axes[name] = expression;
  }
  return axes;
}

function parseVariantList(
  value: unknown,
  path: string,
  errors: string[],
  axes: Readonly<Record<string, MatrixAxis>>,
  requireComplete = false,
): VariantBindings[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push(`${path} must be a list`);
    return [];
  }

  return value.flatMap((entry, index) => {
    const entryPath = `${path}.${index}`;
    if (!isRecord(entry)) {
      errors.push(`${entryPath} must be a map`);
      return [];
    }

    const axisNames = Object.keys(axes);
    const missing = axisNames.filter((axisName) => !Object.hasOwn(entry, axisName));
    const extra = Object.keys(entry).filter((axisName) => !Object.hasOwn(axes, axisName));
    if (requireComplete && missing.length > 0) {
      errors.push(`${entryPath} must bind every declared axis; missing ${missing.join(', ')}`);
    }
    if (extra.length > 0) {
      errors.push(`${entryPath} has unknown axes: ${extra.join(', ')}`);
    }
    if (requireComplete && (missing.length > 0 || extra.length > 0)) return [];
    if (!requireComplete && extra.length > 0) return [];

    return [
      Object.fromEntries(
        (requireComplete ? axisNames : Object.keys(entry)).map((axisName) => [
          axisName,
          entry[axisName],
        ]),
      ),
    ];
  });
}

function parseExpressionMap(
  value: unknown,
  path: string,
  errors: string[],
): Readonly<Record<string, WorkflowExpression>> {
  if (value === undefined) return {};
  const rawBindings = parseRecord(value, path, errors);
  if (rawBindings === undefined) return {};

  const bindings = createMap<WorkflowExpression>();
  for (const [name, expression] of Object.entries(rawBindings)) {
    const parsed = parseExpression(expression, `${path}.${name}`, errors);
    if (parsed !== undefined) bindings[name] = parsed;
  }
  return bindings;
}

function parseExpression(
  value: unknown,
  path: string,
  errors: string[],
): WorkflowExpression | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push(`${path} must be a non-empty expression`);
    return undefined;
  }

  try {
    if (value.includes('${{')) {
      const segments = parseWorkflowTemplate(value);
      if (segments.length !== 1 || segments[0]?.kind !== 'expr') {
        errors.push(`${path} must contain exactly one expression`);
        return undefined;
      }
      return segments[0].expression;
    }
    return createWorkflowExpression({source: value, check: {mode: 'syntax'}});
  } catch (error) {
    errors.push(`${path} is invalid: ${expressionErrorMessage(error)}`);
    return undefined;
  }
}

function parseRecord(
  value: unknown,
  path: string,
  errors: string[],
): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    errors.push(`${path} must be a map`);
    return undefined;
  }
  return value;
}

function parseOptionalRecord(
  value: unknown,
  path: string,
  errors: string[],
): Readonly<Record<string, unknown>> | undefined {
  if (value === undefined) return undefined;
  return parseRecord(value, path, errors);
}

function parseOptionalTemplateFragment(
  value: unknown,
  path: string,
  errors: string[],
): Readonly<Record<string, ParsedTemplateValue>> | undefined {
  if (value === undefined) return undefined;
  return parseTemplateObject(value, path, errors);
}

function parseTemplateObject(
  value: unknown,
  path: string,
  errors: string[],
): Readonly<Record<string, ParsedTemplateValue>> {
  const record = parseRecord(value, path, errors);
  if (record === undefined) return {};

  return Object.fromEntries(
    Object.entries(record).map(([key, child]) => [
      key,
      parseTemplateValue(child, `${path}.${key}`, errors),
    ]),
  );
}

function parseTemplateValue(value: unknown, path: string, errors: string[]): ParsedTemplateValue {
  if (typeof value === 'string' && value.includes('${{')) {
    try {
      return parseWorkflowTemplate(value);
    } catch (error) {
      errors.push(`${path} is invalid: ${expressionErrorMessage(error)}`);
      return value;
    }
  }
  if (Array.isArray(value)) {
    return value.map((child, index) => parseTemplateValue(child, `${path}.${index}`, errors));
  }
  if (isRecord(value)) {
    return parseTemplateObject(value, path, errors);
  }
  return value as ParsedTemplateValue;
}

function matchesPartial(bindings: VariantBindings, partial: VariantBindings): boolean {
  return Object.entries(partial).every(([key, value]) => valuesEqual(bindings[key], value));
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (typeof left === 'number' && typeof right === 'bigint') {
    return Number.isInteger(left) && Number.isSafeInteger(left) && BigInt(left) === right;
  }
  if (typeof left === 'bigint' && typeof right === 'number') return valuesEqual(right, left);
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length && left.every((value, index) => valuesEqual(value, right[index]))
    );
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every((key) => Object.hasOwn(right, key) && valuesEqual(left[key], right[key]))
    );
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function createMap<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

function expressionErrorMessage(error: unknown): string {
  if (error instanceof InvalidWorkflowExpressionError) return error.reason;
  if (error instanceof InvalidWorkflowTemplateError) return error.reason;
  return errorMessage(error);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.cause instanceof Error) return error.cause.message;
    return error.message;
  }
  return String(error);
}
