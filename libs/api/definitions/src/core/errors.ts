import type {DefinitionSyncErrorCode} from './entities/sync-state.js';

export class DefinitionParseError extends Error {
  constructor(
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'DefinitionParseError';
  }
}

export class DefinitionSyncPermanentError extends Error {
  constructor(
    public readonly code: DefinitionSyncErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DefinitionSyncPermanentError';
  }
}

export type DefinitionAtRefErrorCode =
  | 'project-not-found'
  | 'ref-not-found'
  | 'ref-invalid'
  | 'ref-moved'
  | 'file-not-found'
  | 'content-too-large'
  | 'invalid-definition'
  | 'too-many-files'
  | 'source-unavailable';

/**
 * Rejects a definition resolution or listing at a git ref. `details` carries
 * the bounded context the presentation translates into known-error details.
 */
export class DefinitionAtRefError extends Error {
  constructor(
    public readonly code: DefinitionAtRefErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'DefinitionAtRefError';
  }
}
