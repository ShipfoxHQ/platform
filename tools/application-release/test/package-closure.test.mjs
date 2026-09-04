import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, test} from 'node:test';
import {parse as parseYaml} from 'yaml';

import {
  assertApplicationReleasePackages,
  computePublicationClosure,
  entryPointSupportsRuntimeImport,
  entryPointSupportsTypeResolution,
  listPublicPackageEntryPoints,
  renderFixtureWorkspaceConfig,
  validatePublicationState,
} from '../dist/package-closure.js';

const MISSING_ROOT_ERROR = /Publication root is not a workspace package: @shipfox\/missing/u;
const MISSING_RUNTIME_ERROR = /missing: @shipfox\/runtime/u;
const PRIVATE_RUNTIME_ERROR = /Publication closure package is private: @shipfox\/private-runtime/u;
const SOURCE_TARGET_ERROR = /resolves to src after productionization/u;
const UNEXPECTED_RUNTIME_ERROR = /unexpected: @shipfox\/runtime/u;
const INVALID_VERSION_ERROR = /has invalid version/u;

function workspacePackage(name, options = {}) {
  const directory = `/repo/libs/${name.slice('@shipfox/'.length)}`;
  return {
    directory,
    manifestPath: `${directory}/package.json`,
    manifest: {
      name,
      version: '0.1.0',
      private: options.private ?? false,
      license: 'MIT',
      repository: {
        type: 'git',
        url: 'git+https://github.com/ShipfoxHQ/shipfox.git',
        directory: directory.slice('/repo/'.length),
      },
      imports: {
        ...(options.imports ?? {
          '#*': {
            'workspace-source': './src/*',
            default: './dist/*',
          },
        }),
      },
      exports: options.exports ?? {'.': './dist/index.js'},
      scripts: {build: 'build', type: 'type', 'type:emit': 'type:emit'},
      dependencies: options.dependencies,
      optionalDependencies: options.optionalDependencies,
      peerDependencies: options.peerDependencies,
      devDependencies: options.devDependencies,
    },
  };
}

