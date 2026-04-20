#! /usr/bin/env node

import {execSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildShellCommand, getProjectFilePath, log} from '@shipfox/tool-utils';
import {cleanup} from './utils.js';

async function run() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  let configFile = join(process.cwd(), 'tsconfig.build.json');
  if (!existsSync(configFile)) configFile = join(process.cwd(), 'tsconfig.json');

  const outDir = getProjectFilePath('dist');

  const binPath = join(__dirname, '..', 'node_modules', '.bin', 'tsc');

  const command = buildShellCommand([
    binPath,
    '--project',
    configFile,
    '--declaration',
    '--emitDeclarationOnly',
    '--outDir',
    outDir,
  ]);
  execSync(command, {stdio: 'inherit'});
  await cleanup(configFile);
}

run().catch((e) => {
  log.error(e);
  process.exit(1);
});
