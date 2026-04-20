import {readdir, rm} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {parseJsonConfigFileContent, readConfigFile, sys} from 'typescript';

const tsExtensionRegex = /\.tsx?/;

export async function cleanup(tsConfigPath: string) {
  const configStr = readConfigFile(tsConfigPath, sys.readFile);
  const config = parseJsonConfigFileContent(configStr.config, sys, dirname(tsConfigPath));
  const {outDir, rootDir} = config.options;
  if (!outDir) throw new Error('TS config is missing outDir');
  if (!rootDir) throw new Error('TS config is missing rootDir');

  const filesInOutput = await readdir(outDir, {recursive: true});
  const tsFilesInOutput = filesInOutput
    .filter((f) => f.endsWith('d.ts') || f.endsWith('d.ts.map'))
    .map((f) => join(outDir, f));

  const expectedTsTilesInOutput = config.fileNames
    .map((f) => f.replace(rootDir, outDir))
    .map((f) => f.replace(tsExtensionRegex, '.d.ts'))
    .flatMap((f) => [f, `${f}.map`]);

  const filesToDelete = tsFilesInOutput.filter((f) => !expectedTsTilesInOutput.includes(f));
  await Promise.all(filesToDelete.map((f) => rm(f, {force: true})));
}
