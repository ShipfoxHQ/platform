import {execSync} from 'node:child_process';
import {buildShellCommand, getProjectBinaryPath} from '@shipfox/tool-utils';

const binPath = getProjectBinaryPath('vite', import.meta.url);

const command = buildShellCommand([binPath]);
execSync(command, {stdio: 'inherit'});
