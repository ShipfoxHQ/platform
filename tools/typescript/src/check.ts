#! /usr/bin/env node

import {execSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {buildShellCommand, getProjectBinaryPath, getProjectFilePath} from '@shipfox/tool-utils';

let configPath = getProjectFilePath('tsconfig.test.json');
if (!existsSync(configPath)) configPath = getProjectFilePath('tsconfig.json');

const binPath = getProjectBinaryPath('tsc', import.meta.url);

const command = buildShellCommand([binPath, '--project', configPath, '--noEmit']);
execSync(command, {
  stdio: 'inherit',
});
