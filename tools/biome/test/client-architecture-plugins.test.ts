import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {readFile, rm, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);
const packageDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(packageDirectory, '../../..');
const biomeCheck = resolve(workspaceRoot, 'tools/biome/bin/biome-check.js');
const rootConfig = resolve(workspaceRoot, 'biome.json');
const fixtureConfig = resolve(
  workspaceRoot,
  'tools/biome/plugins/client-architecture/fixtures/biome.fixture.json',
);
const fixtureRoot = resolve(workspaceRoot, 'tools/biome/plugins/client-architecture/fixtures');
const routeInputFixtureRoot = resolve(
  workspaceRoot,
  'tools/biome/plugins/client-architecture/fixtures/route-inputs',
);
const browserStorageFixtureRoot = resolve(
  workspaceRoot,
  'tools/biome/plugins/client-architecture/fixtures/browser-storage',
);
const rawSpacingFixtureRoot = resolve(
  workspaceRoot,
  'tools/biome/plugins/client-architecture/fixtures/no-raw-spacing',
);
const rejectedLocationPattern = /rejected\.ts:3/u;
const testFixturePattern = /ignored\.test\.ts/u;
const storyFixturePattern = /ignored\.stories\.ts/u;
const generatedFixturePattern = /rejected\.gen\.ts/u;
const routeInputRulePattern = /client-architecture\/no-raw-route-inputs/u;
const storageRulePattern = /client-architecture\/no-direct-browser-storage/u;
const rawSpacingRulePattern = /client-architecture\/no-raw-spacing/u;
const rawSpacingDiagnosticPattern = /client-architecture\/no-raw-spacing/g;
const rawSpacingRejectedLocationPattern = /rejected\.tsx:/u;

const fixtureRuleNames = [
  'fixture-boundary',
  'no-api-dto-in-core',
  'no-client-framework-in-core',
  'no-response-dto-in-presentation',
  'no-raw-api-request',
  'no-query-cache-ownership',
] as const;

