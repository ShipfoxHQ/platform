import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {overlayBuiltOutputs} from '../src/staging.js';

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

test('overlays built output and productionizes the pruned package manifest', () => {
  const root = mkdtempSync(join(tmpdir(), 'shipfox-staging-'));
  const workspaceRoot = join(root, 'workspace');
  const prunedRoot = join(root, 'pruned');
  const packagePath = 'libs/example';

  try {
    mkdirSync(join(workspaceRoot, packagePath, 'dist'), {recursive: true});
    mkdirSync(join(prunedRoot, packagePath), {recursive: true});
    writeFileSync(join(workspaceRoot, packagePath, 'dist/index.js'), 'export const ready = true;\n');
    writeJson(join(workspaceRoot, packagePath, 'package.json'), {
      name: '@shipfox/example',
      scripts: {build: 'build'},
    });
    writeJson(join(prunedRoot, 'package.json'), {private: true});
    writeJson(join(prunedRoot, packagePath, 'package.json'), {
      name: '@shipfox/example',
      imports: {'#*': './src/*'},
      scripts: {build: 'build'},
    });

    overlayBuiltOutputs({prunedRoot, workspaceRoot});

    assert.equal(
      readFileSync(join(prunedRoot, packagePath, 'dist/index.js'), 'utf8'),
      'export const ready = true;\n',
    );
    assert.deepEqual(
      JSON.parse(readFileSync(join(prunedRoot, packagePath, 'package.json'), 'utf8')).imports,
      {'#*': './dist/*'},
    );
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test('fails when a pruned build package has no built output', () => {
  const root = mkdtempSync(join(tmpdir(), 'shipfox-staging-'));
  const workspaceRoot = join(root, 'workspace');
  const prunedRoot = join(root, 'pruned');
  const packagePath = 'libs/example';

  try {
    mkdirSync(join(workspaceRoot, packagePath), {recursive: true});
    mkdirSync(join(prunedRoot, packagePath), {recursive: true});
    writeJson(join(workspaceRoot, packagePath, 'package.json'), {
      name: '@shipfox/example',
      scripts: {build: 'build'},
    });
    writeJson(join(prunedRoot, 'package.json'), {private: true});
    writeJson(join(prunedRoot, packagePath, 'package.json'), {
      name: '@shipfox/example',
      scripts: {build: 'build'},
    });

    assert.throws(
      () => overlayBuiltOutputs({prunedRoot, workspaceRoot}),
      /libs\/example has no built dist\//,
    );
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});
