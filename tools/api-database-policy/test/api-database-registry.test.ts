import assert from 'node:assert/strict';
import {
  type ApiDatabaseRegistry,
  apiDatabaseRegistry,
  auditApiDatabaseRegistry,
  validateApiDatabaseRegistry,
} from '../src/api-database-registry.js';

function registryFixture(): ApiDatabaseRegistry {
  return {
    owners: apiDatabaseRegistry.owners.map((owner) => ({...owner})),
    migrationUnits: apiDatabaseRegistry.migrationUnits.map((unit) => ({...unit})),
    delegates: apiDatabaseRegistry.delegates.map((delegate) => ({...delegate})),
  };
}

function existingRegistryPaths(): Set<string> {
  return new Set([
    ...apiDatabaseRegistry.owners.map((owner) => owner.packagePath),
    ...apiDatabaseRegistry.migrationUnits.flatMap((unit) => [
      unit.packagePath,
      unit.drizzleConfigPath,
      unit.migrationsPath,
    ]),
    ...apiDatabaseRegistry.delegates.map((delegate) => delegate.packagePath),
  ]);
}

describe('database registry', () => {
  test('registers the current owners, migration units, and neutral delegates', async () => {
    const errors = await auditApiDatabaseRegistry();
    assert.deepEqual(errors, []);
    assert.equal(apiDatabaseRegistry.owners.length, 14);
    assert.equal(apiDatabaseRegistry.migrationUnits.length, 20);
    assert.deepEqual(
      apiDatabaseRegistry.migrationUnits
        .filter((unit) => unit.ownerId === 'integrations')
        .map((unit) => unit.namespace),
      [
        'integrations',
        'integrations_gitea',
        'integrations_github',
        'integrations_jira',
        'integrations_linear',
        'integrations_sentry',
        'integrations_slack',
      ],
    );
    assert.deepEqual(
      apiDatabaseRegistry.delegates.map((delegate) => delegate.capability),
      [
        'migration-runner',
        'schema-table-factory',
        'owner-local-outbox-writer',
        'registered-outbox-dispatcher',
      ],
    );
    assert.equal(
      apiDatabaseRegistry.delegates.find(
        (delegate) => delegate.id === 'registered-outbox-dispatcher',
      )?.packagePath,
      'libs/shared/node/module',
    );
  });

  test('rejects missing registered paths', () => {
    const registry = registryFixture();
    const unit = registry.migrationUnits[0];
    if (!unit) throw new Error('Expected an Agent migration unit');
    unit.migrationsPath = 'libs/api/missing/drizzle';

    const errors = validateApiDatabaseRegistry(registry, {
      existingPaths: existingRegistryPaths(),
    });

    assert.deepEqual(errors, [
      'Migrations path is outside migration unit package: agent',
      'Missing registered path: libs/api/missing/drizzle',
    ]);
  });

  test('rejects duplicate namespaces', () => {
    const registry = registryFixture();
    const unit = registry.migrationUnits[1];
    if (!unit) throw new Error('Expected an Annotations migration unit');
    unit.namespace = 'agent';

    const errors = validateApiDatabaseRegistry(registry);

    assert.deepEqual(errors, ['Duplicate database namespace: agent']);
  });

  test('rejects duplicate and out-of-package migration paths', () => {
    const registry = registryFixture();
    const unit = registry.migrationUnits[6];
    if (!unit) throw new Error('Expected an Integrations Gitea migration unit');
    unit.drizzleConfigPath = 'libs/api/integration/github/drizzle.config.ts';
    unit.migrationsPath = 'libs/api/integration/github/drizzle';

    const errors = validateApiDatabaseRegistry(registry);

    assert.deepEqual(errors, [
      'Drizzle config path is outside migration unit package: integrations-gitea',
      'Duplicate migration unit Drizzle config path: libs/api/integration/github/drizzle.config.ts',
      'Duplicate migration unit migrations path: libs/api/integration/github/drizzle',
      'Migrations path is outside migration unit package: integrations-gitea',
    ]);
  });

  test('rejects unknown owners', () => {
    const registry = registryFixture();
    const unit = registry.migrationUnits[0];
    if (!unit) throw new Error('Expected an Agent migration unit');
    unit.ownerId = 'unknown';

    const errors = validateApiDatabaseRegistry(registry);

    assert.deepEqual(errors, [
      'Database owner has no namespace: agent',
      'Unknown database owner: unknown',
    ]);
  });

  test('rejects package and owner classification mismatches', () => {
    const registry = registryFixture();
    const owner = registry.owners[0];
    if (!owner) throw new Error('Expected an Agent owner');
    owner.packagePath = 'libs/api/auth';

    const errors = validateApiDatabaseRegistry(registry);

    assert.deepEqual(errors, [
      'Database migration unit classification mismatch: agent',
      'Database owner ID does not match API context: agent (auth)',
    ]);
  });

  test('rejects namespace naming exceptions', () => {
    const registry = registryFixture();
    const unit = registry.migrationUnits[0];
    if (!unit) throw new Error('Expected an Agent migration unit');
    unit.namespace = 'Agent';

    const errors = validateApiDatabaseRegistry(registry);

    assert.deepEqual(errors, ['Invalid database namespace: Agent']);
  });

  test('rejects an unregistered Drizzle config', () => {
    const discoveredDrizzleConfigPaths = new Set(
      apiDatabaseRegistry.migrationUnits.map((unit) => unit.drizzleConfigPath),
    );
    discoveredDrizzleConfigPaths.add('libs/api/new-owner/drizzle.config.ts');

    const errors = validateApiDatabaseRegistry(registryFixture(), {
      discoveredDrizzleConfigPaths,
    });

    assert.deepEqual(errors, ['Unregistered Drizzle config: libs/api/new-owner/drizzle.config.ts']);
  });

  test('rejects missing or unexpected delegates', () => {
    const registry = registryFixture();
    registry.delegates = [];

    const errors = validateApiDatabaseRegistry(registry);

    assert.deepEqual(errors, [
      'Missing database delegate: migration-runner',
      'Missing database delegate: owner-local-outbox-writer',
      'Missing database delegate: registered-outbox-dispatcher',
      'Missing database delegate: schema-table-factory',
    ]);
  });
});
