import type {Environment, RegisteredFunctionHandler} from '@marcbachmann/cel-js';

/** Maximum number of values one evaluation's range calls may materialize. */
export const MAX_RANGE_ELEMENTS = 1_000;

/** Maximum context-byte fan-out one evaluation's range calls may represent. */
export const MAX_RANGE_FANOUT_BYTES = 1_000_000;

/** Maximum UTF-8 bytes returned by toJson() calls in one evaluation. */
export const MAX_JSON_OUTPUT_BYTES = 1_000_000;

const utf8Encoder = new TextEncoder();

const RANGE_FUNCTION_SIGNATURE = 'range(dyn, dyn, dyn): list<int>';
const TO_JSON_FUNCTION_SIGNATURE = 'toJson(dyn): string';
const FROM_JSON_FUNCTION_SIGNATURE = 'fromJson(string): dyn';

interface WorkflowFunctionBudget {
  remainingRangeElements: number;
  remainingRangeFanoutBytes: number;
  remainingJsonOutputBytes: number;
  context: unknown;
  contextBytes: number | undefined;
}

/** Per-evaluation budgets held by the handlers registered on an environment. */
export interface WorkflowFunctionBudgets {
  isolate<T>(context: unknown, evaluation: () => T): T;
}

interface WorkflowFunctionDefinition {
  readonly signature: string;
  readonly createHandler: (budget: WorkflowFunctionBudget) => RegisteredFunctionHandler;
}

const workflowFunctionRegistry = [
  {
    signature: RANGE_FUNCTION_SIGNATURE,
    createHandler:
      (budget: WorkflowFunctionBudget): RegisteredFunctionHandler =>
      (start: unknown, stop: unknown, step: unknown) =>
        evaluateRange(budget, start, stop, step),
  },
  {
    signature: TO_JSON_FUNCTION_SIGNATURE,
    createHandler:
      (budget: WorkflowFunctionBudget): RegisteredFunctionHandler =>
      (value: unknown) =>
        serializeJson(budget, value),
  },
  {
    signature: FROM_JSON_FUNCTION_SIGNATURE,
    createHandler: (): RegisteredFunctionHandler => (value: unknown) => {
      if (typeof value !== 'string') throw new TypeError('fromJson() expects a JSON string');
      return JSON.parse(value, reviveJsonNumber) as unknown;
    },
  },
] satisfies readonly WorkflowFunctionDefinition[];

/**
 * Register the shared functions and return the budgets their handlers close over.
 *
 * Callers that reuse one environment across evaluations must wrap each evaluation
 * in `isolate` so it gets a full budget without consuming an enclosing one. A
 * context accessor can re-enter the evaluator, so the enclosing budget is
 * restored rather than reset.
 */
export function registerWorkflowFunctions(environment: Environment): WorkflowFunctionBudgets {
  const budget: WorkflowFunctionBudget = {
    remainingRangeElements: MAX_RANGE_ELEMENTS,
    remainingRangeFanoutBytes: MAX_RANGE_FANOUT_BYTES,
    remainingJsonOutputBytes: MAX_JSON_OUTPUT_BYTES,
    context: undefined,
    contextBytes: undefined,
  };
  for (const definition of workflowFunctionRegistry) {
    environment.registerFunction(definition.signature, definition.createHandler(budget));
  }

  return {
    isolate<T>(context: unknown, evaluation: () => T): T {
      const enclosing = {
        rangeElements: budget.remainingRangeElements,
        rangeFanoutBytes: budget.remainingRangeFanoutBytes,
        jsonOutputBytes: budget.remainingJsonOutputBytes,
        context: budget.context,
        contextBytes: budget.contextBytes,
      };
      budget.remainingRangeElements = MAX_RANGE_ELEMENTS;
      budget.remainingRangeFanoutBytes = MAX_RANGE_FANOUT_BYTES;
      budget.remainingJsonOutputBytes = MAX_JSON_OUTPUT_BYTES;
      budget.context = context;
      budget.contextBytes = undefined;
      try {
        return evaluation();
      } finally {
        budget.remainingRangeElements = enclosing.rangeElements;
        budget.remainingRangeFanoutBytes = enclosing.rangeFanoutBytes;
        budget.remainingJsonOutputBytes = enclosing.jsonOutputBytes;
        budget.context = enclosing.context;
        budget.contextBytes = enclosing.contextBytes;
      }
    },
  };
}

