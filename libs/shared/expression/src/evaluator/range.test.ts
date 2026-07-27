import {createRangeEnvironment, MAX_RANGE_ELEMENTS} from './range.js';

describe('range', () => {
  it('returns an inclusive integer range', () => {
    const evaluator = createRangeEnvironment();

    const result = evaluator.evaluate('range(2, 8, 2)');

    expect(result).toEqual([2n, 4n, 6n, 8n]);
  });

  it('returns an empty range when start is after stop', () => {
    const evaluator = createRangeEnvironment();

    const result = evaluator.evaluate('range(8, 2, 2)');

    expect(result).toEqual([]);
  });

  it('rejects a non-positive step', () => {
    const evaluator = createRangeEnvironment();
    const zeroStep = () => evaluator.evaluate('range(1, 3, 0)');
    const negativeStep = () => evaluator.evaluate('range(1, 3, -1)');

    expect(zeroStep).toThrow('range step must be positive');
    expect(negativeStep).toThrow('range step must be positive');
  });

  it('rejects ranges larger than the per-evaluation budget before allocation', () => {
    const evaluator = createRangeEnvironment();
    const evaluateTooLarge = () => evaluator.evaluate('range(1, 1001, 1)');

    expect(evaluateTooLarge).toThrow(
      `range evaluation budget exceeded; 1001 elements requested with ${MAX_RANGE_ELEMENTS} remaining`,
    );
  });

  it('registers range in an opt-in dynamic evaluator', () => {
    const evaluator = createRangeEnvironment();

    const result = evaluator.evaluate('range(1, 3, 1)');

    expect(result).toEqual([1n, 2n, 3n]);
  });

  it('exposes only the evaluation method needed by expression callers', () => {
    const evaluator = createRangeEnvironment();
    const publicHandle = evaluator as unknown as Record<string, unknown>;

    const ownProperties = Object.keys(publicHandle);

    expect(ownProperties).toEqual(['evaluate']);
    expect(publicHandle.registerFunction).toBeUndefined();
    expect(publicHandle.clone).toBeUndefined();
    expect(publicHandle.parse).toBeUndefined();
  });

  it('accepts plain JavaScript numbers from the evaluation context', () => {
    const evaluator = createRangeEnvironment();

    const result = evaluator.evaluate('range(1, stop, 1)', {stop: 3});

    expect(result).toEqual([1n, 2n, 3n]);
  });

  it('rejects non-integer values from the evaluation context', () => {
    const evaluator = createRangeEnvironment();

    for (const stop of [2.5, '3', null, 1e21]) {
      const evaluateInvalid = () => evaluator.evaluate('range(1, stop, 1)', {stop});

      expect(evaluateInvalid).toThrow('range stop must be a safe integer');
    }
  });

  it('shares a budget across nested range calls in one evaluation', () => {
    const evaluator = createRangeEnvironment();
    const evaluateNested = () => evaluator.evaluate('range(1, 1000, 1).map(value, range(1, 2, 1))');

    expect(evaluateNested).toThrow('range evaluation budget exceeded');
  });

  it('resets the budget for each evaluation', () => {
    const evaluator = createRangeEnvironment();

    const first = evaluator.evaluate('range(1, 1000, 1)');
    const second = evaluator.evaluate('range(1, 1000, 1)');

    expect(first).toHaveLength(1000);
    expect(second).toHaveLength(1000);
  });

  it('uses an independent budget for re-entrant evaluation', () => {
    const evaluator = createRangeEnvironment();
    let nestedResult: unknown;
    const context = {
      get trigger() {
        nestedResult = evaluator.evaluate('size(range(1, 1000, 1))');
        return 1n;
      },
    };
    const evaluateOuter = () =>
      evaluator.evaluate('size(range(1, 900, 1)) + trigger + size(range(1, 101, 1))', context);

    expect(evaluateOuter).toThrow(
      'range evaluation budget exceeded; 101 elements requested with 100 remaining',
    );
    expect(nestedResult).toBe(1000n);
  });
});
