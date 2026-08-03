import {ApiError} from '@shipfox/client-api';

export type WorkspaceGeneralField = 'name' | 'slug';

export type WorkspaceGeneralFormError =
  | {kind: 'field'; field: WorkspaceGeneralField; message: string}
  | {kind: 'form'; message: string};

export function workspaceGeneralErrorToFormError(error: unknown): WorkspaceGeneralFormError {
  if (error instanceof ApiError && error.code === 'slug-conflict') {
    return {kind: 'field', field: 'slug', message: 'That workspace slug is already taken.'};
  }
  return {
    kind: 'form',
    message: error instanceof Error ? error.message : 'Could not update workspace settings.',
  };
}
