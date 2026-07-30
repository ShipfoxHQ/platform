import {
  DEFINITION_SYNC_WARNING_CODE_MAX_LENGTH,
  DEFINITION_SYNC_WARNING_MESSAGE_MAX_LENGTH,
  DEFINITION_SYNC_WARNING_PATH_MAX_LENGTH,
  DEFINITION_SYNC_WARNINGS_MAX_COUNT,
} from '@shipfox/api-definitions-dto';
import {eq} from 'drizzle-orm';
import {db} from './db.js';
import {definitionSyncStates} from './schema/sync-states.js';
import {markDefinitionSyncState} from './sync-states.js';

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

  it('persists warnings and clears them on a subsequent sync', async () => {
    const warnings = [
      {
        code: 're-evaluating-command',
        message: 'Workflow data is re-executed as shell code.',
        path: 'jobs.build.steps.0.run',
      },
    ];

    const succeeded = await markDefinitionSyncState({
      projectId,
      sourceConnectionId,
      sourceExternalRepositoryId: 'gitea-owner/platform',
      ref: 'main',
      status: 'succeeded',
      warnings,
    });

    expect(succeeded.warnings).toEqual(warnings);

    const syncing = await markDefinitionSyncState({
      projectId,
      sourceConnectionId,
      sourceExternalRepositoryId: 'gitea-owner/platform',
      ref: 'main',
      status: 'syncing',
    });

    expect(syncing.warnings).toEqual([]);
  });

  it('bounds warning payloads before persisting them', async () => {
    const state = await markDefinitionSyncState({
      projectId,
      sourceConnectionId,
      sourceExternalRepositoryId: 'gitea-owner/platform',
      ref: 'main',
      status: 'succeeded',
      warnings: Array.from({length: DEFINITION_SYNC_WARNINGS_MAX_COUNT + 1}, (_, index) => ({
        code: `${index}-${'c'.repeat(DEFINITION_SYNC_WARNING_CODE_MAX_LENGTH)}`,
        message: `${index}-${'m'.repeat(DEFINITION_SYNC_WARNING_MESSAGE_MAX_LENGTH)}`,
        path: `${index}-${'p'.repeat(DEFINITION_SYNC_WARNING_PATH_MAX_LENGTH)}`,
      })),
    });

    expect(state.warnings).toHaveLength(DEFINITION_SYNC_WARNINGS_MAX_COUNT);
    expect(state.warnings[0]?.code).toHaveLength(DEFINITION_SYNC_WARNING_CODE_MAX_LENGTH);
    expect(state.warnings[0]?.message).toHaveLength(DEFINITION_SYNC_WARNING_MESSAGE_MAX_LENGTH);
    expect(state.warnings[0]?.path).toHaveLength(DEFINITION_SYNC_WARNING_PATH_MAX_LENGTH);
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
