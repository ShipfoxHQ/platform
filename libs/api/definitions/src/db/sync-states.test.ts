import {
  DEFINITION_SYNC_WARNING_CODE_MAX_LENGTH,
  DEFINITION_SYNC_WARNING_MESSAGE_MAX_LENGTH,
  DEFINITION_SYNC_WARNING_PATH_MAX_LENGTH,
  DEFINITION_SYNC_WARNINGS_MAX_COUNT,
} from '@shipfox/api-definitions-dto';
import {eq} from 'drizzle-orm';
import {db} from './db.js';
import {definitionSyncStates} from './schema/sync-states.js';
import {getLatestDefinitionSyncState, markDefinitionSyncState} from './sync-states.js';

describe('definition sync state queries', () => {
  let projectId: string;
  let sourceConnectionId: string;

  beforeEach(() => {
    projectId = crypto.randomUUID();
    sourceConnectionId = crypto.randomUUID();
  });

  it('creates a sync-state row', async () => {
    const state = await markDefinitionSyncState({
      projectId,
      sourceConnectionId,
      sourceExternalRepositoryId: 'gitea-owner/platform',
      ref: 'main',
      status: 'syncing',
      startedAt: new Date(),
    });

    expect(state.projectId).toBe(projectId);
    expect(state.status).toBe('syncing');
    expect(state.lastErrorCode).toBeNull();
  });

  it('updates the same logical sync-state row', async () => {
    const first = await markDefinitionSyncState({
      projectId,
      sourceConnectionId,
      sourceExternalRepositoryId: 'gitea-owner/platform',
      ref: 'main',
      status: 'syncing',
      startedAt: new Date(),
    });

    const second = await markDefinitionSyncState({
      projectId,
      sourceConnectionId,
      sourceExternalRepositoryId: 'gitea-owner/platform',
      ref: 'main',
      status: 'failed',
      lastErrorCode: 'invalid-definition',
      lastErrorMessage: 'Invalid YAML',
      finishedAt: new Date(),
    });

    const rows = await db()
      .select()
      .from(definitionSyncStates)
      .where(eq(definitionSyncStates.projectId, projectId));
    expect(rows).toHaveLength(1);
    expect(second.id).toBe(first.id);
    expect(second.status).toBe('failed');
    expect(second.lastErrorCode).toBe('invalid-definition');
    expect(second.startedAt?.getTime()).toBe(first.startedAt?.getTime());
  });

  it('persists diagnostics and clears them on a subsequent sync', async () => {
    const diagnostics = [
      {
        code: 'invalid-trigger-event',
        message: 'Trigger event is never delivered.',
        path: 'triggers.on_demand',
        severity: 'error',
      },
      {
        code: 're-evaluating-command',
        message: 'Workflow data is re-executed as shell code.',
        path: 'jobs.build.steps.0.run',
        severity: 'warning',
      },
    ] as const;

    const succeeded = await markDefinitionSyncState({
      projectId,
      sourceConnectionId,
      sourceExternalRepositoryId: 'gitea-owner/platform',
      ref: 'main',
      status: 'succeeded',
      diagnostics,
    });

    expect(succeeded.diagnostics).toEqual(diagnostics);

    const syncing = await markDefinitionSyncState({
      projectId,
      sourceConnectionId,
      sourceExternalRepositoryId: 'gitea-owner/platform',
      ref: 'main',
      status: 'syncing',
    });

    expect(syncing.diagnostics).toEqual([]);
  });

  it('orders errors before warnings and bounds diagnostic payloads before persisting them', async () => {
    const state = await markDefinitionSyncState({
      projectId,
      sourceConnectionId,
      sourceExternalRepositoryId: 'gitea-owner/platform',
      ref: 'main',
      status: 'succeeded',
      diagnostics: [
        {
          code: 'warning-last',
          message: 'warning last',
          severity: 'warning',
        },
        {
          code: 'error-first',
          message: 'error first',
          filePath: '.shipfox/workflows/deploy.yml',
          severity: 'error',
        },
        ...Array.from({length: DEFINITION_SYNC_WARNINGS_MAX_COUNT}, (_, index) => ({
          code: `${index}-${'c'.repeat(DEFINITION_SYNC_WARNING_CODE_MAX_LENGTH)}`,
          message: `${index}-${'m'.repeat(DEFINITION_SYNC_WARNING_MESSAGE_MAX_LENGTH)}`,
          path: `${index}-${'p'.repeat(DEFINITION_SYNC_WARNING_PATH_MAX_LENGTH)}`,
          severity: 'warning' as const,
        })),
      ],
    });

    expect(state.diagnostics).toHaveLength(DEFINITION_SYNC_WARNINGS_MAX_COUNT);
    expect(state.diagnostics[0]).toEqual({
      code: 'error-first',
      message: 'error first',
      filePath: '.shipfox/workflows/deploy.yml',
      severity: 'error',
    });
    expect(state.diagnostics[1]).toEqual({
      code: 'warning-last',
      message: 'warning last',
      severity: 'warning',
    });
    expect(state.diagnostics[2]?.code).toHaveLength(DEFINITION_SYNC_WARNING_CODE_MAX_LENGTH);
    expect(state.diagnostics[2]?.message).toHaveLength(DEFINITION_SYNC_WARNING_MESSAGE_MAX_LENGTH);
    expect(state.diagnostics[2]?.path).toHaveLength(DEFINITION_SYNC_WARNING_PATH_MAX_LENGTH);
    // The two sentinel diagnostics survive truncation; overflow warnings drop first.
    expect(state.diagnostics[0]?.severity).toBe('error');
    expect(state.diagnostics[1]?.severity).toBe('warning');
  });

  it('normalizes legacy stored warnings without a severity', async () => {
    await db()
      .insert(definitionSyncStates)
      .values({
        projectId,
        sourceConnectionId,
        sourceExternalRepositoryId: 'gitea-owner/platform',
        ref: 'main',
        status: 'succeeded',
        warnings: [
          {
            code: 'legacy-warning',
            message: 'Written before diagnostics had severity.',
            path: 'jobs.build.steps.0.run',
          },
        ],
      });

    const state = await getLatestDefinitionSyncState({
      projectId,
      sourceConnectionId,
      sourceExternalRepositoryId: 'gitea-owner/platform',
    });

    expect(state?.diagnostics).toEqual([
      {
        code: 'legacy-warning',
        message: 'Written before diagnostics had severity.',
        path: 'jobs.build.steps.0.run',
        severity: 'warning',
      },
    ]);
  });

  it('clears stale finish data when a sync starts again', async () => {
    await markDefinitionSyncState({
      projectId,
      sourceConnectionId,
      sourceExternalRepositoryId: 'gitea-owner/platform',
      ref: 'main',
      status: 'failed',
      lastErrorCode: 'invalid-definition',
      lastErrorMessage: 'Invalid YAML',
      startedAt: new Date(),
      finishedAt: new Date(),
    });

    const state = await markDefinitionSyncState({
      projectId,
      sourceConnectionId,
      sourceExternalRepositoryId: 'gitea-owner/platform',
      ref: 'main',
      status: 'syncing',
      startedAt: new Date(),
      finishedAt: null,
    });

    expect(state.status).toBe('syncing');
    expect(state.lastErrorCode).toBeNull();
    expect(state.lastErrorMessage).toBeNull();
    expect(state.finishedAt).toBeNull();
  });
});
