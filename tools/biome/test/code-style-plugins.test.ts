import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {
  createRootConfigProbe,
  removeRootConfigProbe,
  removeStaleRootConfigProbes,
} from './root-config-probes.js';

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

describe('code-style Biome plugins', () => {
  beforeAll(removeStaleRootConfigProbes);

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
        linter?: {
          rules?: {
            complexity?: {
              noExcessiveCognitiveComplexity?: {level?: string};
            };
          };
        };
      }[];
    };
    const plugin = config.plugins.find(({path}) => path.endsWith('/no-fully-empty-for-loop.grit'));
    const maintainedSourceOverride = config.overrides.find(
      ({linter}) =>
        linter?.rules?.complexity?.noExcessiveCognitiveComplexity?.level === 'error',
    );

    assert.ok(plugin, 'Expected the root Biome config to register no-fully-empty-for-loop.');
    assert.ok(maintainedSourceOverride, 'Expected the maintained-source override to exist.');

    const expectedSourceRoots = (maintainedSourceOverride.includes ?? [])
      .filter((include) => !include.startsWith('!'))
      .map((include) => `**/${include}`);
    const pluginSourceRoots = plugin.includes.filter((include) => !include.startsWith('!'));

    assert.equal(plugin.path, './tools/biome/plugins/code-style/no-fully-empty-for-loop.grit');
    assert.deepEqual(pluginSourceRoots, expectedSourceRoots);

    for (const exclusion of (maintainedSourceOverride.includes ?? []).filter((include) =>
      include.startsWith('!'),
    )) {
      assert.ok(plugin.includes.includes(exclusion), `Expected the plugin to preserve ${exclusion}.`);
    }
  });

  test('enforces the rule through the real root config', async () => {
    const probeRoot = await createRootConfigProbe();
    const probePath = resolve(probeRoot, 'fully-empty-for-loop.ts');

    try {
      await writeFile(
        probePath,
        ['export function runForever(): void {', '  for (;;) {', '    break;', '  }', '}', ''].join(
          '\n',
        ),
      );
      await assert.rejects(
        execFileAsync(process.execPath, [biomeCheck, '--vcs-use-ignore-file=false', probePath], {
          cwd: workspaceRoot,
        }),
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
      await removeRootConfigProbe(probeRoot);
    }
  });
});
