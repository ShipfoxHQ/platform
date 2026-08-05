import {execFileSync} from 'node:child_process';
import {readdir, rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import {API} from 'typescript/unstable/sync';

const tsExtensionRegex = /\.tsx?/;
const require = createRequire(import.meta.url);
const tscPath = join(dirname(require.resolve('typescript/package.json')), 'bin', 'tsc');
const diagnosticMaxBufferBytes = 16 * 1024 * 1024;

function commandOutput(error: unknown, stream: 'stderr' | 'stdout'): string | undefined {
  if (!(error instanceof Error) || !(stream in error)) return undefined;
  const output = String((error as Error & Record<string, unknown>)[stream]).trim();
  return output || undefined;
}

function validateTypeScriptConfig(tsConfigPath: string): void {
  const args = [tscPath, '--project', tsConfigPath, '--noEmit', '--listFilesOnly'];

  try {
    // Successful file lists can exceed the child-process buffer and are not used here.
    execFileSync(process.execPath, args, {stdio: ['ignore', 'ignore', 'pipe']});
  } catch (validationError) {
    try {
      // Re-run only invalid configs so their bounded compiler diagnostics can be reported.
      execFileSync(process.execPath, args, {
        maxBuffer: diagnosticMaxBufferBytes,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (diagnosticError) {
      const detail =
        commandOutput(diagnosticError, 'stderr') ??
        commandOutput(diagnosticError, 'stdout') ??
        (diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError));
      throw new Error(`Could not parse TypeScript config: ${tsConfigPath}\n${detail}`);
    }

    throw validationError;
  }
}

export function readTypeScriptConfig(tsConfigPath: string): {
  fileNames: string[];
  outDir: string | undefined;
  rootDir: string | undefined;
} {
  validateTypeScriptConfig(tsConfigPath);

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
