import assert from 'node:assert/strict';
import {readFile, stat, utimes} from 'node:fs/promises';
import {dirname} from 'node:path';
import {removeStaleRootConfigProbes, withRootConfigProbe} from './root-config-probes.js';

const probeContents = 'export const probe = true;\n';
const olderThanMaximumProbeAgeMs = 25 * 60 * 60 * 1_000;

describe('root config probes', () => {
  test('preserves recent probes during stale cleanup', async () => {
    await withRootConfigProbe('probe.ts', probeContents, async (probePath) => {
      await removeStaleRootConfigProbes();
      assert.equal(await readFile(probePath, 'utf8'), probeContents);
    });
  });

  test('removes probes older than the maximum age', async () => {
    await withRootConfigProbe('probe.ts', probeContents, async (probePath) => {
      const probeRoot = dirname(probePath);
      const staleDate = new Date(Date.now() - olderThanMaximumProbeAgeMs);
      await utimes(probeRoot, staleDate, staleDate);

      await removeStaleRootConfigProbes();
      await assert.rejects(stat(probeRoot), (error: unknown) => {
        assert.equal((error as NodeJS.ErrnoException).code, 'ENOENT');
        return true;
      });
    });
  });

  test('removes a probe when its callback fails', async () => {
    const callbackError = new Error('probe callback failed');
    let probeRoot: string | undefined;

    await assert.rejects(
      withRootConfigProbe('probe.ts', probeContents, (probePath) => {
        probeRoot = dirname(probePath);
        return Promise.reject(callbackError);
      }),
      callbackError,
    );

    assert.ok(probeRoot);
    await assert.rejects(stat(probeRoot), (error: unknown) => {
      assert.equal((error as NodeJS.ErrnoException).code, 'ENOENT');
      return true;
    });
  });
});
