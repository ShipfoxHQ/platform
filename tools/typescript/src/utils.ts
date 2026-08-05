import {execFileSync} from 'node:child_process';
import {readdir, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {getProjectBinaryPath} from '@shipfox/tool-utils';
import {API} from 'typescript/unstable/sync';

const tsExtensionRegex = /\.tsx?/;

export function readTypeScriptConfig(tsConfigPath: string): {
  fileNames: string[];
  outDir: string | undefined;
  rootDir: string | undefined;
} {
  const binPath = getProjectBinaryPath('tsc', import.meta.url);
  try {
    execFileSync(binPath, ['--project', tsConfigPath, '--noEmit', '--listFilesOnly'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const detail =
      error instanceof Error && 'stdout' in error && error.stdout
        ? String(error.stdout).trim()
        : error instanceof Error
          ? error.message
          : String(error);
    throw new Error(`Could not parse TypeScript config: ${tsConfigPath}\n${detail}`);
  }

  const api = new API();

  try {
    const config = api.parseConfigFile(tsConfigPath);
    return {
      fileNames: config.fileNames,
      outDir: typeof config.options.outDir === 'string' ? config.options.outDir : undefined,
      rootDir: typeof config.options.rootDir === 'string' ? config.options.rootDir : undefined,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not parse TypeScript config: ${tsConfigPath}\n${detail}`);
  } finally {
    api.close();
  }
}

export async function cleanup(tsConfigPath: string) {
  const {fileNames, outDir, rootDir} = readTypeScriptConfig(tsConfigPath);
  if (!outDir) throw new Error('TS config is missing outDir');
  if (!rootDir) throw new Error('TS config is missing rootDir');

  const filesInOutput = await readdir(outDir, {recursive: true});
  const tsFilesInOutput = filesInOutput
    .filter((f) => f.endsWith('d.ts') || f.endsWith('d.ts.map'))
    .map((f) => join(outDir, f));

  const expectedTsTilesInOutput = fileNames
    .map((f) => f.replace(rootDir, outDir))
    .map((f) => f.replace(tsExtensionRegex, '.d.ts'))
    .flatMap((f) => [f, `${f}.map`]);

  const filesToDelete = tsFilesInOutput.filter((f) => !expectedTsTilesInOutput.includes(f));
  await Promise.all(filesToDelete.map((f) => rm(f, {force: true})));
}
