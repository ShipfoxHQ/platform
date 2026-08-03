import {readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

const packageDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(packageDirectory, '../..');
const ignoredDirectoryNames = new Set([
  '.context',
  '.git',
  '.next',
  '.turbo',
  'coverage',
  'dist',
  'node_modules',
  'storybook-static',
]);

function isGeneratedProse(file) {
  const relativeFile = path.relative(repositoryRoot, file);
  return (
    path.basename(file) === 'CHANGELOG.md' ||
    relativeFile === path.join('.changeset', 'README.md')
  );
}

async function collectFiles(directory, predicate, files = []) {
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    if (entry.isDirectory() && !ignoredDirectoryNames.has(entry.name)) {
      await collectFiles(path.join(directory, entry.name), predicate, files);
      continue;
    }

    if (entry.isFile()) {
      const file = path.join(directory, entry.name);
      if (predicate(file)) files.push(file);
    }
  }

  return files;
}

const files = new Set([
  'AGENTS.md',
  'CLAUDE.md',
  'CONTRIBUTING.md',
  'DESIGN.md',
  'README.md',
  'WRITING.md',
]);

for (const directory of ['apps/docs/content', 'docs', '.changeset']) {
  const directoryFiles = await collectFiles(
    path.join(repositoryRoot, directory),
    (file) =>
      /\.(?:md|mdx)$/.test(file) &&
      !isGeneratedProse(file),
  );
  for (const file of directoryFiles) files.add(path.relative(repositoryRoot, file));
}

for (const file of await collectFiles(
  repositoryRoot,
  (file) => path.basename(file) === 'README.md' && !isGeneratedProse(file),
)) {
  files.add(path.relative(repositoryRoot, file));
}

const vale = spawn('vale', ['--config=.vale.ini', ...[...files].sort()], {
  cwd: repositoryRoot,
  stdio: 'inherit',
});

vale.on('error', (error) => {
  console.error(`Unable to run Vale: ${error.message}`);
  process.exitCode = 2;
});

vale.on('exit', (code, signal) => {
  if (signal) {
    console.error(`Vale stopped after ${signal}.`);
    process.exitCode = 2;
  } else if (code !== 0) {
    process.exitCode = code ?? 2;
  }
});
