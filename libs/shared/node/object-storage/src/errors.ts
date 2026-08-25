export class ObjectStorageScopeError extends Error {
  constructor(key: string, prefix: string) {
    super(`Object key must stay inside the ${prefix}/ scope: ${key}`);
    this.name = 'ObjectStorageScopeError';
  }
}

export interface ObjectStorageDeleteFailure {
  readonly key?: string | undefined;
  readonly code?: string | undefined;
  readonly message?: string | undefined;
}

export class ObjectStorageDeleteError extends Error {
  constructor(public readonly failures: readonly ObjectStorageDeleteFailure[]) {
    const first = failures[0];
    super(
      `Failed to delete ${failures.length} object(s): ${first?.key ?? 'unknown key'} ${first?.message ?? 'unknown error'}`,
    );
    this.name = 'ObjectStorageDeleteError';
  }
}

export class ObjectStorageUploadAbortedError extends Error {
  constructor() {
    super('Object-storage upload aborted before it started');
    this.name = 'ObjectStorageUploadAbortedError';
  }
}
