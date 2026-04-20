import type {Job} from './entities/definition.js';
import {DagValidationError, validateDag} from './validate-dag.js';

function job(overrides?: Partial<Job>): Job {
  return {steps: [{run: 'echo hello'}], ...overrides};
}

describe('validateDag', () => {
  test('empty jobs returns empty array', () => {
    const result = validateDag({});

    expect(result).toEqual([]);
  });

  test('single job with no deps returns it', () => {
    const result = validateDag({build: job()});

    expect(result).toEqual(['build']);
  });

  test('linear chain A -> B -> C returns topological order', () => {
    const result = validateDag({
      a: job(),
      b: job({needs: 'a'}),
      c: job({needs: 'b'}),
    });

    expect(result.indexOf('a')).toBeLessThan(result.indexOf('b'));
    expect(result.indexOf('b')).toBeLessThan(result.indexOf('c'));
  });

  test('parallel independent jobs all pass', () => {
    const result = validateDag({
      a: job(),
      b: job(),
      c: job(),
    });

    expect(result).toHaveLength(3);
    expect(result).toContain('a');
    expect(result).toContain('b');
    expect(result).toContain('c');
  });

  test('diamond DAG (A->B, A->C, B->D, C->D) passes', () => {
    const result = validateDag({
      a: job(),
      b: job({needs: 'a'}),
      c: job({needs: 'a'}),
      d: job({needs: ['b', 'c']}),
    });

    expect(result.indexOf('a')).toBeLessThan(result.indexOf('b'));
    expect(result.indexOf('a')).toBeLessThan(result.indexOf('c'));
    expect(result.indexOf('b')).toBeLessThan(result.indexOf('d'));
    expect(result.indexOf('c')).toBeLessThan(result.indexOf('d'));
  });

  test('reference to nonexistent job throws DagValidationError', () => {
    expect(() =>
      validateDag({
        a: job({needs: 'nonexistent'}),
      }),
    ).toThrow(DagValidationError);
  });

  test('nonexistent job error includes job names', () => {
    expect(() =>
      validateDag({
        a: job({needs: 'ghost'}),
      }),
    ).toThrow('Job "a" depends on unknown job "ghost"');
  });

  test('direct cycle (A <-> B) throws DagValidationError', () => {
    expect(() =>
      validateDag({
        a: job({needs: 'b'}),
        b: job({needs: 'a'}),
      }),
    ).toThrow(DagValidationError);
  });

  test('self-reference (A needs A) throws DagValidationError', () => {
    expect(() =>
      validateDag({
        a: job({needs: 'a'}),
      }),
    ).toThrow(DagValidationError);
  });

  test('transitive cycle (A -> B -> C -> A) throws with cycle nodes', () => {
    try {
      validateDag({
        a: job({needs: 'c'}),
        b: job({needs: 'a'}),
        c: job({needs: 'b'}),
      });
      expect.fail('Expected DagValidationError');
    } catch (error) {
      expect(error).toBeInstanceOf(DagValidationError);
      expect((error as DagValidationError).cycle).toBeDefined();
      expect((error as DagValidationError).cycle).toContain('a');
      expect((error as DagValidationError).cycle).toContain('b');
      expect((error as DagValidationError).cycle).toContain('c');
    }
  });
});
