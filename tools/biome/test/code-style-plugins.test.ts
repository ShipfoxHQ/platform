import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {rm, writeFile} from 'node:fs/promises';
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
  'tools/biome/plugins/code-style/fixtures/no-empty-for-loop',
);
const diagnosticPattern = /code-style\/no-empty-for-loop/u;
const rejectedLocationPattern = /rejected\.ts:2:3/u;

describe('code-style Biome plugins', () => {
  test('rejects an unconditional for loop', async () => {
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

  test('allows while loops and bounded for loops', async () => {
    const {stdout, stderr} = await execFileAsync(
      process.execPath,
      [biomeCheck, '--config-path', fixtureConfig, resolve(fixtureRoot, 'allowed.ts')],
      {cwd: workspaceRoot},
    );

    assert.doesNotMatch(`${stdout}${stderr}`, diagnosticPattern);
  });

  test('enforces the rule through the real root config', async () => {
    const probePath = resolve(workspaceRoot, 'e2e/core/src/zz-empty-for-loop-regression.ts');
    await writeFile(
      probePath,
      ['export function runForever(): void {', '  for (;;) {', '    break;', '  }', '}', ''].join(
        '\n',
      ),
    );

    try {
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
      await rm(probePath, {force: true});
    }
  });
});
