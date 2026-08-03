import {ApiError} from '@shipfox/client-api';

export type ProjectSettingsField = 'name' | 'slug';

export type ProjectSettingsFormError =
  | {kind: 'field'; field: ProjectSettingsField; message: string}
  | {kind: 'form'; message: string};

export function projectSettingsErrorToFormError(error: unknown): ProjectSettingsFormError {
  if (error instanceof ApiError && error.code === 'slug-conflict') {
    return {kind: 'field', field: 'slug', message: 'That project slug is already taken.'};
  }
  return {
    kind: 'form',
    message: error instanceof Error ? error.message : 'Could not update project settings.',
  };
}
