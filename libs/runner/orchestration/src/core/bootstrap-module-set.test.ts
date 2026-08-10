import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const probePath = resolve(packageRoot, 'test/bootstrap-module-set-probe.mjs');
const moduleTrackerPath = resolve(packageRoot, 'test/module-load-tracker.mjs');
const require = createRequire(import.meta.url);
const tsxLoaderPath = require.resolve('tsx');
const LINE_BREAK_PATTERN = /\r?\n/u;
const HEAVY_AGENT_PACKAGE_PATTERN =
  /\/node_modules\/(?:@anthropic-ai|@earendil-works|@modelcontextprotocol)(?:\/|\+)/u;

it('keeps heavy agent packages out of the managed bootstrap module set', () => {
  const trackerDirectory = mkdtempSync(join(tmpdir(), 'shipfox-runner-module-set-'));
  const trackerFile = join(trackerDirectory, 'heavy-modules.txt');

  try {
    const result = spawnSync(
      process.execPath,
      [
        '--conditions=workspace-source',
        `--import=${tsxLoaderPath}`,
        '--loader',
        moduleTrackerPath,
        probePath,
      ],
      {
        cwd: packageRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          SHIPFOX_MODULE_TRACKER_FILE: trackerFile,
        },
      },
    );

    if (result.error !== undefined || result.status !== 0) {
      throw new Error(
        [
          result.error?.message,
          `exit status: ${String(result.status)}`,
          result.stdout,
          result.stderr,
        ]
          .filter(Boolean)
          .join('\n'),
      );
    }

    const loadedModules = readFileSync(trackerFile, 'utf8')
      .split(LINE_BREAK_PATTERN)
      .filter(Boolean);
    expect(loadedModules.length).toBeGreaterThan(0);
    expect(loadedModules.some((url) => HEAVY_AGENT_PACKAGE_PATTERN.test(url))).toBe(false);
  } finally {
    rmSync(trackerDirectory, {recursive: true, force: true});
  }
});
