import {
  DEFINITION_SYNC_WARNING_CODE_MAX_LENGTH,
  DEFINITION_SYNC_WARNING_MESSAGE_MAX_LENGTH,
  DEFINITION_SYNC_WARNING_PATH_MAX_LENGTH,
  DEFINITION_SYNC_WARNINGS_MAX_COUNT,
} from '@shipfox/api-definitions-dto';
import type {ValidationWarning} from './validation-warning.js';

export type DefinitionSyncStatus = 'pending' | 'syncing' | 'succeeded' | 'failed';

export type DefinitionSyncWarning = ValidationWarning;

export function limitDefinitionSyncWarnings(
  warnings: readonly DefinitionSyncWarning[],
): DefinitionSyncWarning[] {
  return warnings.slice(0, DEFINITION_SYNC_WARNINGS_MAX_COUNT).map((warning) => ({
    code: warning.code.slice(0, DEFINITION_SYNC_WARNING_CODE_MAX_LENGTH),
    message: warning.message.slice(0, DEFINITION_SYNC_WARNING_MESSAGE_MAX_LENGTH),
    ...(warning.path === undefined
      ? {}
      : {path: warning.path.slice(0, DEFINITION_SYNC_WARNING_PATH_MAX_LENGTH)}),
  }));
}

export const DEFINITION_SYNC_ERROR_CODES = [
  'no-workflow-files',
  'invalid-definition',
  'provider-repository-not-found',
  'provider-file-not-found',
  'provider-access-denied',
  'provider-rate-limited',
  'provider-timeout',
  'provider-unavailable',
  'provider-malformed-response',
  'content-too-large',
  'too-many-files',
  'connection-unavailable',
  'unknown',
] as const;

export type DefinitionSyncErrorCode = (typeof DEFINITION_SYNC_ERROR_CODES)[number];

export function isDefinitionSyncErrorCode(value: unknown): value is DefinitionSyncErrorCode {
  return (
    typeof value === 'string' && (DEFINITION_SYNC_ERROR_CODES as readonly string[]).includes(value)
  );
}

export interface DefinitionSyncState {
  id: string;
  projectId: string;
  sourceConnectionId: string;
  sourceExternalRepositoryId: string;
  ref: string;
  status: DefinitionSyncStatus;
  lastErrorCode: DefinitionSyncErrorCode | null;
  lastErrorMessage: string | null;
  warnings: DefinitionSyncWarning[];
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
