import {mkdir, mkdtemp, readdir, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, resolve} from 'node:path';

const probeNamePrefix = 'shipfox-biome-root-config-probe-';
const probePathPrefix = resolve(tmpdir(), probeNamePrefix);
const maximumProbeAgeMs = 24 * 60 * 60 * 1_000;

export async function removeStaleRootConfigProbes(): Promise<void> {
  const entries = await readdir(tmpdir(), {withFileTypes: true});

  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(probeNamePrefix))
      .map(async (entry) => {
        const probeRoot = resolve(tmpdir(), entry.name);
        const probeStat = await stat(probeRoot).catch((error: unknown) => {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return undefined;
          }
          throw error;
        });
        if (probeStat === undefined) {
          return;
        }

        if (Date.now() - probeStat.mtimeMs < maximumProbeAgeMs) {
          return;
        }

        await rm(probeRoot, {recursive: true, force: true});
      }),
  );
}

export async function withRootConfigProbe<T>(
  relativePath: string,
  contents: string,
  run: (probePath: string) => Promise<T>,
): Promise<T> {
  const probeRoot = await mkdtemp(probePathPrefix);
  const probePath = resolve(probeRoot, relativePath);

  try {
    await mkdir(dirname(probePath), {recursive: true});
    await writeFile(probePath, contents);
    return await run(probePath);
  } finally {
    await rm(probeRoot, {recursive: true, force: true});
  }
}
