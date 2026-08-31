import {Buffer} from 'node:buffer';
import type {LogRecord} from '@shipfox/api-logs-dto';
import {ndjsonBody, outputLine, recordLine} from '#test/fixtures/ndjson.js';
import {
  ForwardLogTail,
  MAX_STEP_LOG_LINE_BYTES,
  ReverseLogTail,
  STEP_LOG_TRUNCATION_MARKER,
  tailLineFromRecord,
  truncateUtf8,
} from './log-tail.js';

function output(data: string, ts = 1): LogRecord {
  return {v: 1, ts, type: 'output', stream: 'stdout', data};
}

describe('bounded step-log tail', () => {
  it('truncates at a UTF-8 boundary and includes the explicit marker', () => {
    const value = '🙂'.repeat(3_000);

    const truncated = truncateUtf8(value, MAX_STEP_LOG_LINE_BYTES);

    expect(Buffer.byteLength(truncated, 'utf8')).toBeLessThanOrEqual(MAX_STEP_LOG_LINE_BYTES);
    expect(truncated).toContain(STEP_LOG_TRUNCATION_MARKER);
    expect(truncated).not.toContain('\uFFFD');
  });

  it('keeps the newest records when either tail budget is reached', () => {
    const first = tailLineFromRecord(output('first\n'));
    const second = tailLineFromRecord(output('second\n'));
    const third = tailLineFromRecord(output('third\n'));
    const tail = new ForwardLogTail(2, first.serialized.length + second.serialized.length);

    tail.addChunk(Buffer.concat([first.serialized, second.serialized, third.serialized]));

    const result = tail.finish();
    expect(result.retainedLines).toBe(2);
    expect(result.content).toContain('second');
    expect(result.content).toContain('third');
    expect(result.content).not.toContain('first');
  });

  it('renders hot reverse and cold forward walks identically', () => {
    const chunks = [
      ndjsonBody(outputLine('one\n'), outputLine('two\n')),
      ndjsonBody(recordLine({type: 'gap', dropped_bytes: 3}), outputLine('three\n')),
    ];
    const forward = new ForwardLogTail(500);
    for (const chunk of chunks) forward.addChunk(chunk);
    const reverse = new ReverseLogTail(500);
    for (const chunk of [...chunks].reverse()) reverse.addChunk(chunk);

    expect(reverse.finish().content).toBe(forward.finish().content);
  });

  it('truncates normalized session content consistently before rendering', () => {
    const record: LogRecord = {
      v: 1,
      ts: 1,
      type: 'agent_session',
      row: {
        timestamp: 1,
        kind: 'thinking',
        text: '界'.repeat(10_000),
      },
    };

    const line = tailLineFromRecord(record);

    expect(Buffer.byteLength(line.rendered, 'utf8')).toBeLessThanOrEqual(MAX_STEP_LOG_LINE_BYTES);
    expect(line.rendered).toContain(STEP_LOG_TRUNCATION_MARKER);
    expect(line.rendered).not.toContain('\uFFFD');
    expect(JSON.parse(line.serialized.toString('utf8'))).toMatchObject({
      type: 'agent_session',
      row: {kind: 'thinking'},
    });
  });
});
