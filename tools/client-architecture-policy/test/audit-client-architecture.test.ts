import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {ClientArchitectureExceptionRegistry} from '../src/audit-client-architecture.js';
import {
  auditClientSource,
  auditRepository,
  clientArchitectureExceptions,
  inventoryClientSource,
  sourceFiles,
  validateExceptionRegistry,
  validateExceptionSourceUsage,
} from '../src/audit-client-architecture.js';

const exceptionFileNotAuditedPattern = /exception file is not audited/;
const exceptionTestDoesNotExistPattern = /exception test does not exist/;
const cacheOperationExceptionStalePattern = /cache-operation exception is stale/;
const queryPolicyExceptionStalePattern = /query-policy exception is stale/;

describe('auditClientSource', () => {
  test('allows checked API requests in a feature adapter', () => {
    const violations = auditClientSource(
      'libs/client/projects/src/hooks/api/list-projects.ts',
      "import {checkedApiRequest} from '@shipfox/client-api';\ncheckedApiRequest(schema, '/projects');",
    );
    assert.deepEqual(violations, []);
  });

  test('allows public feature contribution and route imports', () => {
    const violations = auditClientSource(
      'libs/client/features/src/index.ts',
      "import {projectsFeature} from '@shipfox/client-projects/feature';\nimport {ProjectBreadcrumb} from '@shipfox/client-projects';\nimport route from '@shipfox/client-projects/routes/home';",
    );

    assert.deepEqual(violations, []);
  });

  test('reports private feature imports', () => {
    const violations = auditClientSource(
      'libs/client/features/src/index.ts',
      "import {ProjectsPage} from '@shipfox/client-projects/src/pages/projects-page';",
    );

    assert.deepEqual(violations, [
      {
        file: 'libs/client/features/src/index.ts',
        occurrences: 1,
        rule: 'private-feature-import',
      },
    ]);
  });

  test('reports non-owning feature contributions', () => {
    const violations = auditClientSource(
      'libs/client/projects/src/feature.ts',
      `import {defineClientFeature} from '@shipfox/client-shell';
export const projectsFeature = defineClientFeature({
  id: 'shipfox.projects',
  routes: [{path: '/projects', parent: 'root', impl: '@shipfox/client-integrations/routes/integrations'}],
  navigation: [{id: 'integrations', scope: 'workspace', label: 'Integrations', to: '/integrations'}],
});`,
    );

    assert.deepEqual(violations, [
      {
        file: 'libs/client/projects/src/feature.ts',
        occurrences: 2,
        rule: 'non-owning-feature-contribution',
      },
    ]);
  });

  test('allows a non-owning contribution for a feature with an explicit coordinator', () => {
    const violations = auditClientSource(
      'libs/client/projects/src/feature.ts',
      `import {defineClientFeature} from '@shipfox/client-shell';
export const projectsFeature = defineClientFeature({
  id: 'shipfox.projects',
  coordinator: 'shipfox.projects',
  routes: [{path: '/projects', parent: 'root', impl: '@shipfox/client-integrations/routes/integrations'}],
  navigation: [{id: 'integrations', scope: 'workspace', label: 'Integrations', to: '/integrations'}],
});`,
    );

    assert.deepEqual(violations, []);
  });

  test('allows project-scoped settings contributions owned by a project route', () => {
    const violations = auditClientSource(
      'libs/client/projects/src/feature.ts',
      `import {defineClientFeature} from '@shipfox/client-shell';
export const projectsFeature = defineClientFeature({
  id: 'shipfox.projects',
  routes: [{path: '/w/$workspaceSlug/p/$projectSlug/settings/general', parent: 'projectSettings'}],
  settingsSections: [{pathSegment: 'general', scope: 'project'}],
});`,
    );

    assert.deepEqual(violations, []);
  });

  test('requires a settings contribution to have a route in the same scope', () => {
    const violations = auditClientSource(
      'libs/client/projects/src/feature.ts',
      `import {defineClientFeature} from '@shipfox/client-shell';
export const projectsFeature = defineClientFeature({
  id: 'shipfox.projects',
  routes: [{path: '/w/$workspaceSlug/p/$projectSlug/settings/general', parent: 'projectSettings'}],
  settingsSections: [{pathSegment: 'general', scope: 'workspace'}],
});`,
    );

    assert.deepEqual(violations, [
      {
        file: 'libs/client/projects/src/feature.ts',
        occurrences: 1,
        rule: 'non-owning-feature-contribution',
      },
    ]);
  });

  test('requires navigation registries to be defined in a feature manifest', () => {
    const violations = auditClientSource(
      'libs/client/projects/src/navigation.ts',
      "export const navigation = [{id: 'projects'}];",
    );

    assert.deepEqual(violations, [
      {
        file: 'libs/client/projects/src/navigation.ts',
        occurrences: 1,
        rule: 'non-owning-feature-contribution',
      },
    ]);
  });

  test('skips generated directories when finding source files', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'client-architecture-policy-'));
    try {
      await mkdir(path.join(directory, 'src'));
      await mkdir(path.join(directory, 'dist'));
      await mkdir(path.join(directory, 'test'));
      await mkdir(path.join(directory, 'node_modules', 'package'), {recursive: true});
      await Promise.all([
        writeFile(path.join(directory, 'src', 'source.ts'), ''),
        writeFile(path.join(directory, 'dist', 'generated.ts'), ''),
        writeFile(path.join(directory, 'test', 'fixture.ts'), ''),
        writeFile(path.join(directory, 'test', 'setup.ts'), ''),
        writeFile(path.join(directory, 'src', 'route.gen.ts'), ''),
        writeFile(path.join(directory, 'node_modules', 'package', 'dependency.ts'), ''),
      ]);

      const files = await sourceFiles(directory);

      assert.deepEqual(files, [path.join(directory, 'src', 'source.ts')]);
    } finally {
      await rm(directory, {recursive: true});
    }
  });

  test('allows API requests inside the client API package', () => {
    const violations = auditClientSource(
      'libs/client/api/src/index.ts',
      "checkedApiRequest(schema, '/projects');",
    );

    assert.deepEqual(violations, []);
  });

  test('leaves raw API request diagnostics outside adapters to Biome', () => {
    const violations = auditClientSource(
      'libs/client/projects/src/pages/project-page.tsx',
      "apiRequest('/projects');",
    );

    assert.deepEqual(violations, []);
  });

  test('reports a checked request used outside an adapter', () => {
    const violations = auditClientSource(
      'libs/client/projects/src/pages/project-page.tsx',
      "checkedApiRequest(schema, '/projects');",
    );

    assert.deepEqual(violations, [
      {
        file: 'libs/client/projects/src/pages/project-page.tsx',
        occurrences: 1,
        rule: 'checked-api-request-outside-adapter',
      },
    ]);
  });

  test('reports raw API requests from a feature adapter', () => {
    const violations = auditClientSource(
      'libs/client/projects/src/hooks/api/list-projects.ts',
      "apiRequest('/projects');",
    );

    assert.deepEqual(violations, [
      {
        file: 'libs/client/projects/src/hooks/api/list-projects.ts',
        occurrences: 1,
        rule: 'unparsed-api-response',
      },
    ]);
  });
  test('reports a checked business response returned without a domain mapper', () => {
    const violations = auditClientSource(
      'libs/client/projects/src/hooks/api/list-projects.ts',
      "return await checkedApiRequest(projectResponseSchema, '/projects');",
    );

    assert.deepEqual(violations, [
      {
        file: 'libs/client/projects/src/hooks/api/list-projects.ts',
        occurrences: 1,
        rule: 'unmapped-api-response',
      },
    ]);
  });

  test('reports checked responses from concise and parenthesized returns', () => {
    assert.deepEqual(
      auditClientSource(
        'libs/client/projects/src/hooks/api/list-projects.ts',
        "const listProjects = async () => checkedApiRequest(projectResponseSchema, '/projects');",
      ),
      [
        {
          file: 'libs/client/projects/src/hooks/api/list-projects.ts',
          occurrences: 1,
          rule: 'unmapped-api-response',
        },
      ],
    );
    assert.deepEqual(
      auditClientSource(
        'libs/client/projects/src/hooks/api/list-projects.ts',
        "return (await checkedApiRequest(projectResponseSchema, '/projects'));",
      ),
      [
        {
          file: 'libs/client/projects/src/hooks/api/list-projects.ts',
          occurrences: 1,
          rule: 'unmapped-api-response',
        },
      ],
    );
    assert.deepEqual(
      auditClientSource(
        'libs/client/projects/src/hooks/api/delete-project.ts',
        "const deleteProject = async () => (await checkedApiRequest(emptyResponseSchema, '/projects/id'));",
      ),
      [],
    );
  });

  test('requires reusable query options for adapter-owned query hooks', () => {
    const violations = auditClientSource(
      'libs/client/projects/src/hooks/api/projects.ts',
      "useQuery({queryKey: ['projects'], queryFn: () => listProjects({workspaceId: 'id'})});",
    );

    assert.deepEqual(violations, [
      {
        file: 'libs/client/projects/src/hooks/api/projects.ts',
        occurrences: 1,
        rule: 'inline-query-policy',
      },
    ]);
  });

  test('accepts a reusable query options policy and the documented step-log exception', () => {
    assert.deepEqual(
      auditClientSource(
        'libs/client/projects/src/hooks/api/projects.ts',
        "useQuery({...projectQueryOptions('id'), enabled: true});",
      ),
      [],
    );
    assert.deepEqual(
      auditClientSource(
        'libs/client/logs/src/hooks/api/step-logs.ts',
        "useQuery({queryKey: ['step-logs'], queryFn: readLogs});",
      ),
      [],
    );
  });

  test('rejects an inline TanStack query-options factory in a query hook', () => {
    const violations = auditClientSource(
      'libs/client/projects/src/hooks/api/projects.ts',
      "useQuery(queryOptions({queryKey: ['projects'], queryFn: listProjects}));",
    );

    assert.deepEqual(violations, [
      {
        file: 'libs/client/projects/src/hooks/api/projects.ts',
        occurrences: 1,
        rule: 'inline-query-policy',
      },
    ]);
  });

  test('rejects an aliased TanStack query-options factory in a query hook', () => {
    const violations = auditClientSource(
      'libs/client/projects/src/hooks/api/projects.ts',
      `import {queryOptions as buildQueryOptions} from '@tanstack/react-query';
useQuery(buildQueryOptions({queryKey: ['projects'], queryFn: listProjects}));`,
    );

    assert.deepEqual(violations, [
      {
        file: 'libs/client/projects/src/hooks/api/projects.ts',
        occurrences: 1,
        rule: 'inline-query-policy',
      },
    ]);
  });

  test('requires a registry entry for direct query-client ownership outside adapters', () => {
    const violations = auditClientSource(
      'libs/client/projects/src/pages/project-page.tsx',
      "import {useQueryClient} from '@tanstack/react-query';\nconst queryClient = useQueryClient();\nqueryClient.invalidateQueries({queryKey: ['projects']});",
    );

    assert.deepEqual(violations, [
      {
        file: 'libs/client/projects/src/pages/project-page.tsx',
        occurrences: 2,
        rule: 'unregistered-query-client-operation',
      },
    ]);
  });

  test('tracks aliased useQueryClient imports outside adapters', () => {
    const violations = auditClientSource(
      'libs/client/projects/src/pages/project-page.tsx',
      `import {useQueryClient as useQC} from '@tanstack/react-query';
const qc = useQC();
qc.invalidateQueries({queryKey: ['projects']});`,
    );

    assert.deepEqual(violations, [
      {
        file: 'libs/client/projects/src/pages/project-page.tsx',
        occurrences: 2,
        rule: 'unregistered-query-client-operation',
      },
    ]);
  });

  test('allows same-feature cache effects inside a mutation adapter', () => {
    const violations = auditClientSource(
      'libs/client/projects/src/hooks/api/projects.ts',
      "const queryClient = useQueryClient();\nqueryClient.invalidateQueries(projectQueryOptions('id'));",
    );

    assert.deepEqual(violations, []);
  });

  test('allows a registered coordinator to own direct query-client operations', () => {
    const violations = auditClientSource(
      'libs/client/onboarding/src/workspace-setup-route.ts',
      "const cached = queryClient.getQueryData(['projects']);\nreturn queryClient.fetchQuery(projectQueryOptions('id'));",
    );

    assert.deepEqual(violations, []);
  });

  test('keeps query hooks inside the adapter boundary', () => {
    const violations = auditClientSource(
      'libs/client/projects/src/pages/project-page.tsx',
      "useQuery(projectQueryOptions('id'));",
    );

    assert.deepEqual(violations, [
      {
        file: 'libs/client/projects/src/pages/project-page.tsx',
        occurrences: 1,
        rule: 'query-policy-outside-adapter',
      },
    ]);
  });

  test('handles generic query hooks and regex literals while finding query policies', () => {
    assert.deepEqual(
      auditClientSource(
        'libs/client/projects/src/hooks/api/projects.ts',
        "useQuery<Project>({queryFn: () => /\\(/.test(value)});\nprojectQueryOptions('id');",
      ),
      [
        {
          file: 'libs/client/projects/src/hooks/api/projects.ts',
          occurrences: 1,
          rule: 'inline-query-policy',
        },
      ],
    );
    assert.deepEqual(
      auditClientSource(
        'libs/client/projects/src/pages/project-page.tsx',
        'useQuery<Project>({queryFn: () => /\\(/.test(value)});',
      ),
      [
        {
          file: 'libs/client/projects/src/pages/project-page.tsx',
          occurrences: 1,
          rule: 'query-policy-outside-adapter',
        },
      ],
    );
  });

  test('allows empty response contracts without a domain mapper', () => {
    assert.deepEqual(
      auditClientSource(
        'libs/client/projects/src/hooks/api/delete-project.ts',
        "return await checkedApiRequest(emptyResponseSchema, '/projects/id');",
      ),
      [],
    );
  });

  test('summarizes checked requests and query policies for an adapter inventory', () => {
    assert.deepEqual(
      inventoryClientSource(
        'libs/client/projects/src/hooks/api/projects.ts',
        "checkedApiRequest(schema, '/projects');\nuseQuery(projectQueryOptions('id'));",
      ),
      {
        isAdapter: true,
        checkedApiRequestCalls: 1,
        queryHooks: 1,
        reusableQueryPolicies: 1,
      },
    );
  });

  test('keeps source-local API request ownership out of the semantic verifier', () => {
    const page = auditClientSource(
      'libs/client/projects/src/pages/project-page.tsx',
      "import type {ProjectDto} from '@shipfox/api-projects-dto';\nimport {apiRequest} from '@shipfox/client-api';\napiRequest('/projects');",
    );
    assert.deepEqual(page, []);
  });

  test('rejects stale exception paths and missing focused tests', () => {
    const registry: ClientArchitectureExceptionRegistry = {
      cacheOperation: [
        {
          file: 'libs/client/projects/src/hooks/api/projects.ts',
          owner: 'projects mutation adapter',
          reason: 'The mutation owns same-feature cache effects.',
          test: 'libs/client/projects/src/hooks/api/projects.test.ts',
        },
      ],
      queryPolicy: [],
    };

    assert.throws(
      () => validateExceptionRegistry(Object.keys(clientArchitectureExceptions), [], registry),
      exceptionFileNotAuditedPattern,
    );
    assert.throws(
      () =>
        validateExceptionRegistry(
          ['libs/client/projects/src/hooks/api/projects.ts'],
          ['libs/client/projects/src/hooks/api/other.test.ts'],
          registry,
        ),
      exceptionTestDoesNotExistPattern,
    );
    assert.throws(
      () =>
        validateExceptionRegistry(['libs/client/projects/src/hooks/api/projects.ts'], [], registry),
      exceptionTestDoesNotExistPattern,
    );
  });

  test('rejects an exception whose source no longer contains its operation', () => {
    const registry: ClientArchitectureExceptionRegistry = {
      cacheOperation: [
        {
          file: 'libs/client/projects/src/application/project-coordinator.ts',
          owner: 'project coordinator',
          reason: 'The coordinator refreshes a cross-route cache.',
          test: 'libs/client/projects/src/application/project-coordinator.test.ts',
        },
      ],
      queryPolicy: [],
    };

    assert.throws(
      () =>
        validateExceptionSourceUsage(
          new Map([
            [
              'libs/client/projects/src/application/project-coordinator.ts',
              'export function coordinate() { return true; }',
            ],
          ]),
          registry,
        ),
      cacheOperationExceptionStalePattern,
    );
  });

  test('accepts a coordinator exception that passes the query client to a helper', () => {
    const registry: ClientArchitectureExceptionRegistry = {
      cacheOperation: [
        {
          file: 'libs/client/integrations/src/pages/linear-callback-page.tsx',
          owner: 'Linear callback coordinator',
          reason: 'The callback passes the cache to the workspace navigation coordinator.',
          test: 'libs/client/integrations/src/pages/linear-callback-page.test.tsx',
        },
      ],
      queryPolicy: [],
    };

    assert.doesNotThrow(() =>
      validateExceptionSourceUsage(
        new Map([
          [
            'libs/client/integrations/src/pages/linear-callback-page.tsx',
            'const queryClient = useQueryClient();\nreturn resolveWorkspaceSlug({queryClient});',
          ],
        ]),
        registry,
      ),
    );
  });

  test('rejects a query-policy exception whose source now owns its policy', () => {
    const registry: ClientArchitectureExceptionRegistry = {
      cacheOperation: [],
      queryPolicy: [
        {
          file: 'libs/client/logs/src/hooks/api/step-logs.ts',
          owner: 'step-log query adapter',
          reason: 'The query has a special per-view policy.',
          test: 'libs/client/logs/src/hooks/api/step-logs-query.test.tsx',
        },
      ],
    };

    assert.throws(
      () =>
        validateExceptionSourceUsage(
          new Map([
            [
              'libs/client/logs/src/hooks/api/step-logs.ts',
              'useQuery(stepLogsQueryOptions({projectId: "id"}));',
            ],
          ]),
          registry,
        ),
      queryPolicyExceptionStalePattern,
    );
  });

  test('accepts the production exception registry and source inventory', async () => {
    assert.deepEqual(await auditRepository(), []);
  });
});
