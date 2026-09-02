import {integrationsInterModuleContract} from '@shipfox/api-integration-core-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {isErrorReported} from '@shipfox/node-error-monitoring';
import {ApplicationFailure} from '@temporalio/common';
import {sql} from 'drizzle-orm';
import type {DefinitionsSourceControl} from '#core/integrations.js';
import {db, definitionSyncStates} from '#db/index.js';
import {workflowDefinitions} from '#db/schema/definitions.js';
import {agentValidationCatalog} from '#test/agent-validation-catalog.js';
import {createDefinitionSyncActivities} from './sync-activities.js';

const getValidationCatalogV2 = vi.fn(() => agentValidationCatalog);
const agent = {getValidationCatalogV2} as never;

vi.mock('@temporalio/activity', () => ({
  Context: {
    current: () => ({heartbeat: vi.fn()}),
  },
}));

const validYaml = `
name: CI
runner: ubuntu-latest
jobs:
  build:
    steps:
      - run: pnpm test
`;

const warningEventInterpolation = '$'.concat('{{ event.x }}');
const warningYaml = [
  'name: Warning only',
  'runner: ubuntu-latest',
  'jobs:',
  '  build:',
  '    steps:',
  '      - env:',
  `          MSG: '${warningEventInterpolation}'`,
  '        run: eval "$MSG"',
].join('\n');

const invalidPredicateYaml = [
  'name: Invalid predicate',
  'runner: ubuntu-latest',
  'jobs:',
  '  build:',
  "    success: 'executions.size()'",
  '    steps:',
  '      - run: echo hello',
].join('\n');

