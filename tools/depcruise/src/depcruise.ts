#!/usr/bin/env node

import {execSync} from 'node:child_process';
import {buildShellCommand, getProjectBinaryPath, getWorkspaceFilePath} from '@shipfox/tool-utils';

const binPath = getProjectBinaryPath('depcruise', import.meta.url);
const configFile = getWorkspaceFilePath('.dependency-cruiser.cjs');

const command = buildShellCommand([
  binPath,
  '--config',
  configFile,
  '--ts-config',
  'tsconfig.json',
  process.cwd(),
]);

execSync(command, {stdio: 'inherit'});
