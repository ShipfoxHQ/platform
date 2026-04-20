#! /usr/bin/env node

import {execSync} from 'node:child_process';
import {buildShellCommand, getProjectBinaryPath} from '@shipfox/tool-utils';

const binPath = getProjectBinaryPath('vite', import.meta.url);

const command = buildShellCommand([binPath, 'build', '--outDir', 'dist']);
execSync(command, {stdio: 'inherit'});
