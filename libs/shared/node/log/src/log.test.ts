import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, it, vi} from '@shipfox/vitest/vi';
import pino from 'pino';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('log destination thresholds', () => {
  it('applies the configured file threshold through the shared logger transport', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'shipfox-node-log-'));
    const file = join(directory, 'application.log');

    try {
      vi.stubEnv('LOG_LEVEL', 'info');
      vi.stubEnv('LOG_STDOUT_LEVEL', 'warn');
      vi.stubEnv('LOG_FILE_LEVEL', 'error');
      vi.stubEnv('LOG_STDOUT', 'false');
      vi.stubEnv('LOG_FILE', file);
      vi.stubEnv('LOG_PRETTY', 'false');
      vi.resetModules();

      const {createLogger} = await import('./log.js');
      const logger = createLogger({});
      logger.info('info');
      logger.error('error');
      await new Promise<void>((resolve, reject) =>
        logger.flush((error?: Error) => (error ? reject(error) : resolve())),
      );

      await vi.waitFor(async () => {
        const lines = (await readFile(file, 'utf8'))
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line).msg);
        expect(lines).toEqual(['error']);
      });
    } finally {
      await rm(directory, {recursive: true, force: true});
    }
  });

  it('routes each accepted record to every destination at or above its threshold', () => {
    const stdout: string[] = [];
    const file: string[] = [];
    const logger = pino(
      {level: 'info'},
      pino.multistream([
        {level: 'warn', stream: {write: (line: string) => stdout.push(line)}},
        {level: 'info', stream: {write: (line: string) => file.push(line)}},
      ]),
    );

    logger.info('info');
    logger.warn('warn');

    expect(stdout.map((line) => JSON.parse(line).msg)).toEqual(['warn']);
    expect(file.map((line) => JSON.parse(line).msg)).toEqual(['info', 'warn']);
  });

  it('drops records below the global level from every destination', () => {
    const stdout: string[] = [];
    const file: string[] = [];
    const logger = pino(
      {level: 'info'},
      pino.multistream([
        {level: 'warn', stream: {write: (line: string) => stdout.push(line)}},
        {level: 'info', stream: {write: (line: string) => file.push(line)}},
      ]),
    );

    logger.debug('debug');

    expect(stdout).toEqual([]);
    expect(file).toEqual([]);
  });
});
