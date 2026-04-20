#!/usr/bin/env node

import {execSync} from 'node:child_process';
import {buildShellCommand, getProjectBinaryPath, getWorkspaceFilePath} from '@shipfox/tool-utils';

const binPath = getProjectBinaryPath('biome', import.meta.url);
const biomeConfigFile = getWorkspaceFilePath('biome.json');

const extraArgs: string[] = [];

if (process.argv.includes('--fix')) extraArgs.push('--write');

const command = buildShellCommand([
  binPath,
  'check',
  '--enforce-assist=true',
  '--config-path',
  biomeConfigFile,
  ...extraArgs,
  process.cwd(),
]);

execSync(command, {stdio: 'inherit'});
