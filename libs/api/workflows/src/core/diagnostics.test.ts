import {
  MAX_LISTENER_FILTER_SNAPSHOT_BYTES,
  MAX_RESOLVED_STEP_CONFIG_BYTES,
  STEP_RESPONSE_MAX_LENGTH,
  WORKFLOW_DIAGNOSTIC_CONFIG_MAX_BYTES,
  WORKFLOW_DIAGNOSTIC_ERROR_MAX_BYTES,
  WORKFLOW_DIAGNOSTIC_RESPONSE_MAX_BYTES,
} from '@shipfox/api-workflows-dto';
import {
  assertWorkflowExecutionPayloadSize,
  assertWorkflowProductOutputSize,
  boundWorkflowStepError,
  boundWorkflowStepResult,
  diagnosticValueByteLength,
  executionPayloadValueByteLength,
  observeWorkflowDiagnosticSize,
} from './diagnostics.js';

describe('diagnosticValueByteLength', () => {
  test('matches PostgreSQL JSONB text spacing for structured values', () => {
    const value = {message: 'comma, colon:', nested: [true, 'é']};

    expect(diagnosticValueByteLength(value)).toBe(
      Buffer.byteLength('{"message": "comma, colon:", "nested": [true, "é"]}', 'utf8'),
    );
  });

  test('does not count punctuation inside JSON strings as separators', () => {
    expect(diagnosticValueByteLength({value: 'a,b:c'})).toBe(
      Buffer.byteLength('{"value": "a,b:c"}', 'utf8'),
    );
  });

  test('expands exponent-form numbers like PostgreSQL JSONB text', () => {
    expect(diagnosticValueByteLength({small: 1e-7, large: 1e21})).toBe(
      Buffer.byteLength('{"small": 0.0000001, "large": 1000000000000000000000}', 'utf8'),
    );
  });
});

describe('workflow payload policies', () => {
  test('measures compact JSON at the resolved-config execution boundary', () => {
    const value = {run: 'x'.repeat(MAX_RESOLVED_STEP_CONFIG_BYTES - 10)};

    expect(executionPayloadValueByteLength(value)).toBe(MAX_RESOLVED_STEP_CONFIG_BYTES);
    expect(() => assertWorkflowExecutionPayloadSize('resolved_config', value)).not.toThrow();
  });

  test('admits a resolved config larger than the inline diagnostic limit', () => {
    expect(() =>
      assertWorkflowExecutionPayloadSize('resolved_config', {
        run: 'x'.repeat(75_644),
      }),
    ).not.toThrow();
  });

  test('rejects a resolved config only after its execution budget is exceeded', () => {
    expect(() =>
      assertWorkflowExecutionPayloadSize('resolved_config', {
        run: 'x'.repeat(MAX_RESOLVED_STEP_CONFIG_BYTES),
      }),
    ).toThrow(
      expect.objectContaining({
        field: 'resolved_config',
        limitBytes: MAX_RESOLVED_STEP_CONFIG_BYTES,
      }),
    );
  });

  test('bounds listener filter snapshots with their own execution budget', () => {
    const value = {payload: 'x'.repeat(MAX_LISTENER_FILTER_SNAPSHOT_BYTES)};

    expect(() => assertWorkflowExecutionPayloadSize('filter_snapshot', value)).toThrow(
      expect.objectContaining({
        field: 'filter_snapshot',
        limitBytes: MAX_LISTENER_FILTER_SNAPSHOT_BYTES,
        measuredBytes: expect.any(Number),
      }),
    );
  });

  test('observes oversized diagnostics without rejecting the owning write', () => {
    expect(() =>
      observeWorkflowDiagnosticSize('config', {
        run: 'x'.repeat(WORKFLOW_DIAGNOSTIC_CONFIG_MAX_BYTES),
      }),
    ).not.toThrow();
  });

  test('keeps product output enforcement at the existing persisted total cap', () => {
    expect(() =>
      assertWorkflowProductOutputSize('output', {
        value: 'x'.repeat(256 * 1024),
      }),
    ).toThrow(
      expect.objectContaining({
        outputKey: 'output',
        limitBytes: 256 * 1024,
        scope: 'total',
      }),
    );
  });

  test('replaces an oversized response with a typed bounded failure', () => {
    const bounded = boundWorkflowStepResult('response', '😀'.repeat(STEP_RESPONSE_MAX_LENGTH));

    expect(bounded.value).toBeNull();
    expect(bounded.error).toEqual(
      expect.objectContaining({
        code: 'step_result_too_large',
        reason: 'step_result_too_large',
        field: 'response',
        retryable: false,
        limitBytes: WORKFLOW_DIAGNOSTIC_RESPONSE_MAX_BYTES,
        measuredBytes: expect.any(Number),
        overshootBytes: expect.any(Number),
      }),
    );
  });

  test('replaces an oversized error before a terminal transition', () => {
    const bounded = boundWorkflowStepError({
      message: 'x'.repeat(WORKFLOW_DIAGNOSTIC_ERROR_MAX_BYTES),
    });

    expect(bounded).toEqual(
      expect.objectContaining({
        code: 'step_result_too_large',
        reason: 'step_result_too_large',
        field: 'error',
        retryable: false,
        limitBytes: WORKFLOW_DIAGNOSTIC_ERROR_MAX_BYTES,
        measuredBytes: expect.any(Number),
        overshootBytes: expect.any(Number),
      }),
    );
  });
});
