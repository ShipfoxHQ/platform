import {
  MAX_OUTPUT_TOTAL_BYTES,
  MAX_OUTPUT_VALUE_BYTES,
} from '@shipfox/runner-execution/step-output';
import {
  MAX_OUTPUT_REPROMPTS,
  OutputCollector,
  RequiredOutputsMissingError,
  runOutputTurnLoop,
} from '#core/output-collector.js';

describe('OutputCollector', () => {
  it('accepts declared scalar outputs as string values', () => {
    const collector = new OutputCollector({
      count: {type: 'number'},
      passed: {type: 'boolean'},
    });

    const count = collector.trySet('count', '42');
    const passed = collector.trySet('passed', 'true');

    expect(count).toEqual({ok: true});
    expect(passed).toEqual({ok: true});
    expect(collector.snapshot()).toEqual({count: '42', passed: 'true'});
    expect(collector.missingRequired()).toEqual([]);
  });

  it('keeps the first value for duplicate writes and reports conflicts', () => {
    const collector = new OutputCollector({answer: {type: 'string'}});

    const first = collector.trySet('answer', 'first');
    const duplicate = collector.trySet('answer', 'first');
    const conflict = collector.trySet('answer', 'second');

    expect(first).toEqual({ok: true});
    expect(duplicate).toEqual({ok: true, idempotent: true});
    expect(conflict).toEqual({
      ok: false,
      isError: true,
      code: 'output_conflict',
      feedback: 'Output "answer" is immutable and already has a different value.',
      details: {code: 'output_conflict', key: 'answer'},
    });
    expect(collector.snapshot()).toEqual({answer: 'first'});
  });

  it('reports stable rejection codes and marks every invalid write', () => {
    const collector = new OutputCollector({count: {type: 'number'}});

    expect(collector.trySet('bad key', 'value')).toMatchObject({
      ok: false,
      isError: true,
      code: 'invalid_output_key',
      details: {code: 'invalid_output_key'},
    });
    expect(collector.trySet('extra', 'value')).toMatchObject({
      ok: false,
      isError: true,
      code: 'undeclared_output',
      details: {code: 'undeclared_output'},
    });
    expect(collector.trySet('count', 'not-a-number')).toMatchObject({
      ok: false,
      isError: true,
      code: 'output_schema_mismatch',
      details: {code: 'output_schema_mismatch'},
    });
  });

  it('rejects undeclared keys on typed steps', () => {
    const schema = {type: 'number'};
    const collector = new OutputCollector({count: {type: 'json', schema}});

    const result = collector.trySet('extra', 'value');

    expect(result).toMatchObject({
      ok: false,
      isError: true,
      code: 'undeclared_output',
      feedback: expect.stringContaining(
        'Output "extra" is not declared by the step output schema. Use one of these exact keys: count.',
      ),
    });
    expect(result).toMatchObject({feedback: expect.not.stringContaining(JSON.stringify(schema))});
    expect(collector.snapshot()).toEqual({});
  });

  it('accepts valid arbitrary keys for untyped steps', () => {
    const collector = new OutputCollector(undefined);

    const result = collector.trySet('summary-text', 'done');

    expect(result).toEqual({ok: true});
    expect(collector.snapshot()).toEqual({'summary-text': 'done'});
  });

  it('rejects invalid output keys', () => {
    const collector = new OutputCollector(undefined);

    const result = collector.trySet('bad key', 'value');

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      ok: false,
      isError: true,
      code: 'invalid_output_key',
      feedback: expect.stringContaining('Output key "bad key"'),
    });
  });

  it('lists declared keys without repeating schemas when a typed step receives an invalid key', () => {
    const schema = {type: 'array', items: {type: 'string'}};
    const collector = new OutputCollector({findings: {type: 'json', schema}});

    const result = collector.trySet('bad key', 'value');

    expect(result).toMatchObject({
      ok: false,
      isError: true,
      code: 'invalid_output_key',
      feedback: expect.stringContaining(
        'Output key "bad key" is invalid. Use letters, numbers, underscores, or hyphens, and start with a letter or underscore. Use one of these exact keys: findings.',
      ),
    });
    expect(result).toMatchObject({
      feedback: expect.not.stringContaining(JSON.stringify(schema, null, 2)),
    });
  });

  it('states the accepted encoding for each declared output type', () => {
    const collector = new OutputCollector({
      summary: {type: 'string'},
      count: {type: 'number'},
      passed: {type: 'boolean'},
    });

    const guidance = collector.guidanceText();

    expect(guidance).toContain('Output "summary"\n- key: "summary"\n- value: the text value');
    expect(guidance).toContain('- value: number encoded as a string');
    expect(guidance).toContain('- value: exactly "true" or "false"');
  });

  it('returns coercion feedback for invalid values without storing them', () => {
    const collector = new OutputCollector({count: {type: 'number'}});

    const result = collector.trySet('count', 'not-a-number');

    expect(result).toMatchObject({
      ok: false,
      feedback: expect.stringContaining(
        'Output "count" must be a finite number or numeric string.',
      ),
    });
    expect(result).toMatchObject({
      feedback: expect.stringContaining('Retry set_output using this exact contract:'),
    });
    expect(result).toMatchObject({
      feedback: expect.stringContaining('- value: number encoded as a string'),
    });
    expect(collector.missingRequired()).toEqual(['count']);
    expect(collector.snapshot()).toEqual({});
  });

  it('validates json outputs from JSON text', () => {
    const collector = new OutputCollector({
      meta: {
        type: 'json',
        schema: {
          type: 'object',
          properties: {name: {type: 'string'}},
          required: ['name'],
          additionalProperties: false,
        },
      },
    });

    const result = collector.trySet('meta', '{"name":"api"}');

    expect(result).toEqual({ok: true});
    expect(collector.snapshot()).toEqual({meta: '{"name":"api"}'});
  });

  it('accepts schema-less json output values from agents', () => {
    const collector = new OutputCollector({
      count: {type: 'json'},
      ready: {type: 'json'},
      payload: {type: 'json'},
      items: {type: 'json'},
    });

    expect(collector.trySet('count', '42')).toEqual({ok: true});
    expect(collector.trySet('ready', 'true')).toEqual({ok: true});
    expect(collector.trySet('payload', '{"name":"build"}')).toEqual({ok: true});
    expect(collector.trySet('items', '["one",2]')).toEqual({ok: true});
    expect(collector.snapshot()).toEqual({
      count: '42',
      ready: 'true',
      payload: '{"name":"build"}',
      items: '["one",2]',
    });
  });

  it('accepts an identical repeated write but rejects a conflicting write', () => {
    const collector = new OutputCollector({summary: {type: 'string'}});

    expect(collector.trySet('summary', 'done')).toEqual({ok: true});
    expect(collector.trySet('summary', 'done')).toEqual({ok: true, idempotent: true});
    expect(collector.trySet('summary', 'changed')).toMatchObject({
      ok: false,
      isError: true,
      code: 'output_conflict',
      details: {code: 'output_conflict', key: 'summary'},
    });
    expect(collector.snapshot()).toEqual({summary: 'done'});
    expect(collector.isComplete).toBe(true);
  });

  it('returns the validation error and exact JSON Schema for a rejected json output', () => {
    const schema = {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'file'],
        properties: {id: {type: 'string'}, file: {type: 'string'}},
        additionalProperties: false,
      },
    };
    const collector = new OutputCollector({findings: {type: 'json', schema}});

    const result = collector.trySet('findings', '[{"id":"intent_scope-1"}]');

    expect(result).toMatchObject({
      ok: false,
      isError: true,
      code: 'output_schema_mismatch',
      feedback: expect.stringContaining('Output "findings" does not match its JSON Schema.'),
    });
    expect(result).toMatchObject({
      feedback: expect.stringContaining('Schema validation error:'),
    });
    expect(result).toMatchObject({
      feedback: expect.stringContaining(JSON.stringify(schema, null, 2)),
    });
  });

  it('rejects values over the per-value cap', () => {
    const collector = new OutputCollector(undefined);
    const measuredBytes = MAX_OUTPUT_VALUE_BYTES + 1;

    const result = collector.trySet('large', 'x'.repeat(measuredBytes));

    expect(result).toMatchObject({
      ok: false,
      isError: true,
      code: 'output_value_too_large',
      feedback:
        `Output "large" exceeds the per-value size limit of ${MAX_OUTPUT_VALUE_BYTES} bytes ` +
        `(measured ${measuredBytes} bytes; overshoot ${measuredBytes - MAX_OUTPUT_VALUE_BYTES} bytes).`,
      details: {
        code: 'output_value_too_large',
        key: 'large',
        limitBytes: MAX_OUTPUT_VALUE_BYTES,
        measuredBytes,
      },
    });
  });

  it('accepts a value at the per-value cap', () => {
    const collector = new OutputCollector(undefined);
    const value = 'x'.repeat(MAX_OUTPUT_VALUE_BYTES);

    const result = collector.trySet('large', value);

    expect(result).toEqual({ok: true});
    expect(collector.snapshot()).toEqual({large: value});
  });

  it('accepts output maps at the total cap', () => {
    const collector = new OutputCollector(undefined);
    const keys = ['one', 'two', 'three', 'four'];
    const lineOverhead = keys.reduce(
      (total, key) => total + Buffer.byteLength(`${key}=\n`, 'utf8'),
      0,
    );
    const valueBytes = Math.floor((MAX_OUTPUT_TOTAL_BYTES - lineOverhead) / keys.length);
    const remainder = MAX_OUTPUT_TOTAL_BYTES - (lineOverhead + valueBytes * keys.length);
    const values = Object.fromEntries(
      keys.map((key, index) => [key, 'x'.repeat(valueBytes + (index === 0 ? remainder : 0))]),
    );

    for (const [key, value] of Object.entries(values)) {
      expect(collector.trySet(key, value)).toEqual({ok: true});
    }

    expect(collector.snapshot()).toEqual(values);
  });

  it('rejects output maps over the total cap', () => {
    const collector = new OutputCollector(undefined);
    const firstValue = 'x'.repeat(MAX_OUTPUT_VALUE_BYTES - 20);
    const overflowValue = 'y'.repeat(100);
    let first = {ok: true} as ReturnType<OutputCollector['trySet']>;
    for (let index = 0; index < 4; index += 1) {
      first = collector.trySet(`chunk_${index}`, firstValue);
    }
    const second = collector.trySet('overflow', overflowValue);
    const measuredBytes =
      4 * Buffer.byteLength(`chunk_0=${firstValue}\n`, 'utf8') +
      Buffer.byteLength(`overflow=${overflowValue}\n`, 'utf8');

    expect(first).toEqual({ok: true});
    expect(second).toMatchObject({
      ok: false,
      isError: true,
      code: 'output_total_too_large',
      feedback:
        `Step outputs exceed the total size limit of ${MAX_OUTPUT_TOTAL_BYTES} bytes ` +
        `(measured ${measuredBytes} bytes; overshoot ${measuredBytes - MAX_OUTPUT_TOTAL_BYTES} bytes).`,
      details: {
        code: 'output_total_too_large',
        key: 'overflow',
        limitBytes: MAX_OUTPUT_TOTAL_BYTES,
        measuredBytes,
      },
    });
  });

  it('lists required outputs with unambiguous json text guidance', () => {
    const schema = {type: 'array', items: {type: 'string'}};
    const collector = new OutputCollector({
      meta: {type: 'json', schema},
      summary: {type: 'string'},
    });

    collector.trySet('summary', 'done');

    expect(collector.missingRequired()).toEqual(['meta']);
    expect(collector.guidanceText()).toContain(
      'The tool input has exactly two string fields: key and value.',
    );
    expect(collector.guidanceText()).toContain(
      'do not wrap it in an object named after the output key.',
    );
    expect(collector.guidanceText()).toContain('Output "meta"');
    expect(collector.guidanceText()).toContain('- key: "meta"');
    expect(collector.guidanceText()).toContain('- value: JSON text encoded as a string');
    expect(collector.guidanceText()).toContain(JSON.stringify(schema, null, 2));
    expect(collector.guidanceTextFor(['meta'])).not.toContain('Output "summary"');
  });

  it('states the full contract for steps without declared outputs', () => {
    const collector = new OutputCollector(undefined);

    expect(collector.guidanceText()).toBe(
      [
        'Workflow output contract:',
        '- Before your final response, call set_output once for every required output.',
        '- The tool input has exactly two string fields: key and value.',
        '- Use each output name below as key exactly as written.',
        '- For a json output, JSON-serialize the output value into the value string. ' +
          'The decoded JSON value itself must match the schema; do not wrap it in an object ' +
          'named after the output key.',
        '',
        'This step has no declared outputs, so any valid output key is accepted.',
      ].join('\n'),
    );
  });
});