function sourceControl(
  overrides: Partial<DefinitionsSourceControl> = {},
): DefinitionsSourceControl {
  return {
    resolveRepository: vi.fn(() =>
      Promise.resolve({
        connection: {
          id: 'connection-1',
          workspaceId: 'workspace-1',
          provider: 'gitea',
          externalAccountId: 'gitea-owner',
          slug: 'gitea_owner',
          displayName: 'Gitea',
          lifecycleStatus: 'active' as const,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        repository: {
          externalRepositoryId: 'gitea:gitea-owner/platform',
          owner: 'gitea-owner',
          name: 'platform',
          fullName: 'gitea-owner/platform',
          defaultBranch: 'main',
          visibility: 'private' as const,
          cloneUrl: 'https://gitea.local/gitea-owner/platform.git',
          htmlUrl: 'https://gitea.local/gitea-owner/platform',
        },
      }),
    ),
    listFiles: vi.fn(() =>
      Promise.resolve({
        files: [{path: '.shipfox/workflows/ci.yml', type: 'file' as const, size: validYaml.length}],
        nextCursor: null,
      }),
    ),
    fetchFile: vi.fn(() =>
      Promise.resolve({path: '.shipfox/workflows/ci.yml', ref: 'main', content: validYaml}),
    ),
    ...overrides,
  };
}

describe('definition sync activities', () => {
  let projectId: string;
  let sourceConnectionId: string;

  beforeEach(() => {
    projectId = crypto.randomUUID();
    sourceConnectionId = crypto.randomUUID();
  });

  describe('prepareDefinitionSync', () => {
    it('marks the sync state as syncing and returns the resolved ref', async () => {
      const activities = createDefinitionSyncActivities(sourceControl(), agent);

      const result = await activities.prepareDefinitionSync({
        projectId,
        workspaceId: crypto.randomUUID(),
        sourceConnectionId,
        sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
      });

      expect(result).toEqual({sourceRef: 'main', sourceCommitSha: undefined});
      const rows = await db()
        .select()
        .from(definitionSyncStates)
        .where(sql`${definitionSyncStates.projectId} = ${projectId}`);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe('syncing');
      expect(rows[0]?.ref).toBe('main');
    });

    it('keeps source ref and source commit sha separate for commit-triggered sync', async () => {
      const source = sourceControl();
      const activities = createDefinitionSyncActivities(source, agent);

      const result = await activities.prepareDefinitionSync({
        projectId,
        workspaceId: crypto.randomUUID(),
        sourceConnectionId,
        sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
        sourceRef: 'main',
        sourceCommitSha: 'abc123',
      });

      expect(result).toEqual({sourceRef: 'main', sourceCommitSha: 'abc123'});
      expect(source.resolveRepository).not.toHaveBeenCalled();
      const rows = await db()
        .select()
        .from(definitionSyncStates)
        .where(sql`${definitionSyncStates.projectId} = ${projectId}`);
      expect(rows[0]?.ref).toBe('main');
    });

    it('translates retryable resolveRepository failures into retryable ApplicationFailures', async () => {
      const activities = createDefinitionSyncActivities(
        sourceControl({
          resolveRepository: vi.fn(() => {
            return Promise.reject(new Error('temporary outage'));
          }),
        }),
        agent,
      );

      const result = activities.prepareDefinitionSync({
        projectId,
        workspaceId: crypto.randomUUID(),
        sourceConnectionId,
        sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
      });

      await expect(result).rejects.toBeInstanceOf(ApplicationFailure);
      await expect(result).rejects.toMatchObject({
        nonRetryable: false,
        type: 'unknown',
        message: 'temporary outage',
      });
      const error = await result.catch((error: unknown) => error);
      expect(isErrorReported(error)).toBe(false);
    });

    it('preserves retryable provider error codes for workflow-level failure persistence', async () => {
      const activities = createDefinitionSyncActivities(
        sourceControl({
          resolveRepository: vi.fn(() => {
            return Promise.reject(
              createInterModuleKnownError(
                integrationsInterModuleContract.methods.resolveSourceRepository,
                'provider-failure',
                {reason: 'timeout'},
              ),
            );
          }),
        }),
        agent,
      );

      const result = activities.prepareDefinitionSync({
        projectId,
        workspaceId: crypto.randomUUID(),
        sourceConnectionId,
        sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
      });

      await expect(result).rejects.toMatchObject({
        nonRetryable: false,
        type: 'provider-timeout',
        message: 'integrations.resolveSourceRepository: provider-failure',
      });
      const error = await result.catch((error: unknown) => error);
      expect(isErrorReported(error)).toBe(true);
    });
  });

  describe('discoverDefinitionWorkflows', () => {
    it('uses the configured workflow path', async () => {
      const source = sourceControl({
        listFiles: vi.fn(() =>
          Promise.resolve({
            files: [{path: '.shipfox/staging/workflows/ci.yml', type: 'file' as const, size: 64}],
            nextCursor: null,
          }),
        ),
      });
      const activities = createDefinitionSyncActivities(source, agent, undefined, {
        workflowPath: '.shipfox/staging/workflows/',
      });

      const result = await activities.discoverDefinitionWorkflows({
        projectId,
        workspaceId: crypto.randomUUID(),
        sourceConnectionId,
        sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
        sourceRef: 'main',
      });

      expect(result.paths).toEqual(['.shipfox/staging/workflows/ci.yml']);
      expect(source.listFiles).toHaveBeenCalledWith(
        expect.objectContaining({prefix: '.shipfox/staging/workflows/'}),
      );
    });
  });

  describe('fetchAndApplyDefinitionWorkflows', () => {
    it('upserts workflow definitions and soft-deletes orphans', async () => {
      const activities = createDefinitionSyncActivities(sourceControl(), agent);
      const workspaceId = crypto.randomUUID();

      const result = await activities.fetchAndApplyDefinitionWorkflows({
        projectId,
        workspaceId,
        sourceConnectionId,
        sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
        sourceRef: 'main',
        paths: ['.shipfox/workflows/ci.yml'],
      });

      expect(result.appliedCount).toBe(1);
      expect(result.deletedCount).toBe(0);
      expect(result.diagnostics).toEqual([]);
      expect(getValidationCatalogV2).toHaveBeenLastCalledWith({workspaceId});
    });

    it('adds the workflow file path to persisted diagnostics', async () => {
      const source = sourceControl({
        fetchFile: vi.fn(() =>
          Promise.resolve({
            path: '.shipfox/workflows/warning.yml',
            ref: 'main',
            content: warningYaml,
          }),
        ),
      });
      const activities = createDefinitionSyncActivities(source, agent);

      const result = await activities.fetchAndApplyDefinitionWorkflows({
        projectId,
        workspaceId: crypto.randomUUID(),
        sourceConnectionId,
        sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
        sourceRef: 'main',
        paths: ['.shipfox/workflows/warning.yml'],
      });

      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]).toMatchObject({
        code: 're-evaluating-command',
        path: 'jobs.build.steps.0.run',
        severity: 'warning',
        filePath: '.shipfox/workflows/warning.yml',
      });
    });

    it('translates DefinitionSyncPermanentError into a non-retryable ApplicationFailure', async () => {
      const activities = createDefinitionSyncActivities(
        sourceControl({
          fetchFile: vi.fn(() =>
            Promise.resolve({
              path: '.shipfox/workflows/bad.yml',
              ref: 'main',
              content: 'name: Bad\n  broken:\nindent',
            }),
          ),
        }),
        agent,
      );

      const result = activities.fetchAndApplyDefinitionWorkflows({
        projectId,
        workspaceId: crypto.randomUUID(),
        sourceConnectionId,
        sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
        sourceRef: 'main',
        sourceCommitSha: 'abc123',
        paths: ['.shipfox/workflows/ci.yml'],
      });

      await expect(result).rejects.toBeInstanceOf(ApplicationFailure);
      await expect(result).rejects.toMatchObject({nonRetryable: true, type: 'invalid-definition'});
    });

    it('carries validation diagnostics on invalid-definition ApplicationFailures', async () => {
      const activities = createDefinitionSyncActivities(
        sourceControl({
          fetchFile: vi.fn(() =>
            Promise.resolve({
              path: '.shipfox/workflows/invalid.yml',
              ref: 'main',
              content: invalidPredicateYaml,
            }),
          ),
        }),
        agent,
      );

      const result = activities.fetchAndApplyDefinitionWorkflows({
        projectId,
        workspaceId: crypto.randomUUID(),
        sourceConnectionId,
        sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
        sourceRef: 'main',
        paths: ['.shipfox/workflows/invalid.yml'],
      });
      const error = await result.catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ApplicationFailure);
      expect(error).toMatchObject({
        nonRetryable: true,
        type: 'invalid-definition',
        details: [
          [
            expect.objectContaining({
              code: 'invalid-definition',
              path: 'jobs.build.success',
              severity: 'error',
              filePath: '.shipfox/workflows/invalid.yml',
              message: expect.stringContaining('must return bool'),
            }),
          ],
        ],
      });
    });

    it('fetches from source commit sha while persisting under source ref', async () => {
      const source = sourceControl();
      const activities = createDefinitionSyncActivities(source, agent);

      const result = await activities.fetchAndApplyDefinitionWorkflows({
        projectId,
        workspaceId: crypto.randomUUID(),
        sourceConnectionId,
        sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
        sourceRef: 'main',
        sourceCommitSha: 'abc123',
        paths: ['.shipfox/workflows/ci.yml'],
      });

      const rows = await db()
        .select()
        .from(workflowDefinitions)
        .where(sql`${workflowDefinitions.projectId} = ${projectId}`);
      expect(result.appliedCount).toBe(1);
      expect(source.fetchFile).toHaveBeenCalledWith(
        expect.objectContaining({ref: 'abc123', path: '.shipfox/workflows/ci.yml'}),
      );
      expect(rows[0]?.ref).toBe('main');
    });
  });

  describe('markDefinitionSyncFailed', () => {
    it('persists last_error_code and last_error_message verbatim', async () => {
      const activities = createDefinitionSyncActivities(sourceControl(), agent);
      await activities.prepareDefinitionSync({
        projectId,
        workspaceId: crypto.randomUUID(),
        sourceConnectionId,
        sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
      });

      const result = activities.markDefinitionSyncFailed({
        projectId,
        workspaceId: crypto.randomUUID(),
        sourceConnectionId,
        sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
        sourceRef: 'main',
        code: 'invalid-definition',
        message: 'Invalid workflow at .shipfox/workflows/bad.yml',
      });
      await result;

      const rows = await db()
        .select()
        .from(definitionSyncStates)
        .where(sql`${definitionSyncStates.projectId} = ${projectId}`);
      expect(rows[0]?.status).toBe('failed');
      expect(rows[0]?.lastErrorCode).toBe('invalid-definition');
      expect(rows[0]?.lastErrorMessage).toBe('Invalid workflow at .shipfox/workflows/bad.yml');
      expect(rows[0]?.warnings).toEqual([]);
      expect(rows[0]?.finishedAt).not.toBeNull();
    });

    it('persists validation diagnostics with a failed sync state', async () => {
      const activities = createDefinitionSyncActivities(sourceControl(), agent);
      const diagnostics = [
        {
          code: 'invalid-definition',
          message: 'Step gate success must be a valid CEL boolean expression.: No such key',
          path: 'jobs.build.steps.0.gate.success',
          filePath: '.shipfox/workflows/invalid.yml',
          severity: 'error' as const,
        },
      ];

      await activities.markDefinitionSyncFailed({
        projectId,
        workspaceId: crypto.randomUUID(),
        sourceConnectionId,
        sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
        sourceRef: 'main',
        code: 'invalid-definition',
        message: 'Invalid workflow definition',
        diagnostics,
      });

      const rows = await db()
        .select()
        .from(definitionSyncStates)
        .where(sql`${definitionSyncStates.projectId} = ${projectId}`);
      expect(rows[0]?.status).toBe('failed');
      expect(rows[0]?.warnings).toEqual(diagnostics);
    });

    it('persists failures with the unresolved sentinel ref when no ref was produced', async () => {
      const activities = createDefinitionSyncActivities(sourceControl(), agent);

      const result = activities.markDefinitionSyncFailed({
        projectId,
        workspaceId: crypto.randomUUID(),
        sourceConnectionId,
        sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
        sourceRef: null,
        code: 'connection-unavailable',
        message: 'connection disabled before resolving repository',
      });
      await result;

      const rows = await db()
        .select()
        .from(definitionSyncStates)
        .where(sql`${definitionSyncStates.projectId} = ${projectId}`);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.ref).toBe('__unresolved__');
      expect(rows[0]?.status).toBe('failed');
      expect(rows[0]?.lastErrorCode).toBe('connection-unavailable');
      expect(rows[0]?.lastErrorMessage).toBe('connection disabled before resolving repository');
    });
  });

  describe('markDefinitionSyncSucceeded', () => {
    it('clears stale error fields when transitioning to succeeded', async () => {
      const activities = createDefinitionSyncActivities(sourceControl(), agent);
      await activities.prepareDefinitionSync({
        projectId,
        workspaceId: crypto.randomUUID(),
        sourceConnectionId,
        sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
      });
      await activities.markDefinitionSyncFailed({
        projectId,
        workspaceId: crypto.randomUUID(),
        sourceConnectionId,
        sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
        sourceRef: 'main',
        code: 'invalid-definition',
        message: 'something',
      });

      const result = activities.markDefinitionSyncSucceeded({
        projectId,
        workspaceId: crypto.randomUUID(),
        sourceConnectionId,
        sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
        sourceRef: 'main',
        diagnostics: [
          {
            code: 're-evaluating-command',
            message: 'Workflow data is re-executed as shell code.',
            path: 'jobs.build.steps.0.run',
            severity: 'warning',
          },
        ],
      });
      await result;

      const rows = await db()
        .select()
        .from(definitionSyncStates)
        .where(sql`${definitionSyncStates.projectId} = ${projectId}`);
      expect(rows[0]?.status).toBe('succeeded');
      expect(rows[0]?.lastErrorCode).toBeNull();
      expect(rows[0]?.lastErrorMessage).toBeNull();
      expect(rows[0]?.warnings).toEqual([
        {
          code: 're-evaluating-command',
          message: 'Workflow data is re-executed as shell code.',
          path: 'jobs.build.steps.0.run',
          severity: 'warning',
        },
      ]);
    });
  });
});
