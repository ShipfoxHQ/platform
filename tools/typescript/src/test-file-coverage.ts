import {readdirSync} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';
import {readTypeScriptConfig} from './utils.js';

const ignoredDirectories = new Set([
  '.cache',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'storybook-static',
]);
const testFileRegex = /\.test\.tsx?$/;

function normalizedPath(path: string): string {
  return resolve(path);
}

function findTestFiles(directory: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(directory, {withFileTypes: true})) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        files.push(...findTestFiles(join(directory, entry.name)));
      }
      continue;
    }

    if (entry.isFile() && testFileRegex.test(entry.name)) {
      files.push(join(directory, entry.name));
    }
  }

  return files;
}

export function getMissingTestFiles(
  configPath: string,
  projectRoot = dirname(configPath),
): string[] {
  const config = readTypeScriptConfig(configPath);
  const includedFiles = new Set(config.fileNames.map(normalizedPath));

  return findTestFiles(projectRoot)
    .filter((file) => !includedFiles.has(normalizedPath(file)))
    .map((file) => relative(projectRoot, file));
}

export function assertTestFilesIncluded(configPath: string): void {
  const missingFiles = getMissingTestFiles(configPath);
  if (missingFiles.length === 0) return;

  const formattedFiles = missingFiles.map((file) => `  - ${file}`).join('\n');
  throw new Error(
    [
      `${relative(process.cwd(), configPath)} does not type-check every test file.`,
      'Clear inherited excludes, rename colliding test files, or include each test file intentionally.',
      formattedFiles,
    ].join('\n'),
  );
}
