import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, expect, test} from '@shipfox/vitest/vi';
import {attachLocalRunnerLog, boundedDiagnosticValue} from './attachments.js';

describe('failure attachments', () => {
  test('omits large diagnostic values and circular references', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(boundedDiagnosticValue({payload: 'x'.repeat(16 * 1024 + 1)})).toEqual({
      payload: {__e2e_value_omitted__: true, serialized_utf8_bytes: 16 * 1024 + 3},
    });
    expect(boundedDiagnosticValue({message: 'x'.repeat(16 * 1024 + 1)})).toEqual({
      message: {__e2e_value_omitted__: true, serialized_utf8_bytes: 16 * 1024 + 1},
    });
    expect(boundedDiagnosticValue({message: 'small', circular})).toEqual({
      message: 'small',
      circular: {self: {__e2e_value_omitted__: true, reason: 'circular'}},
    });
  });

  test('truncates large UTF-8 runner logs without splitting a character', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'shipfox-e2e-attachments-'));
    try {
      const runnerLogFile = join(directory, 'runner.log');
      await writeFile(runnerLogFile, '🙂'.repeat(100_000));
      const attachments: Array<{name: string; contentType: string; body: string}> = [];

      await attachLocalRunnerLog(
        (attachment) => {
          attachments.push(attachment);
          return Promise.resolve();
        },
        runnerLogFile,
        {maxBytes: 64},
      );

      expect(attachments).toHaveLength(1);
      expect(attachments[0]?.body?.startsWith('🙂'.repeat(8))).toBe(true);
      expect(attachments[0]?.body?.endsWith('🙂'.repeat(8))).toBe(true);
      expect(attachments[0]?.body).not.toContain('\ufffd');
      expect(attachments[0]?.body).toContain('measured=400000');
    } finally {
      await rm(directory, {recursive: true, force: true});
    }
  });
});
