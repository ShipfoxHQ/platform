import assert from 'node:assert/strict';
import {evaluateArchitecturePolicy} from '@shipfox/architecture-policy';
import {
  apiContextPackagePaths,
  auditApiContextInventory,
  auditRepository,
  discoverPlatformArchitecturePolicy,
} from '../src/api-context-inventory.js';

describe('Platform architecture-policy adapter', () => {
  test('keeps registry completeness as a narrow discovery check', () => {
    assert.deepEqual(
      auditApiContextInventory([...apiContextPackagePaths(), 'libs/api/new-context']),
      ['Unclassified server package: libs/api/new-context'],
    );
  });

  test('discovers normalized package, manifest, and export facts', async () => {
    const {configuration, facts} = await discoverPlatformArchitecturePolicy();

    assert.equal(facts.schemaVersion, 1);
    assert.equal(facts.importEdges.length, 0);
    assert.ok(
      facts.packages.some(
        (packageFact) =>
          packageFact.name === '@shipfox/api-runners' &&
          packageFact.architectureClass === 'implementation' &&
          packageFact.boundedContext === 'runners' &&
          packageFact.realm === 'source-available',
      ),
    );
    assert.ok(
      facts.manifestEdges.some(
        (edge) =>
          edge.source === '@shipfox/api-runners' && edge.target === '@shipfox/api-runners-dto',
      ),
    );
    assert.ok(
      facts.publicExports.some(
        (entry) =>
          entry.package === '@shipfox/api-runners-dto' &&
          entry.publicSubpath === './inter-module' &&
          entry.resolvedTarget?.endsWith('libs/api/runners-dto/src/inter-module.ts'),
      ),
    );
    assert.equal(configuration.realms['source-available']?.mayDependOn[0], 'source-available');
    assert.equal(configuration.compositionRoots[0], '@shipfox/api-server');
    assert.deepEqual(configuration.extensions, {
      platform: {
        classificationSource: 'api-contexts.cjs',
        dependencyCruiserSource: 'api-contexts.cjs',
        classifiedPackageCount: configuration.localPackages.length,
      },
    });
  });

  test('accepts the current repository through the shared evaluator', async () => {
    assert.deepEqual(await auditRepository(), []);
  });

  test('uses shared diagnostics for manifest and export policy', async () => {
    const discovery = await discoverPlatformArchitecturePolicy();
    const runners = discovery.facts.packages.find(({name}) => name === '@shipfox/api-runners');
    const auth = discovery.facts.packages.find(({name}) => name === '@shipfox/api-auth');
    assert.ok(runners);
    assert.ok(auth);
    discovery.facts.manifestEdges.push({
      schemaVersion: 1,
      source: runners.name,
      target: auth.name,
      dependencyGroup: 'devDependencies',
    });
    discovery.facts.publicExports = discovery.facts.publicExports.filter(
      ({package: packageName, publicSubpath}) =>
        !(packageName === '@shipfox/api-runners-dto' && publicSubpath === './inter-module'),
    );

    const diagnostics = evaluateArchitecturePolicy(discovery.facts, discovery.configuration);
    assert.ok(diagnostics.some(({ruleId}) => ruleId === 'architecture/manifest-edge'));
    assert.ok(diagnostics.some(({ruleId}) => ruleId === 'architecture/export-intent'));
  });
});
