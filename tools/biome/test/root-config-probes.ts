import {mkdtemp, readdir, rm, stat} from 'node:fs/promises';
import {basename, dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const biomeDirectory = resolve(testDirectory, '..');
const probeNamePrefix = '.root-config-probe-';
const currentProcessPrefix = `${probeNamePrefix}${process.pid}-`;
const maximumLiveProbeAgeMs = 24 * 60 * 60 * 1_000;

function isRunningProcess(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

function getOwnerPid(name: string): number | undefined {
  const match = new RegExp(`^${probeNamePrefix}(\\d+)-`, 'u').exec(name);
  if (match?.[1] === undefined) {
    return undefined;
  }
  return Number(match[1]);
}

export async function removeStaleRootConfigProbes(): Promise<void> {
  const entries = await readdir(biomeDirectory, {withFileTypes: true});

  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(probeNamePrefix))
      .map(async (entry) => {
        const probePath = resolve(biomeDirectory, entry.name);
        const ownerPid = getOwnerPid(entry.name);
        let probeStat;
        try {
          probeStat = await stat(probePath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return;
          }
          throw error;
        }
        const isRecent = Date.now() - probeStat.mtimeMs < maximumLiveProbeAgeMs;

        if (ownerPid !== undefined && isRecent && isRunningProcess(ownerPid)) {
          return;
        }

        await rm(probePath, {recursive: true, force: true});
      }),
  );
}

export async function createRootConfigProbe(): Promise<string> {
  return mkdtemp(resolve(biomeDirectory, currentProcessPrefix));
}

export async function removeRootConfigProbe(probePath: string): Promise<void> {
  if (
    dirname(probePath) !== biomeDirectory ||
    !basename(probePath).startsWith(currentProcessPrefix)
  ) {
    throw new Error(`Refusing to remove unexpected root-config probe: ${probePath}`);
  }

  await rm(probePath, {recursive: true, force: true});
}
