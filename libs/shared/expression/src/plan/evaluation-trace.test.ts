import {
  capTraceEntries,
  capTraceValue,
  EVALUATION_TRACE_MAX_BYTES,
  EVALUATION_TRACE_MAX_ENTRIES,
  EVALUATION_TRACE_VALUE_CAP_BYTES,
  evaluationTraceEntry,
} from './evaluation-trace.js';

describe('evaluation trace', () => {
  const serializedByteLength = (value: unknown) =>
    new TextEncoder().encode(JSON.stringify(value)).byteLength;

  it('caps values by UTF-8 bytes with an explicit marker', () => {
    const result = capTraceValue('x'.repeat(EVALUATION_TRACE_VALUE_CAP_BYTES + 1));

    expect(new TextEncoder().encode(result.value).byteLength).toBeLessThanOrEqual(
      EVALUATION_TRACE_VALUE_CAP_BYTES,
    );
    expect(result).toMatchObject({truncated: true});
    expect(result.value).toContain('...[truncated]');
  });

  it('caps values without splitting multi-byte characters', () => {
    const result = capTraceValue('é'.repeat(EVALUATION_TRACE_VALUE_CAP_BYTES));

    expect(new TextEncoder().encode(result.value).byteLength).toBeLessThanOrEqual(
      EVALUATION_TRACE_VALUE_CAP_BYTES,
    );
    expect(result).toMatchObject({truncated: true});
    expect(result.value).toContain('...[truncated]');
    expect(result.value.at(-('...[truncated]'.length + 1))).toBe('é');
  });

  it('caps expression source and omits values for references', () => {
    const entry = evaluationTraceEntry({
      expression: 'x'.repeat(EVALUATION_TRACE_VALUE_CAP_BYTES + 1),
      roots: ['secrets'],
      fillTarget: 'runner-fill',
      evaluatedAt: 'step-dispatch',
      value: 'raw-secret',
      reference: true,
    });

    expect(entry).toMatchObject({
      roots: ['secrets'],
      fillTarget: 'runner-fill',
      evaluatedAt: 'step-dispatch',
      reference: true,
      exprTruncated: true,
    });
    expect(entry).not.toHaveProperty('value');
  });

  it('adds a dropped marker when a row exceeds the entry cap', () => {
    const entries = Array.from({length: EVALUATION_TRACE_MAX_ENTRIES + 2}, (_, index) =>
      evaluationTraceEntry({
        expression: `run.value_${index}`,
        roots: ['run'],
        fillTarget: 'run-creation',
        evaluatedAt: 'run-creation',
        value: String(index),
      }),
    );

    const capped = capTraceEntries(entries);

    expect(capped).toHaveLength(EVALUATION_TRACE_MAX_ENTRIES);
    expect(capped.at(-1)).toEqual({truncated: true, dropped: 3});
  });

  it('bounds the serialized trace and counts byte-dropped entries', () => {
    const entries = Array.from({length: EVALUATION_TRACE_MAX_ENTRIES}, (_, index) =>
      evaluationTraceEntry({
        expression: `run.value_${index}`,
        roots: ['run'],
        fillTarget: 'run-creation',
        evaluatedAt: 'run-creation',
        value: 'é'.repeat(EVALUATION_TRACE_VALUE_CAP_BYTES),
      }),
    );

    const capped = capTraceEntries(entries);

    expect(serializedByteLength(capped)).toBeLessThanOrEqual(EVALUATION_TRACE_MAX_BYTES);
    expect(capped.slice(0, -1)).toEqual(entries.slice(0, capped.length - 1));
    expect(capTraceEntries(entries)).toEqual(capped);
    expect(capped.at(-1)).toEqual({
      truncated: true,
      dropped: entries.length - capped.length + 1,
    });
  });

  it('retains an entry at the exact serialized byte boundary', () => {
    const entry = evaluationTraceEntry({
      expression: 'run.exact',
      roots: ['run'],
      fillTarget: 'run-creation',
      evaluatedAt: 'run-creation',
      value: 'é',
    });
    const exactBudget = serializedByteLength([entry]);

    const capped = capTraceEntries([entry], exactBudget);

    expect(capped).toEqual([entry]);
    expect(serializedByteLength(capped)).toBe(exactBudget);
  });

  it('uses UTF-8 bytes and preserves the omitted count with a dropped marker', () => {
    const entries = [
      evaluationTraceEntry({
        expression: 'run.first_é',
        roots: ['run'],
        fillTarget: 'run-creation',
        evaluatedAt: 'run-creation',
        value: 'é',
      }),
      evaluationTraceEntry({
        expression: 'run.second',
        roots: ['run'],
        fillTarget: 'run-creation',
        evaluatedAt: 'run-creation',
        value: 'second',
      }),
      evaluationTraceEntry({
        expression: 'run.third',
        roots: ['run'],
        fillTarget: 'run-creation',
        evaluatedAt: 'run-creation',
        value: 'third',
      }),
    ];
    const droppedMarker = {truncated: true as const, dropped: 6};
    const exactBudget = serializedByteLength([entries[0], droppedMarker]);

    const capped = capTraceEntries([...entries, {truncated: true, dropped: 4}], exactBudget);

    expect(capped).toEqual([entries[0], droppedMarker]);
    expect(serializedByteLength(capped)).toBe(exactBudget);
  });

  it('absorbs existing dropped markers when capping again', () => {
    const entries = Array.from({length: EVALUATION_TRACE_MAX_ENTRIES}, (_, index) =>
      evaluationTraceEntry({
        expression: `run.value_${index}`,
        roots: ['run'],
        fillTarget: 'run-creation',
        evaluatedAt: 'run-creation',
        value: String(index),
      }),
    );
    const capped = capTraceEntries([...entries, {truncated: true, dropped: 4}]);

    const recapped = capTraceEntries([
      ...capped,
      evaluationTraceEntry({
        expression: 'run.late',
        roots: ['run'],
        fillTarget: 'run-creation',
        evaluatedAt: 'run-creation',
        value: 'late',
      }),
    ]);

    expect(recapped).toHaveLength(EVALUATION_TRACE_MAX_ENTRIES);
    expect(recapped.at(-1)).toEqual({truncated: true, dropped: 6});
  });
});
