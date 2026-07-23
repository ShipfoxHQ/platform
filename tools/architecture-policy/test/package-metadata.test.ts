import assert from 'node:assert/strict';

import {
  architecturePolicySchemaVersion,
  isPackageArchitectureMetadata,
  packageFactFromInstalledManifest,
  packageFactFromManifest,
  validatePackageArchitectureMetadata,
} from '../src/index.js';

test('validates the published package architecture contract', () => {
  const metadata = {
    schema: architecturePolicySchemaVersion,
    realm: 'source-available',
    kind: 'implementation',
    context: 'workspaces',
  };

  assert.equal(isPackageArchitectureMetadata(metadata), true);
  assert.deepEqual(validatePackageArchitectureMetadata(metadata), []);
});

test('rejects non-object values', () => {
  assert.equal(isPackageArchitectureMetadata(null), false);
  assert.equal(isPackageArchitectureMetadata([]), false);
  assert.deepEqual(validatePackageArchitectureMetadata(null), [
    'Package architecture metadata must be an object',
  ]);
  assert.deepEqual(validatePackageArchitectureMetadata([]), [
    'Package architecture metadata must be an object',
  ]);
});

test('requires context for context-bound built-in classes and rejects unknown fields', () => {
  const errors = validatePackageArchitectureMetadata({
    schema: architecturePolicySchemaVersion,
    realm: 'source-available',
    kind: 'dto',
    context: null,
    extra: true,
  });

  assert.deepEqual(errors, [
    'Package architecture metadata context is required for architecture class: dto',
    'Unknown package architecture metadata property: extra',
  ]);
});

test('creates an installed package fact from manifest metadata without an upstream checkout', () => {
  const fact = packageFactFromInstalledManifest(
    {
      name: '@shipfox/api-workspaces',
      version: '9.0.1',
      shipfox: {
        architecture: {
          schema: 1,
          realm: 'source-available',
          kind: 'implementation',
          context: 'workspaces',
        },
      },
    },
    '/consumer/node_modules/@shipfox/api-workspaces',
  );

  assert.deepEqual(fact, {
    schemaVersion: architecturePolicySchemaVersion,
    name: '@shipfox/api-workspaces',
    version: '9.0.1',
    path: '/consumer/node_modules/@shipfox/api-workspaces',
    origin: 'installed',
    policyParticipant: true,
    realm: 'source-available',
    architectureClass: 'implementation',
    boundedContext: 'workspaces',
  });
});

test('does not require metadata for third-party installed packages', () => {
  const fact = packageFactFromManifest(
    {name: 'third-party-library', version: '4.5.6'},
    {path: '/consumer/node_modules/third-party-library'},
  );

  assert.equal(fact.policyParticipant, false);
  assert.equal(fact.architectureClass, null);
  assert.equal(fact.boundedContext, null);
});