function materializeRange(start: bigint, stop: bigint, step: bigint): bigint[] {
  const values: bigint[] = [];
  for (let value = start; value <= stop; value += step) values.push(value);
  return values;
}

function rangeElementCount(start: bigint, stop: bigint, step: bigint): bigint {
  if (step <= 0n) throw new RangeError('range step must be positive');
  if (start > stop) return 0n;

  return (stop - start) / step + 1n;
}

function toCelInteger(value: unknown, name: string): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  throw new RangeError(`${name} must be a safe integer`);
}

function evaluateRange(
  budget: WorkflowFunctionBudget,
  start: unknown,
  stop: unknown,
  step: unknown,
): bigint[] {
  const startValue = toCelInteger(start, 'range start');
  const stopValue = toCelInteger(stop, 'range stop');
  const stepValue = toCelInteger(step, 'range step');
  const count = rangeElementCount(startValue, stopValue, stepValue);
  if (count > BigInt(budget.remainingRangeElements)) {
    throw new RangeError(
      `range evaluation budget exceeded; ${count} elements requested with ${budget.remainingRangeElements} remaining`,
    );
  }

  const contextBytes = getContextBytes(budget);
  const fanoutBytes = count * BigInt(contextBytes);
  if (fanoutBytes > BigInt(budget.remainingRangeFanoutBytes)) {
    throw new RangeError(
      `range fan-out budget exceeded; ${count} elements requested for ${contextBytes} context bytes with ${budget.remainingRangeFanoutBytes} remaining`,
    );
  }

  const values = materializeRange(startValue, stopValue, stepValue);
  budget.remainingRangeElements -= values.length;
  budget.remainingRangeFanoutBytes -= Number(fanoutBytes);
  return values;
}

function getContextBytes(budget: WorkflowFunctionBudget): number {
  if (budget.contextBytes !== undefined) return budget.contextBytes;

  try {
    const json = JSON.stringify(budget.context, stringifyBigint);
    if (json === undefined) {
      budget.contextBytes = 0;
      return 0;
    }

    budget.contextBytes = Math.min(MAX_RANGE_FANOUT_BYTES + 1, utf8Encoder.encode(json).byteLength);
    return budget.contextBytes;
  } catch {
    // A context that cannot be serialized is not safe to fan out over.
    budget.contextBytes = MAX_RANGE_FANOUT_BYTES + 1;
    return budget.contextBytes;
  }
}

function serializeJson(budget: WorkflowFunctionBudget, value: unknown): string {
  const json = JSON.stringify(value, stringifyBigint);
  if (json === undefined) throw new TypeError('toJson() value must be JSON-serializable');

  const outputBytes = utf8Encoder.encode(json).byteLength;
  if (outputBytes > budget.remainingJsonOutputBytes) {
    throw new RangeError(
      `toJson evaluation budget exceeded; ${outputBytes} bytes requested with ${budget.remainingJsonOutputBytes} remaining`,
    );
  }

  budget.remainingJsonOutputBytes -= outputBytes;
  return json;
}

function reviveJsonNumber(_key: string, value: unknown): unknown {
  return typeof value === 'number' && Number.isSafeInteger(value) ? BigInt(value) : value;
}

function stringifyBigint(_key: string, value: unknown): unknown {
  if (typeof value !== 'bigint') return value;

  const numberValue = Number(value);
  return Number.isSafeInteger(numberValue) ? numberValue : value.toString();
}
