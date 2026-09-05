import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);
const packageDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(packageDirectory, '../../..');
const biomeCheck = resolve(workspaceRoot, 'tools/biome/bin/biome-check.js');
const fixtureConfig = resolve(
  workspaceRoot,
  'tools/biome/plugins/code-style/fixtures/biome.fixture.json',
);
const fixtureRoot = resolve(
  workspaceRoot,
  'tools/biome/plugins/code-style/fixtures/no-fully-empty-for-loop',
);
const diagnosticPattern = /code-style\/no-fully-empty-for-loop/u;
const rejectedLocationPattern = /rejected\.ts:2:3/u;
const rootConfigProbePrefix = resolve(tmpdir(), 'shipfox-biome-root-config-probe-');
const maintainedSourceRootMarker = 'apps/**';
const pluginSpecificExclusions = [
  '!**/node_modules/**',
  '!**/coverage/**',
  '!**/tools/biome/plugins/code-style/fixtures/**',
];

describe('code-style Biome plugins', () => {
  test('rejects a fully empty for loop', async () => {
    await assert.rejects(
      execFileAsync(process.execPath, [biomeCheck, '--config-path', fixtureConfig, fixtureRoot], {
        cwd: workspaceRoot,
      }),
      (error: unknown) => {
        const commandError = error as {stdout?: string; stderr?: string};
        const output = `${commandError.stdout ?? ''}${commandError.stderr ?? ''}`;
        assert.match(output, diagnosticPattern);
        assert.match(output, rejectedLocationPattern);
        return true;
      },
    );
  });

  test('allows while loops and for loops with an explicit clause', async () => {
    const {stdout, stderr} = await execFileAsync(
      process.execPath,
      [biomeCheck, '--config-path', fixtureConfig, resolve(fixtureRoot, 'allowed.ts')],
      {cwd: workspaceRoot},
    );

    assert.doesNotMatch(`${stdout}${stderr}`, diagnosticPattern);
  });

  test('registers the rule for maintained source roots', async () => {
    const config = JSON.parse(await readFile(resolve(workspaceRoot, 'biome.json'), 'utf8')) as {
      plugins: {includes: string[]; path: string}[];
      overrides: {
        includes?: string[];
      }[];
    };
    const plugin = config.plugins.find(({path}) => path.endsWith('/no-fully-empty-for-loop.grit'));
    const maintainedSourceOverride = config.overrides.find(
      ({includes}) => includes?.includes(maintainedSourceRootMarker),
    );

    assert.ok(plugin, 'Expected the root Biome config to register no-fully-empty-for-loop.');
    assert.ok(maintainedSourceOverride, 'Expected the maintained-source override to exist.');

    const expectedIncludes = new Set([
      ...(maintainedSourceOverride.includes ?? []).map((include) =>
        include.startsWith('!') ? include : `**/${include}`,
      ),
      ...pluginSpecificExclusions,
    ]);

    assert.equal(plugin.path, './tools/biome/plugins/code-style/no-fully-empty-for-loop.grit');

    for (const include of expectedIncludes) {
      assert.ok(plugin.includes.includes(include), `Expected the plugin to include ${include}.`);
    }
    for (const include of plugin.includes) {
      assert.ok(expectedIncludes.has(include), `Unexpected plugin include ${include}.`);
    }
  });

  test('enforces the rule through the real root config', async () => {
    const probeRoot = await mkdtemp(rootConfigProbePrefix);
    const probePath = resolve(probeRoot, 'tools/biome/fully-empty-for-loop.ts');

    try {
      await mkdir(dirname(probePath), {recursive: true});
      await writeFile(
        probePath,
        ['export function runForever(): void {', '  for (;;) {', '    break;', '  }', '}', ''].join(
          '\n',
        ),
      );
      await assert.rejects(
        execFileAsync(process.execPath, [biomeCheck, probePath], {cwd: workspaceRoot}),
        (error: unknown) => {
          const commandError = error as {stdout?: string; stderr?: string};
          assert.match(
            `${commandError.stdout ?? ''}${commandError.stderr ?? ''}`,
            diagnosticPattern,
          );
          return true;
        },
      );
    } finally {
      await rm(probeRoot, {recursive: true, force: true});
    }
  });
});
