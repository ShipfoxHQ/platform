import assert from 'node:assert/strict';
import {resolve} from 'node:path';

import {
  architectureMetadataDescription,
  architectureMetadataForPackagePath,
  packageArchitectureMetadataErrors,
} from '../src/package-architecture-metadata.js';
import {productionizePackageManifest} from '../src/productionized-manifest-packer.js';

const repositoryRoot = resolve(new URL('../../../', import.meta.url).pathname);
const staleMetadataPattern = /stale or conflicting.*expected implementation \(agent\)/u;
const invalidMetadataPattern = /invalid.*expected implementation \(agent\)/u;

test('derives metadata for every registered architecture class', () => {
  assert.deepEqual(architectureMetadataForPackagePath('libs/api/agent'), {
    schema: 1,
    realm: 'source-available',
    kind: 'implementation',
    context: 'agent',
  });
  assert.deepEqual(architectureMetadataForPackagePath('libs/api/agent-dto'), {
    schema: 1,
    realm: 'source-available',
    kind: 'dto',
    context: 'agent',
  });
  assert.deepEqual(architectureMetadataForPackagePath('libs/shared/common/redact'), {
    schema: 1,
    realm: 'source-available',
    kind: 'shared-semantic',
    context: null,
  });
  assert.deepEqual(architectureMetadataForPackagePath('libs/shared/common/config'), {
    schema: 1,
    realm: 'source-available',
    kind: 'shared-infrastructure',
    context: null,
  });
  assert.deepEqual(architectureMetadataForPackagePath('libs/api/integration/spi'), {
    schema: 1,
    realm: 'source-available',
    kind: 'spi',
    context: 'integrations',
  });
  assert.deepEqual(architectureMetadataForPackagePath('libs/api/server'), {
    schema: 1,
    realm: 'source-available',
    kind: 'composition-root',
    context: null,
  });
  assert.equal(architectureMetadataForPackagePath('tools/architecture-policy'), undefined);
});

test('productionization adds metadata while preserving unrelated manifest data', () => {
  const productionized = productionizePackageManifest(
    {
      name: '@shipfox/api-agent',
      version: '9.0.1',
      description: 'kept',
      shipfox: {releaseChannel: 'stable'},
      devDependencies: {'@shipfox/biome': 'workspace:*'},
    },
    resolve(repositoryRoot, 'libs/api/agent'),
  );

  assert.deepEqual(productionized.shipfox, {
    releaseChannel: 'stable',
    architecture: {
      schema: 1,
      realm: 'source-available',
      kind: 'implementation',
      context: 'agent',
    },
  });
  assert.equal(productionized.description, 'kept');
  assert.equal(productionized.devDependencies, undefined);
});

test('reports missing, invalid, and stale metadata with the expected classification', () => {
  const expected = architectureMetadataForPackagePath('libs/api/agent');
  assert.ok(expected);
  const expectedDescription = architectureMetadataDescription(expected);

  assert.ok(
    packageArchitectureMetadataErrors({name: '@shipfox/api-agent'}, expected)[0]?.includes(
      `@shipfox/api-agent`,
    ),
  );
  assert.ok(
    packageArchitectureMetadataErrors({name: '@shipfox/api-agent'}, expected)[0]?.includes(
      `expected ${expectedDescription}`,
    ),
  );
  assert.match(
    packageArchitectureMetadataErrors(
      {
        name: '@shipfox/api-agent',
        shipfox: {
          architecture: {schema: 1, realm: 'source-available', kind: 'unknown', context: null},
        },
      },
      expected,
    )[0] ?? '',
    staleMetadataPattern,
  );
  assert.match(
    packageArchitectureMetadataErrors(
      {
        name: '@shipfox/api-agent',
        shipfox: {
          architecture: {
            schema: 999,
            realm: 'source-available',
            kind: 'implementation',
            context: 'agent',
          },
        },
      },
      expected,
    )[0] ?? '',
    invalidMetadataPattern,
  );
});
