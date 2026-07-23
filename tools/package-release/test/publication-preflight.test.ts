import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

import {
  preflightPublicationClosure,
  validatePackedPackageManifest,
} from '../src/publication-preflight.js';

const repositoryRoot = resolve(new URL('../../../', import.meta.url).pathname);

const roots: string[] = [];
const missingEntryPointError = /missing entry point/u;

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {force: true, recursive: true});
});

test('packs the complete closure without changing source manifests', async () => {
  const root = createFixture();
  const manifestPath = join(root, 'libs', 'example', 'package.json');
  const sourceManifest = readFileSync(manifestPath, 'utf8');

  await preflightPublicationClosure(root);

  assert.equal(readFileSync(manifestPath, 'utf8'), sourceManifest);
});

test('cleans temporary staging and preserves source manifests when packing fails', async () => {
  const root = createFixture({includeEntryPoint: false});
  const manifestPath = join(root, 'libs', 'example', 'package.json');
  const sourceManifest = readFileSync(manifestPath, 'utf8');

  await assert.rejects(preflightPublicationClosure(root), missingEntryPointError);

  assert.equal(readFileSync(manifestPath, 'utf8'), sourceManifest);
});

test('rejects a packed package with a missing bin entry point', async () => {
  const root = createFixture({bin: './bin/cli.js'});

  await assert.rejects(preflightPublicationClosure(root), missingEntryPointError);
});

test('checks architecture metadata for a registry-matched packed package', () => {
  const entry = {
    directory: join(repositoryRoot, 'libs/api/agent'),
    manifest: {name: '@shipfox/api-agent', version: '1.0.0'},
    manifestPath: join(repositoryRoot, 'libs/api/agent/package.json'),
  };

  assert.doesNotThrow(() =>
    validatePackedPackageManifest(
      entry,
      ['package/package.json', 'package/dist/index.js'],
      {
        ...entry.manifest,
        exports: {'.': './dist/index.js'},
        shipfox: {
          architecture: {
            schema: 1,
            realm: 'source-available',
            kind: 'implementation',
            context: 'agent',
          },
        },
      },
      new Map(),
    ),
  );
});

function createFixture({
  bin,
  includeEntryPoint = true,
}: {
  bin?: string | Record<string, string>;
  includeEntryPoint?: boolean;
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'shipfox-publication-preflight-test-'));
  roots.push(root);
  const packageDirectory = join(root, 'libs', 'example');
  mkdirSync(join(packageDirectory, 'dist'), {recursive: true});
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - libs/*\n');
  writeFileSync(
    join(root, 'publication-closure.json'),
    `${JSON.stringify({roots: ['@shipfox/example'], packages: ['@shipfox/example']}, null, 2)}\n`,
  );
  writeFileSync(
    join(packageDirectory, 'package.json'),
    `${JSON.stringify(
      {
        name: '@shipfox/example',
        version: '1.0.0',
        bin,
        exports: {'.': './dist/index.js'},
        imports: {'#*': './dist/*'},
      },
      null,
      2,
    )}\n`,
  );
  if (includeEntryPoint) writeFileSync(join(packageDirectory, 'dist', 'index.js'), 'export {};\n');
  return root;
}