describe('client-architecture Biome plugins', () => {
  for (const ruleName of fixtureRuleNames) {
    const ruleRoot = resolve(fixtureRoot, ruleName);

    test(`${ruleName} fails a rejected fixture through the package check wrapper`, async () => {
      await assert.rejects(
        execFileAsync(process.execPath, [biomeCheck, '--config-path', fixtureConfig, ruleRoot], {
          cwd: workspaceRoot,
        }),
        (error: unknown) => {
          const commandError = error as {stdout?: string; stderr?: string};
          const output = `${commandError.stdout ?? ''}${commandError.stderr ?? ''}`;
          assert.match(output, new RegExp(`client-architecture/${ruleName}`, 'u'));
          assert.match(output, rejectedLocationPattern);
          assert.doesNotMatch(output, testFixturePattern);
          assert.doesNotMatch(output, storyFixturePattern);
          assert.doesNotMatch(output, generatedFixturePattern);
          return true;
        },
      );
    });

    test(`${ruleName} passes an allowed fixture through the package check wrapper`, async () => {
      const {stdout, stderr} = await execFileAsync(
        process.execPath,
        [biomeCheck, '--config-path', fixtureConfig, resolve(ruleRoot, 'allowed.ts')],
        {cwd: workspaceRoot},
      );

      assert.doesNotMatch(`${stdout}${stderr}`, new RegExp(`client-architecture/${ruleName}`, 'u'));
    });
  }

  test('rejects raw route-input imports and namespace variants', async () => {
    await assert.rejects(
      execFileAsync(
        process.execPath,
        [biomeCheck, '--config-path', fixtureConfig, resolve(routeInputFixtureRoot, 'rejected.ts')],
        {cwd: workspaceRoot},
      ),
      (error: unknown) => {
        const commandError = error as {stdout?: string; stderr?: string};
        assert.match(
          `${commandError.stdout ?? ''}${commandError.stderr ?? ''}`,
          routeInputRulePattern,
        );
        return true;
      },
    );
  });

  test('allows typed route-input adapters', async () => {
    const {stdout, stderr} = await execFileAsync(
      process.execPath,
      [biomeCheck, '--config-path', fixtureConfig, resolve(routeInputFixtureRoot, 'allowed.ts')],
      {cwd: workspaceRoot},
    );
    assert.doesNotMatch(`${stdout}${stderr}`, routeInputRulePattern);
  });

  test('rejects direct browser storage access', async () => {
    await assert.rejects(
      execFileAsync(
        process.execPath,
        [
          biomeCheck,
          '--config-path',
          fixtureConfig,
          resolve(browserStorageFixtureRoot, 'rejected.ts'),
        ],
        {cwd: workspaceRoot},
      ),
      (error: unknown) => {
        const commandError = error as {stdout?: string; stderr?: string};
        assert.match(
          `${commandError.stdout ?? ''}${commandError.stderr ?? ''}`,
          storageRulePattern,
        );
        return true;
      },
    );
  });

  test('allows typed browser storage access', async () => {
    const {stdout, stderr} = await execFileAsync(
      process.execPath,
      [
        biomeCheck,
        '--config-path',
        fixtureConfig,
        resolve(browserStorageFixtureRoot, 'allowed.ts'),
      ],
      {cwd: workspaceRoot},
    );
    assert.doesNotMatch(`${stdout}${stderr}`, storageRulePattern);
  });

  test('rejects raw numeric and asymmetric spacing in className string literals', async () => {
    await assert.rejects(
      execFileAsync(
        process.execPath,
        [
          biomeCheck,
          '--config-path',
          fixtureConfig,
          resolve(rawSpacingFixtureRoot, 'rejected.tsx'),
        ],
        {cwd: workspaceRoot},
      ),
      (error: unknown) => {
        const commandError = error as {stdout?: string; stderr?: string};
        const output = `${commandError.stdout ?? ''}${commandError.stderr ?? ''}`;
        assert.match(output, rawSpacingRulePattern);
        assert.match(output, rawSpacingRejectedLocationPattern);
        assert.equal(output.match(rawSpacingDiagnosticPattern)?.length, 9);
        return true;
      },
    );
  });

  test('allows semantic, zero, arbitrary, and non-literal className spacing', async () => {
    const {stdout, stderr} = await execFileAsync(
      process.execPath,
      [biomeCheck, '--config-path', fixtureConfig, resolve(rawSpacingFixtureRoot, 'allowed.tsx')],
      {cwd: workspaceRoot},
    );
    assert.doesNotMatch(`${stdout}${stderr}`, rawSpacingRulePattern);
  });

  test('registers no-raw-spacing for the migrated client surfaces', async () => {
    const rootConfig = JSON.parse(await readFile(resolve(workspaceRoot, 'biome.json'), 'utf8')) as {
      plugins: {includes: string[]; path: string}[];
    };
    const rawSpacingPlugin = rootConfig.plugins.find(({path}) =>
      path.endsWith('/no-raw-spacing.grit'),
    );

    assert.deepEqual(rawSpacingPlugin, {
      path: './tools/biome/plugins/client-architecture/no-raw-spacing.grit',
      includes: [
        '**/apps/docs/**',
        '**/libs/client/shell/**',
        '**/libs/client/auth/**',
        '**/libs/client/secrets/**',
        '**/libs/client/logs/**',
        '**/libs/client/workspace-settings/**',
        '**/libs/client/config/**',
        '**/libs/client/invitations/**',
        '**/libs/client/integrations/**',
        '**/libs/client/triggers/**',
        '**/libs/client/runners/**',
        '**/libs/client/projects/**',
        '!**/dist/**',
        '!**/node_modules/**',
        '!**/*.test.ts',
        '!**/*.test.tsx',
        '!**/*.stories.ts',
        '!**/*.stories.tsx',
        '!**/test/**',
        '!**/tests/**',
        '!**/__tests__/**',
        '!**/generated/**',
        '!**/__generated__/**',
        '!**/*.gen.ts',
        '!**/*.gen.tsx',
      ],
    });
  });

  // The fixture config scopes each rule to its fixture directory. These tests run
  // the real root config so a regression in the repository glob shape cannot make
  // the production rules silently inert.
  test('enforces client-architecture plugins against the real root config', async () => {
    const probePath = resolve(workspaceRoot, 'libs/client/zz-plugin-glob-regression-probe.ts');
    await writeFile(
      probePath,
      [
        "import {useSearch} from '@tanstack/react-router';",
        'export function ProbeComponent() {',
        '  const search = useSearch({strict: false});',
        "  return search ?? window.localStorage.getItem('x');",
        '}',
        '',
      ].join('\n'),
    );
    try {
      await assert.rejects(
        execFileAsync(process.execPath, [biomeCheck, '--config-path', rootConfig, probePath], {
          cwd: workspaceRoot,
        }),
        (error: unknown) => {
          const commandError = error as {stdout?: string; stderr?: string};
          const output = `${commandError.stdout ?? ''}${commandError.stderr ?? ''}`;
          assert.match(output, routeInputRulePattern);
          assert.match(output, storageRulePattern);
          return true;
        },
      );
    } finally {
      await rm(probePath);
    }
  });

  test('exempts the route-input and browser-storage runtime files under the real root config', async () => {
    const {stdout, stderr} = await execFileAsync(
      process.execPath,
      [
        biomeCheck,
        '--config-path',
        rootConfig,
        resolve(workspaceRoot, 'libs/client/shell/src/runtime/route-inputs.ts'),
        resolve(workspaceRoot, 'libs/client/ui/src/browser-storage.ts'),
        resolve(workspaceRoot, 'libs/shared/react/ui/src/utils/browser-storage.ts'),
      ],
      {cwd: workspaceRoot},
    );
    const output = `${stdout}${stderr}`;
    assert.doesNotMatch(output, routeInputRulePattern);
    assert.doesNotMatch(output, storageRulePattern);
  });
});
