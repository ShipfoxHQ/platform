import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const cli = require.resolve('@playwright/test/cli');
const result = spawnSync(process.execPath, [cli, 'test', ...process.argv.slice(2)], {
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