describe('publication closure', () => {
  test('walks all runtime workspace dependency fields and ignores dev dependencies', () => {
    const packages = new Map([
      [
        '@shipfox/root',
        workspacePackage('@shipfox/root', {
          dependencies: {'@shipfox/runtime': 'workspace:*'},
          optionalDependencies: {'@shipfox/optional-runtime': 'workspace:*'},
          peerDependencies: {'@shipfox/peer-runtime': 'workspace:*'},
          devDependencies: {'@shipfox/test-only': 'workspace:*'},
        }),
      ],
      ['@shipfox/runtime', workspacePackage('@shipfox/runtime')],
      ['@shipfox/optional-runtime', workspacePackage('@shipfox/optional-runtime')],
      ['@shipfox/peer-runtime', workspacePackage('@shipfox/peer-runtime')],
      ['@shipfox/test-only', workspacePackage('@shipfox/test-only')],
    ]);

    const closure = computePublicationClosure(packages, ['@shipfox/root']);

    assert.deepEqual(closure, [
      '@shipfox/optional-runtime',
      '@shipfox/peer-runtime',
      '@shipfox/root',
      '@shipfox/runtime',
    ]);
  });

  test('rejects a missing publication root', () => {
    const compute = () => computePublicationClosure(new Map(), ['@shipfox/missing']);

    assert.throws(compute, MISSING_ROOT_ERROR);
  });

  test('rejects drift between the computed and declared closure', () => {
    const packages = new Map([
      [
        '@shipfox/root',
        workspacePackage('@shipfox/root', {
          dependencies: {'@shipfox/runtime': 'workspace:*'},
        }),
      ],
      ['@shipfox/runtime', workspacePackage('@shipfox/runtime')],
    ]);
    const config = {roots: ['@shipfox/root'], packages: ['@shipfox/root']};

    const validate = () => validatePublicationState(packages, config, '/repo');

    assert.throws(validate, UNEXPECTED_RUNTIME_ERROR);
  });

  test('rejects a public package with a private runtime dependency', () => {
    const packages = new Map([
      [
        '@shipfox/root',
        workspacePackage('@shipfox/root', {
          dependencies: {'@shipfox/private-runtime': 'workspace:*'},
        }),
      ],
      ['@shipfox/private-runtime', workspacePackage('@shipfox/private-runtime', {private: true})],
    ]);
    const config = {
      roots: ['@shipfox/root'],
      packages: ['@shipfox/private-runtime', '@shipfox/root'],
    };

    const validate = () => validatePublicationState(packages, config, '/repo');

    assert.throws(validate, PRIVATE_RUNTIME_ERROR);
  });

  test('allows source conditions when packed targets resolve to dist', () => {
    const packages = new Map([['@shipfox/root', workspacePackage('@shipfox/root')]]);
    const config = {roots: ['@shipfox/root'], packages: ['@shipfox/root']};

    const closure = validatePublicationState(packages, config, '/repo');

    assert.deepEqual(closure, ['@shipfox/root']);
  });

  for (const [field, options] of [
    [
      'imports',
      {
        imports: {
          '#*': {
            'workspace-source': './src/*',
            default: './dist/*',
          },
          '#generated/*': {default: './src/generated/*'},
        },
      },
    ],
    [
      'exports',
      {
        exports: {
          '.': {
            'workspace-source': {types: './src/index.ts', default: './src/index.ts'},
            default: {types: './dist/index.d.ts', default: './src/index.js'},
          },
        },
      },
    ],
  ]) {
    test(`rejects ${field} that resolves to source after productionization`, () => {
      const packages = new Map([['@shipfox/root', workspacePackage('@shipfox/root', options)]]);
      const config = {roots: ['@shipfox/root'], packages: ['@shipfox/root']};

      const validate = () => validatePublicationState(packages, config, '/repo');

      assert.throws(validate, SOURCE_TARGET_ERROR);
    });
  }

  test('rejects an application release missing an expected package', () => {
    const validate = () =>
      assertApplicationReleasePackages(
        [{name: '@shipfox/root', version: '0.1.0'}],
        ['@shipfox/root', '@shipfox/runtime'],
      );

    assert.throws(validate, MISSING_RUNTIME_ERROR);
  });

  for (const version of ['01.2.3', '1.2.3-.', '1.2.3-01']) {
    test(`rejects invalid application-release package version ${version}`, () => {
      const validate = () =>
        assertApplicationReleasePackages([{name: '@shipfox/root', version}], ['@shipfox/root']);

      assert.throws(validate, INVALID_VERSION_ERROR);
    });
  }

  test('classifies JavaScript, type-only, and non-module exports', () => {
    const entryPoints = listPublicPackageEntryPoints('@shipfox/example', {
      '.': {
        'workspace-source': {types: './src/index.ts', default: './src/index.ts'},
        default: {types: './dist/index.d.ts', default: './dist/index.js'},
      },
      './types': {types: './dist/types.d.ts'},
      './package.json': './package.json',
      './styles.css': './dist/styles.css',
    });

    const runtimeEntryPoints = entryPoints
      .filter(({target}) => entryPointSupportsRuntimeImport(target))
      .map(({specifier}) => specifier);
    const typeEntryPoints = entryPoints
      .filter(({target}) => entryPointSupportsTypeResolution(target))
      .map(({specifier}) => specifier);

    assert.deepEqual(runtimeEntryPoints, ['@shipfox/example']);
    assert.deepEqual(typeEntryPoints, ['@shipfox/example', '@shipfox/example/types']);
  });
});

describe('fixture workspace config', () => {
  function withRepository(workspaceYaml, callback) {
    const repositoryRoot = mkdtempSync(join(tmpdir(), 'shipfox-fixture-workspace-'));
    try {
      writeFileSync(join(repositoryRoot, 'pnpm-workspace.yaml'), workspaceYaml);
      return callback(repositoryRoot);
    } finally {
      rmSync(repositoryRoot, {recursive: true, force: true});
    }
  }

  test('carries the repository release-age policy next to the packed overrides', () => {
    const rendered = withRepository(
      [
        'packages:',
        '  - libs/*',
        'minimumReleaseAge: 2880',
        'minimumReleaseAgeExclude:',
        '  - "next@16.3.0"',
        'nodeLinker: isolated',
        '',
      ].join('\n'),
      (repositoryRoot) =>
        renderFixtureWorkspaceConfig({
          repositoryRoot,
          overrides: {'@shipfox/runtime': 'file:/tmp/runtime.tgz'},
        }),
    );

    assert.deepEqual(parseYaml(rendered), {
      packages: ['.'],
      overrides: {'@shipfox/runtime': 'file:/tmp/runtime.tgz'},
      minimumReleaseAge: 2880,
      minimumReleaseAgeExclude: ['next@16.3.0'],
    });
  });

  test('omits the policy when the repository does not declare one', () => {
    const rendered = withRepository('packages:\n  - libs/*\n', (repositoryRoot) =>
      renderFixtureWorkspaceConfig({repositoryRoot, overrides: {}}),
    );

    assert.deepEqual(parseYaml(rendered), {packages: ['.'], overrides: {}});
  });
});
