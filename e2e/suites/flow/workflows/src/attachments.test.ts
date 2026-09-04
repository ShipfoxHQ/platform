import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, expect, test} from '@shipfox/vitest/vi';
import {attachLocalRunnerLog} from './attachments.js';

describe('failure attachments', () => {
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
      expect(attachments[0]?.body?.startsWith('🙂'.repeat(16))).toBe(true);
      expect(attachments[0]?.body).not.toContain('\ufffd');
      expect(attachments[0]?.body).toContain('measured=400000');
    } finally {
      await rm(directory, {recursive: true, force: true});
    }
  });
});
