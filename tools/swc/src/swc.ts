#! /usr/bin/env node

import {execSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {
  buildShellCommand,
  getProjectBinaryPath,
  getProjectFilePath,
  log,
} from '@shipfox/tool-utils';
import {cleanup, getOwnedFileStats} from './utils.js';

async function run() {
  const swcPath = getProjectBinaryPath('swc', import.meta.url);
  const projectSpecificConfigPath = getProjectFilePath('.swcrc');
  const configPath = existsSync(projectSpecificConfigPath)
    ? projectSpecificConfigPath
    : getProjectFilePath('.swcrc', import.meta.url);
  const outputPath = getProjectFilePath('dist');
  const ownedFiles = await getOwnedFileStats(outputPath);
  const extraArgs = process.argv.slice(2);
  const command = buildShellCommand([
    swcPath,
    '--strip-leading-paths',
    '--config-file',
    configPath,
    '-d',
    outputPath,
    ...extraArgs,
    'src',
  ]);
  execSync(command, {stdio: 'inherit'});
  await cleanup(outputPath, ownedFiles);
}

run().catch((e) => {
  log.error(e);
  process.exit(1);
});
