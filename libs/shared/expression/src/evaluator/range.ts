import {type Context, Environment} from '@marcbachmann/cel-js';
import type {WorkflowExpressionEnvironment} from './evaluate-workflow-expression.js';

/** Maximum number of values a config-template range may materialize. */
export const MAX_RANGE_ELEMENTS = 1_000;
const RANGE_FUNCTION_SIGNATURE = 'range(dyn, dyn, dyn): list<int>';

interface RangeBudget {
  remaining: number;
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
  budget: RangeBudget,
  start: unknown,
  stop: unknown,
  step: unknown,
): bigint[] {
  const startValue = toCelInteger(start, 'range start');
  const stopValue = toCelInteger(stop, 'range stop');
  const stepValue = toCelInteger(step, 'range step');
  const count = rangeElementCount(startValue, stopValue, stepValue);
  if (count > BigInt(budget.remaining)) {
    throw new RangeError(
      `range evaluation budget exceeded; ${count} elements requested with ${budget.remaining} remaining`,
    );
  }

  const values = materializeRange(startValue, stopValue, stepValue);
  budget.remaining -= values.length;
  return values;
}

/** Create the opt-in range evaluator for config templating. */
export function createRangeEnvironment(): WorkflowExpressionEnvironment {
  return {
    evaluate(expression: string, context?: Context) {
      const budget = {remaining: MAX_RANGE_ELEMENTS};
      const environment = new Environment({unlistedVariablesAreDyn: true});
      environment.registerFunction(RANGE_FUNCTION_SIGNATURE, (start, stop, step) =>
        evaluateRange(budget, start, stop, step),
      );
      return environment.evaluate(expression, context);
    },
  };
}
