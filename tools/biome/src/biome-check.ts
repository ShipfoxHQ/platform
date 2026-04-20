#!/usr/bin/env node

import {execSync} from 'node:child_process';
import {buildShellCommand, getProjectBinaryPath, getWorkspaceFilePath} from '@shipfox/tool-utils';

const binPath = getProjectBinaryPath('biome', import.meta.url);
const biomeConfigFile = getWorkspaceFilePath('biome.json');

const extraArgs: string[] = [];

if (process.argv.includes('--write') || process.argv.includes('--fix')) extraArgs.push('--write');

const positionalArgs = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const targets = positionalArgs.length > 0 ? positionalArgs : [process.cwd()];

const command = buildShellCommand([
  binPath,
  'check',
  '--enforce-assist=true',
  '--config-path',
  biomeConfigFile,
  ...extraArgs,
  ...targets,
]);

execSync(command, {stdio: 'inherit'});