describe('runOutputTurnLoop', () => {
  it('fails after exhausting required-output reprompts', async () => {
    const runTurn = vi.fn<Parameters<typeof runOutputTurnLoop>[0]['runTurn']>();
    const controller = new AbortController();

    const result = runOutputTurnLoop({
      signal: controller.signal,
      prompt: 'Set the answer output.',
      runTurn,
      missingRequired: () => ['answer'],
    });

    await expect(result).rejects.toThrow('Agent step finished without required outputs: answer');
    expect(runTurn).toHaveBeenCalledTimes(MAX_OUTPUT_REPROMPTS + 1);
    expect(runTurn).toHaveBeenLastCalledWith(
      'The previous turn ended without setting required workflow outputs: answer. ' +
        'Call set_output for each missing key, then provide your final response.',
    );
  });

  it('waits for prerequisites after all outputs are present', async () => {
    const controller = new AbortController();
    const runTurn = vi.fn<Parameters<typeof runOutputTurnLoop>[0]['runTurn']>();
    let turn = 0;

    const result = runOutputTurnLoop({
      signal: controller.signal,
      prompt: 'Set the answer output.',
      runTurn: (prompt) => {
        runTurn(prompt);
        turn += 1;
        return Promise.resolve();
      },
      missingRequired: () => [],
      completionMissing: () => (turn > 1 ? [] : ['read-diff']),
    });

    await expect(result).resolves.toBeUndefined();
    expect(runTurn).toHaveBeenCalledTimes(2);
    expect(runTurn).toHaveBeenNthCalledWith(2, expect.stringContaining('read-diff'));
  });

  it('does not report completion prerequisites as missing workflow outputs', async () => {
    const controller = new AbortController();
    const result = await runOutputTurnLoop({
      signal: controller.signal,
      prompt: 'Review the pull request.',
      runTurn: vi.fn<Parameters<typeof runOutputTurnLoop>[0]['runTurn']>(),
      missingRequired: () => [],
      completionMissing: () => ['read-diff'],
    }).catch((caught: unknown) => caught);

    expect(result).toBeInstanceOf(RequiredOutputsMissingError);
    expect(result).toMatchObject({
      missing: [],
      message: 'Agent step finished without required outputs: ',
    });
    expect(result).toMatchObject({message: expect.not.stringContaining('read-diff')});
  });

  it('stops before the next turn when aborted mid-loop', async () => {
    const controller = new AbortController();
    const runTurn = vi.fn<Parameters<typeof runOutputTurnLoop>[0]['runTurn']>();

    const result = runOutputTurnLoop({
      signal: controller.signal,
      prompt: 'Set the answer output.',
      runTurn,
      missingRequired: () => {
        controller.abort();
        return ['answer'];
      },
    });

    await expect(result).rejects.toThrow('Agent step aborted');
    expect(runTurn).toHaveBeenCalledOnce();
  });

  it('keeps correction guidance in reprompts but omits it from the final error', async () => {
    const runTurn = vi.fn<Parameters<typeof runOutputTurnLoop>[0]['runTurn']>();
    const controller = new AbortController();
    const outputSpecification = [
      'Output "findings"',
      '- key: "findings"',
      '```json',
      '{"type":"array"}',
      '```',
    ].join('\n');
    const guidance = `Workflow output contract:\n- Call set_output.\n\n${outputSpecification}`;

    const error = await runOutputTurnLoop({
      signal: controller.signal,
      prompt: 'Review the pull request.',
      runTurn,
      missingRequired: () => ['findings'],
      guidanceForMissing: () => guidance,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RequiredOutputsMissingError);
    expect(error).toMatchObject({
      message: 'Agent step finished without required outputs: findings',
      code: 'required_output_missing',
    });
    expect(error).toMatchObject({message: expect.not.stringContaining(outputSpecification)});
    expect(error).toMatchObject({message: expect.not.stringContaining(guidance)});
    expect(runTurn).toHaveBeenLastCalledWith(expect.stringContaining(guidance));
  });
});
